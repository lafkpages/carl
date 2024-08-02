import type { ConsolaInstance } from "consola";
import type { Message } from "venom-bot";
import type {
  Command,
  Interaction,
  InteractionResult,
  Plugin,
} from "./plugins";

import { mkdir } from "node:fs/promises";

import { Database } from "bun:sqlite";
import { consola } from "consola";
import { create } from "venom-bot";

import config from "../config.json";
import { CommandError, CommandPermissionError } from "./error";
import { getPermissionLevel, PermissionLevel } from "./perms";
import { InteractionContinuation } from "./plugins";
import { getMessageId } from "./utils";

if (!process.isBun) {
  consola.fatal("WhatsApp PA must be run with Bun");
  process.exit(1);
}

await mkdir("db", { recursive: true });

type InternalPlugin = Plugin & {
  _logger: ConsolaInstance;
  _db: Database | null;
};
type InternalCommand = Command & {
  plugin: InternalPlugin;
  _logger: ConsolaInstance;
};
const commands: Record<string, InternalCommand> = {};
const plugins: InternalPlugin[] = [];

function loadPlugin(plugin: Plugin) {
  consola.info("Loading plugin:", plugin);

  const _logger = consola.withDefaults({
    tag: plugin.id,
  });

  const _db = plugin.database
    ? new Database(`db/${plugin.id}.sqlite`, { strict: true })
    : null;
  _db?.exec("PRAGMA journal_mode = WAL;");

  const _plugin = { ...plugin, _logger, _db };

  plugins.push(_plugin);

  if (plugin.commands) {
    for (const cmd of plugin.commands) {
      if (cmd.name in commands) {
        consola.error("Duplicate command, dupe not loaded", {
          cmdName: cmd.name,
          existingPlugin: commands[cmd.name].plugin.id,
          newPlugin: plugin.id,
        });

        continue;
      }

      commands[cmd.name] = {
        ...cmd,
        plugin: _plugin,
        _logger: _logger.withDefaults({
          tag: `${plugin.id}/${cmd.name}`,
        }),
      };
    }
  }
}

async function loadPluginsFromConfig(idsToLoad?: Set<string> | null) {
  const now = Date.now();

  for (const pluginIdentifier of config.plugins) {
    consola.info("Importing plugin:", pluginIdentifier);

    // add a cache buster to the import path
    // so that plugins can be reloaded

    let plugin: Plugin;
    if (pluginIdentifier.includes("/")) {
      plugin = (await import(`../${pluginIdentifier}?${now}`)).default;
    } else {
      plugin = (await import(`./plugins/${pluginIdentifier}?${now}`)).default;

      if (plugin.id !== pluginIdentifier) {
        consola.error(
          "Built-in plugin ID does not match plugin file name. This is a WhatsApp PA bug. Please report this issue.",
          {
            pluginId: plugin.id,
            pluginIdentifier,
          },
        );
      }
    }

    if (idsToLoad && !idsToLoad.has(plugin.id)) {
      continue;
    }

    loadPlugin(plugin);
  }
}

const corePlugin: Plugin = {
  id: "core",
  name: "Core",
  description: "Core commands",
  version: "1.0.0",

  commands: [
    {
      name: "help",
      description:
        "Shows this help message (use `/help all` to show hidden commands)",
      minLevel: PermissionLevel.NONE,

      handler({ rest }) {
        const showHidden = rest === "all";

        let msg = "Plugins:";

        for (const plugin of plugins) {
          if (plugin.hidden && !showHidden) {
            continue;
          }

          msg += `\n\n*${plugin.name}* (${plugin.version})`;
          msg += `\n> ${plugin.description}`;
          msg += `\nCommands:`;

          if (plugin.commands) {
            for (const command of plugin.commands) {
              if (command.hidden && !showHidden) {
                continue;
              }

              msg += `\n* \`/${command.name}\`: ${command.description}`;
            }
          }
        }

        return msg;
      },
    },
    {
      name: "stop",
      description: "Stop the bot gracefully",
      minLevel: PermissionLevel.ADMIN,
      hidden: true,

      async handler() {
        stopGracefully();
        return true;
      },
    },
    {
      name: "forcestop",
      description: "Stop the bot without unloading plugins",
      minLevel: PermissionLevel.ADMIN,
      hidden: true,

      async handler() {
        stop();
        return true;
      },
    },
    {
      name: "reload",
      description: "Reload plugins",
      minLevel: PermissionLevel.ADMIN,
      hidden: true,

      async handler({ rest, logger }) {
        rest = rest.trim().toLowerCase();

        const pluginsToReload = rest ? new Set(rest.split(/[,\s]+/)) : null;

        if (pluginsToReload?.size === 0) {
          return false;
        }

        // Run plugin onUnload events
        for (const plugin of plugins) {
          if (pluginsToReload && !pluginsToReload.has(plugin.id)) {
            continue;
          }

          if (plugin.onUnload) {
            logger.info(
              {
                unloadPluginId: plugin.id,
              },
              "Unloading plugin",
            );
            plugin.onUnload({
              client,
              logger: plugin._logger,
              config,

              database: plugin._db,
            });
          }
        }

        if (pluginsToReload) {
          for (const plugin of plugins) {
            if (
              // only unload plugins that are in pluginsToReload
              pluginsToReload.has(plugin.id)
            ) {
              // delete plugin from plugins array
              plugins.splice(plugins.indexOf(plugin), 1);

              // delete the plugin's commands from the commands object
              for (const command in commands) {
                if (commands[command].plugin === plugin) {
                  delete commands[command];
                }
              }
            }
          }
        } else {
          // Clear all plugins and commands
          plugins.length = 0;
          for (const command in commands) {
            delete commands[command];
          }
        }

        // Reload plugins
        if (!pluginsToReload || pluginsToReload.has("core")) {
          loadPlugin(corePlugin);
        }
        await loadPluginsFromConfig(pluginsToReload);

        // Fire plugin onLoad events
        for (const plugin of plugins) {
          await plugin.onLoad?.({
            client,
            logger: plugin._logger,
            config,

            database: plugin._db,
          });
        }

        return true;
      },
    },
  ],
};

// Load plugins
loadPlugin(corePlugin);
await loadPluginsFromConfig();

const client = await create({
  session: "pa",
});

// Fire plugin onLoad events
for (const plugin of plugins) {
  await plugin.onLoad?.({
    client,
    logger: plugin._logger,
    config,

    database: plugin._db,
  });
}

const interactionContinuations: Record<
  string,
  Interaction & {
    _data: unknown;
    _plugin: InternalPlugin;
    _timeout: Timer;
  }
> = {};

const { dispose } = await client.onMessage(async (message) => {
  const messageBody = message.type === "chat" ? message.body : message.caption;
  if (!messageBody) {
    return;
  }

  const permissionLevel = Math.max(
    getPermissionLevel(message.sender.id),
    getPermissionLevel(message.chatId),
  );

  consola.debug("Message received:", { message, messageBody, permissionLevel });

  let [, command, rest] = messageBody.match(/^\/(\w+)\s*(.*)?$/is) || [];
  rest ||= "";

  const quotedMsgId = getMessageId(message.quotedMsg);
  if (quotedMsgId && quotedMsgId in interactionContinuations) {
    try {
      client.markMarkSeenMessage(message.from);
      client.startTyping(message.from, true);

      const {
        handler: interactionContinuationHandler,
        _data,
        _plugin,
        _timeout,
      } = interactionContinuations[quotedMsgId];

      // prevent the expiration timeout from running
      clearTimeout(_timeout);

      // delete the interaction continuation to prevent it from being used again
      delete interactionContinuations[quotedMsgId];

      const result = await interactionContinuationHandler({
        message,
        rest,

        permissionLevel,

        client,
        logger: _plugin._logger.withDefaults({
          tag: `${_plugin.id}:${interactionContinuationHandler.name}`,
        }),
        config,

        database: _plugin._db,

        data: _data,
      });

      await handleInteractionResult(result, message, _plugin);
    } catch (err) {
      await handleError(err, message);
    }
  } else if (command) {
    consola.info("Command received:", { command, rest });

    client.markMarkSeenMessage(message.from);
    client.startTyping(message.from, true);
    // TODO: figure out what the second argument does

    if (command in commands) {
      const cmd = commands[command as keyof typeof commands];

      if (permissionLevel >= cmd.minLevel) {
        try {
          const result = await cmd.handler({
            message,
            rest,

            permissionLevel,

            client,
            logger: cmd._logger,
            config,

            database: cmd.plugin._db,

            data: null,
          });

          await handleInteractionResult(result, message, cmd.plugin);
        } catch (err) {
          await handleError(err, message);
        }
      } else {
        await handleError(
          new CommandPermissionError(command, cmd.minLevel),
          message,
        );
      }
    } else {
      await client.reply(
        message.from,
        `Unknown command \`${command}\``,
        message.id,
      );
    }
  }

  for (const plugin of plugins) {
    if (plugin.onMessage) {
      consola.debug("Running plugin onMessage:", plugin.id);

      const result = await plugin.onMessage({
        client,
        logger: plugin._logger,
        config,

        database: plugin._db,

        message,
      });

      await handleInteractionResult(result, message, plugin);
    }
  }
});

async function handleInteractionResult(
  result: InteractionResult,
  message: Message,
  plugin: InternalPlugin,
) {
  const isInteractionContinuation =
    result instanceof InteractionContinuation ||
    // Also check for interaction continuations objects without using instanceof
    // because instanceof doesn't work across module boundaries
    (typeof result === "object" && "handler" in result);

  if (isInteractionContinuation) {
    const reply = await client.reply(message.from, result.message, message.id);
    const replyId = getMessageId(reply);

    if (typeof replyId === "string") {
      const interactionContinuationHandler =
        plugin.interactions?.[result.handler];

      if (interactionContinuationHandler) {
        // expire continuations after 5 minutes
        const _timeout = setTimeout(
          async () => {
            await client.sendReactions(replyId, "\u231B");

            delete interactionContinuations[replyId];
          },
          5 * 60 * 1000,
        );

        interactionContinuations[replyId] = {
          ...interactionContinuationHandler,
          _data: result.data,
          _plugin: plugin,
          _timeout,
        };
      } else {
        throw new Error(
          `Interaction continuation \`${result.handler}\` handler not found for plugin \`${plugin.id}\``,
        );
      }
    } else {
      consola.debug("Reply:", reply);
      throw new Error("Failed to get reply ID for interaction continuation");
    }
  } else {
    if (typeof result === "string") {
      await client.reply(message.from, result, message.id);
    } else if (result === true) {
      await client.sendReactions(message.id, "\u{1F44D}");
    } else if (result === false) {
      await client.sendReactions(message.id, "\u{1F44E}");
    }
  }
}

async function handleError(error: unknown, message: Message) {
  await client.sendReactions(message.id, "\u274C");

  let isCommandError = error instanceof CommandError;
  if (
    !isCommandError &&
    error instanceof Error &&
    error.name === "CommandError"
  ) {
    isCommandError = true;
  }

  // check name as well because instanceof doesn't work across module boundaries

  if (isCommandError) {
    await client.reply(
      message.from,
      `Error: ${(error as CommandError).message}`,
      message.id,
    );
  } else {
    consola.error("Error while handling command:", error);

    await client.reply(
      message.from,
      `Error:\n\`\`\`\n${Bun.inspect(error, { colors: false })}\`\`\``,
      message.id,
    );
  }
}

async function stopGracefully() {
  consola.info("Graceful stop triggered");

  for (const plugin of plugins) {
    if (plugin.onUnload) {
      consola.info("Unloading plugin on graceful stop:", plugin.id);
      plugin.onUnload({
        client,
        logger: plugin._logger,
        config,

        database: plugin._db,
      });
    }
  }

  await stop();
}

async function stop() {
  consola.debug("Removing SIGINT listener");
  process.off("SIGINT", stopGracefully);

  consola.debug("Disposing client message listener");
  dispose();

  consola.info("Waiting a second before closing client on stop");
  await Bun.sleep(1000);

  consola.info("Closing client on stop");
  await client.close();

  consola.info("Waiting a second before exiting process on stop");
  await Bun.sleep(1000);

  consola.info("Exiting process on stop");
  process.exit();
}

process.on("SIGINT", stopGracefully);
