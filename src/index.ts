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
import { isCommandRateLimited, isUserRateLimited } from "./ratelimits";
import {
  getMessageId,
  getMessageTextContent,
  getQuotedMessageId,
} from "./utils";

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

const userCommandAliases = new Map<string, Map<string, string>>();

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
  database: true,

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
    {
      name: "alias",
      description: "Set an alias for a command",
      minLevel: PermissionLevel.NONE,

      handler({ message, rest, database }) {
        if (!rest) {
          // List user's aliases
          if (!userCommandAliases.has(message.sender.id)) {
            return "You have no aliases set";
          }

          let msg = "Your aliases:";

          for (const [alias, command] of userCommandAliases.get(
            message.sender.id,
          )!) {
            msg += `\n* \`${alias}\`: \`${command}\``;
          }

          return msg;
        }

        const [, alias, command] = rest.match(/^\/?(.+)\s+\/?(.+)$/) || [];

        if (!alias) {
          throw new CommandError("Usage: `/alias <alias> <command>`");
        }

        database!.run<[string, string, string]>(
          "INSERT OR REPLACE INTO aliases (user, alias, command) VALUES (?, ?, ?)",
          [message.sender.id, alias, command],
        );

        if (!userCommandAliases.has(message.sender.id)) {
          userCommandAliases.set(message.sender.id, new Map());
        }

        userCommandAliases.get(message.sender.id)!.set(alias, command);

        return true;
      },
    },
    {
      name: "unalias",
      description: "Remove an alias",
      minLevel: PermissionLevel.NONE,

      handler({ message, rest, database }) {
        if (!rest) {
          throw new CommandError("Usage: `/unalias <alias>`");
        }

        const userAliases = userCommandAliases.get(message.sender.id);

        if (!userAliases) {
          throw new CommandError("You have no aliases set");
        }

        if (!userAliases.has(rest)) {
          return `Alias \`${rest}\` not found`;
        }

        database!.run<[string, string]>(
          "DELETE FROM aliases WHERE user = ? AND alias = ?",
          [message.sender.id, rest],
        );

        userAliases.delete(rest);

        if (userAliases.size === 0) {
          userCommandAliases.delete(message.sender.id);
        }

        return true;
      },
    },
    {
      name: "resolvecommand",
      description: "Resolve a command [DEBUG]",
      minLevel: PermissionLevel.NONE,
      hidden: true,

      handler({ rest }) {
        if (!rest) {
          throw new CommandError("Usage: `/resolvecommand <command>`");
        }

        const cmd = resolveCommand(rest);

        if (cmd) {
          return `Command \`${rest}\` resolves to \`${cmd.plugin.id}/${cmd.name}\``;
        } else {
          return false;
        }
      },
    },
  ],

  onLoad({ database }) {
    database!.run(`\
CREATE TABLE IF NOT EXISTS aliases (
  user TEXT NOT NULL,
  alias TEXT NOT NULL,
  command TEXT NOT NULL,
  PRIMARY KEY (user, alias)
);
`);

    const aliasEntries = database!
      .query<
        {
          user: string;
          alias: string;
          command: string;
        },
        []
      >("SELECT user, alias, command FROM aliases")
      .all();

    for (const aliasEntry of aliasEntries) {
      if (!userCommandAliases.has(aliasEntry.user)) {
        userCommandAliases.set(aliasEntry.user, new Map());
      }

      userCommandAliases
        .get(aliasEntry.user)!
        .set(aliasEntry.alias, aliasEntry.command);
    }
  },
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

const interactionContinuations = new Map<
  string,
  Interaction & {
    _data: unknown;
    _plugin: InternalPlugin;
    _timeout: Timer;
  }
>();

const { dispose } = await client.onMessage(async (message) => {
  const messageBody = getMessageTextContent(message);
  if (!messageBody) {
    return;
  }

  const permissionLevel = Math.max(
    getPermissionLevel(message.sender.id),
    getPermissionLevel(message.chatId),
  );

  // TODO: rework PermissionLevel; enum is painful
  const rateLimit =
    permissionLevel === PermissionLevel.ADMIN
      ? config.ratelimit.admin
      : permissionLevel === PermissionLevel.TRUSTED
        ? config.ratelimit.trusted
        : config.ratelimit.default;

  consola.debug("Message received:", {
    message,
    messageBody,
    permissionLevel,
    rateLimit,
  });

  let hasCheckedUserRateLimit = false;

  let [, command, rest] = messageBody.match(/^\/(\w+)\s*(.*)?$/is) || [];
  rest ||= "";

  const quotedMsgId = getQuotedMessageId(message);
  if (quotedMsgId && interactionContinuations.has(quotedMsgId)) {
    consola.debug("Interaction continuation found:", quotedMsgId);

    try {
      client.markMarkSeenMessage(message.from);
      client.startTyping(message.from, true);

      const {
        handler: interactionContinuationHandler,
        _data,
        _plugin,
        _timeout,
      } = interactionContinuations.get(quotedMsgId)!;

      // prevent the expiration timeout from running
      clearTimeout(_timeout);

      // delete the interaction continuation to prevent it from being used again
      interactionContinuations.delete(quotedMsgId);

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

    if (isUserRateLimited(message.sender.id, rateLimit)) {
      consola.info("User rate limited at command:", message.sender.id);
      return;
    }
    hasCheckedUserRateLimit = true;

    const cmd = resolveCommand(command, message.sender.id);

    if (cmd) {
      client.markMarkSeenMessage(message.from);

      if (
        isCommandRateLimited(
          message.sender.id,
          cmd.plugin.id,
          cmd.name,
          cmd.rateLimit ?? 0,
        )
      ) {
        await client.sendReactions(message.id, "\u23F3");
      } else {
        client.startTyping(message.from, true);
        // TODO: figure out what the second argument does

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
      if (!hasCheckedUserRateLimit) {
        if (isUserRateLimited(message.sender.id, rateLimit)) {
          consola.info("User rate limited at onMessage:", message.sender.id);
          return;
        }
        hasCheckedUserRateLimit = true;
      }

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

function resolveCommand(command: string, user?: string) {
  if (command in commands) {
    return commands[command];
  }

  if (user && userCommandAliases.has(user)) {
    const userAliases = userCommandAliases.get(user)!;

    if (userAliases.has(command)) {
      return resolveCommand(userAliases.get(command)!, user);
    }
  }

  if (config.aliases && command in config.aliases) {
    return resolveCommand(
      config.aliases[command as keyof typeof config.aliases],
    );
  }

  return null;
}

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

            interactionContinuations.delete(replyId);
          },
          5 * 60 * 1000,
        );

        interactionContinuations.set(replyId, {
          ...interactionContinuationHandler,
          _data: result.data,
          _plugin: plugin,
          _timeout,
        });
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
