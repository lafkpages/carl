import type { ConsolaInstance } from "consola";
import type { Chat, Message, MessageId } from "whatsapp-web.js";
import type {
  Command,
  Interaction,
  InteractionResult,
  Plugin,
} from "./plugins";

import { mkdir } from "node:fs/promises";

import { Database } from "bun:sqlite";
import { consola } from "consola";
import { generate } from "qrcode-terminal";
import { LocalAuth } from "whatsapp-web.js";

import { config } from "./config";
import { CommandError, CommandPermissionError } from "./error";
import { getClient } from "./google";
import { generateHelp, generateHelpPage } from "./help";
import { getPermissionLevel, PermissionLevel } from "./perms";
import { InteractionContinuation } from "./plugins";
import { isCommandRateLimited, isUserRateLimited } from "./ratelimits";
import { generateTemporaryShortLink, server } from "./server";

const { Client } =
  require("whatsapp-web.js") as typeof import("whatsapp-web.js");

if (!process.isBun) {
  consola.fatal("WhatsApp PA must be run with Bun");
  process.exit(1);
}

await mkdir("db/plugins", { recursive: true });

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
    ? new Database(`db/plugins/${plugin.id}.sqlite`, { strict: true })
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
        const [, pageArg, showHiddenArg] =
          rest.match(/^(\d+)(\s+all)?$|^$/) || [];

        const page = parseInt(pageArg || "1");
        const showHidden = !!showHiddenArg;

        if (page < 1) {
          return false;
        }

        return generateHelpPage(generateHelp(plugins, showHidden), page);
      },
    },
    {
      name: "stop",
      description: "Stop the bot gracefully",
      minLevel: PermissionLevel.ADMIN,
      hidden: true,

      handler() {
        stopGracefully();
        return true;
      },
    },
    {
      name: "forcestop",
      description: "Stop the bot without unloading plugins",
      minLevel: PermissionLevel.ADMIN,
      hidden: true,

      handler() {
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

        if (pluginsToReload) {
          for (const pluginId of pluginsToReload) {
            if (!plugins.some((plugin) => plugin.id === pluginId)) {
              throw new CommandError(`plugin \`${pluginId}\` not found`);
            }
          }
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
            await plugin.onUnload({
              client,
              logger: plugin._logger,
              config,

              database: plugin._db,

              generateTemporaryShortLink,
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
            server,

            generateTemporaryShortLink,
          });
        }

        return true;
      },
    },
    {
      name: "alias",
      description: "Set an alias for a command",
      minLevel: PermissionLevel.NONE,

      handler({ rest, sender, database }) {
        if (!rest) {
          // List user's aliases
          if (!userCommandAliases.has(sender)) {
            return "You have no aliases set";
          }

          let msg = "Your aliases:";

          for (const [alias, command] of userCommandAliases.get(sender)!) {
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
          [sender, alias, command],
        );

        if (!userCommandAliases.has(sender)) {
          userCommandAliases.set(sender, new Map());
        }

        userCommandAliases.get(sender)!.set(alias, command);

        return true;
      },
    },
    {
      name: "unalias",
      description: "Remove an alias",
      minLevel: PermissionLevel.NONE,

      handler({ rest, sender, database }) {
        if (!rest) {
          throw new CommandError("Usage: `/unalias <alias>`");
        }

        const userAliases = userCommandAliases.get(sender);

        if (!userAliases) {
          throw new CommandError("You have no aliases set");
        }

        if (!userAliases.has(rest)) {
          return `Alias \`${rest}\` not found`;
        }

        database!.run<[string, string]>(
          "DELETE FROM aliases WHERE user = ? AND alias = ?",
          [sender, rest],
        );

        userAliases.delete(rest);

        if (userAliases.size === 0) {
          userCommandAliases.delete(sender);
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
    // Configure database
    database!.run(`\
CREATE TABLE IF NOT EXISTS aliases (
  user TEXT NOT NULL,
  alias TEXT NOT NULL,
  command TEXT NOT NULL,
  PRIMARY KEY (user, alias)
);
`);

    // Load user command aliases
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

  async onMessageReaction({ reaction, message, permissionLevel }) {
    if (
      reaction.reaction === "\u{1F5D1}\u{FE0F}" &&
      // Only allow deleting messages from the bot
      message.fromMe &&
      // Only trusted users can delete messages
      permissionLevel >= PermissionLevel.TRUSTED
    ) {
      await message.delete(true);
    }
  },
};

// Load plugins
loadPlugin(corePlugin);
await loadPluginsFromConfig();

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: config.visible ? false : undefined,
    args:
      process.env.CODESPACES === "true"
        ? ["--no-sandbox", "--disable-setuid-sandbox"]
        : undefined,
  },
});

client.on("qr", (qr) => {
  consola.info("QR code received", qr);
  generate(qr, { small: true }, (qrcode) => {
    consola.info(qrcode);
  });

  // TODO: qrcode-terminal not working
});

const messagesById = new Map<string, Message>();

async function getMessageById(id: string | MessageId) {
  if (typeof id !== "string") {
    id = id._serialized;
  }

  const cachedMessage = messagesById.get(id);
  if (cachedMessage) {
    return cachedMessage;
  }

  const messageById = await client.getMessageById(id).catch(() => null);
  if (messageById) {
    if (!messagesById.has(id)) {
      messagesById.set(id, messageById);
    }

    return messageById;
  }

  return null;
}

const clientReadyPromise = Promise.withResolvers<void>();

client.on("ready", async () => {
  consola.ready("Client ready");

  clientReadyPromise.resolve();
});

client.on("auth_failure", (message) => {
  clientReadyPromise.reject(new Error(message));
});

await client.initialize();

await clientReadyPromise.promise;

// Fire plugin onLoad events
for (const plugin of plugins) {
  if (plugin.onLoad) {
    consola.debug("Running plugin onLoad:", plugin.id);

    await plugin.onLoad({
      client,
      logger: plugin._logger,
      config,

      database: plugin._db,
      server,

      generateTemporaryShortLink,
    });

    consola.debug("Plugin onLoad done:", plugin.id);
  }
}

process.on("SIGINT", stopGracefully);

const interactionContinuations = new Map<
  string,
  Interaction & {
    _data: unknown;
    _plugin: InternalPlugin;
    _timeout: Timer;
  }
>();

client.on("message", async (message) => {
  messagesById.set(message.id._serialized, message);

  if (!message.body) {
    return;
  }

  // Ignore messages that are older than 30 seconds
  if (Date.now() - message.timestamp * 1000 > 30 * 1000) {
    return;
  }

  const sender = message.author || message.from;
  const chat = await message.getChat();

  const permissionLevel = Math.max(
    getPermissionLevel(sender),
    getPermissionLevel(chat.id._serialized),
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
    messageSenderId: sender,
    messageBody: message.body,
    permissionLevel,
    rateLimit,
  });

  let hasCheckedUserRateLimit = false;

  let [, command, rest] = message.body.match(/^\/(\w+)\s*(.*)?$/is) || [];
  rest ||= "";

  async function getGoogleClient(scope: string | string[]) {
    return (await getClient(sender, scope, (url) => {
      client.sendMessage(
        sender,
        `Please login with Google using the link below:\n${url}`,
        { linkPreview: false },
      );

      throw new CommandError(
        `please login with Google using the link sent to you privately`,
      );
    }))!;
  }

  const quotedMsg = message.hasQuotedMsg
    ? await message.getQuotedMessage()
    : null;
  if (quotedMsg && interactionContinuations.has(quotedMsg.id._serialized)) {
    consola.debug("Interaction continuation found:", quotedMsg.id);

    try {
      chat.sendSeen();
      chat.sendStateTyping();

      const {
        handler: interactionContinuationHandler,
        _data,
        _plugin,
        _timeout,
      } = interactionContinuations.get(quotedMsg.id._serialized)!;

      // prevent the expiration timeout from running
      clearTimeout(_timeout);

      // delete the interaction continuation to prevent it from being used again
      interactionContinuations.delete(quotedMsg.id._serialized);

      const result = await interactionContinuationHandler({
        message,
        rest: message.body,
        sender,
        chat,

        permissionLevel,

        client,
        logger: _plugin._logger.withDefaults({
          tag: `${_plugin.id}:${interactionContinuationHandler.name}`,
        }),
        config,

        database: _plugin._db,

        data: _data,

        generateTemporaryShortLink,
        getGoogleClient,
      });

      await handleInteractionResult(result, message, _plugin);
    } catch (err) {
      await handleError(err, message);
    }
  } else if (command) {
    consola.info("Command received:", { command, rest });

    if (isUserRateLimited(sender, rateLimit)) {
      consola.info("User rate limited at command:", sender);
      return;
    }
    hasCheckedUserRateLimit = true;

    const cmd = resolveCommand(command, sender);

    if (cmd) {
      chat.sendSeen();

      if (
        isCommandRateLimited(
          sender,
          cmd.plugin.id,
          cmd.name,
          cmd.rateLimit ?? 0,
        )
      ) {
        await message.react("\u23F3");
      } else {
        chat.sendStateTyping();

        if (permissionLevel >= cmd.minLevel) {
          try {
            const result = await cmd.handler({
              message,
              rest,
              sender,
              chat,

              permissionLevel,

              client,
              logger: cmd._logger,
              config,

              database: cmd.plugin._db,

              data: null,

              generateTemporaryShortLink,
              getGoogleClient,
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
      await message.reply(`Unknown command \`${command}\``);
    }
  }

  for (const plugin of plugins) {
    if (plugin.onMessage) {
      if (!hasCheckedUserRateLimit) {
        if (isUserRateLimited(sender, rateLimit)) {
          consola.info("User rate limited at onMessage:", sender);
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
        chat,
        sender,
        permissionLevel,

        generateTemporaryShortLink,
      });

      await handleInteractionResult(result, message, plugin);
    }
  }
});

client.on("message_reaction", async (reaction) => {
  if (reaction.id.fromMe) {
    return;
  }

  // Lazy load the message and chat objects
  let message: Message | null = null;
  let chat: Chat | null = null;

  const permissionLevel = getPermissionLevel(reaction.senderId);

  consola.debug("Message reaction received:", {
    reaction,
    permissionLevel,
  });

  for (const plugin of plugins) {
    if (plugin.onMessageReaction) {
      if (!message) {
        message = await getMessageById(reaction.msgId);

        if (!message) {
          consola.error("Message not found for reaction:", reaction);
          return;
        }
      }

      if (!chat) {
        chat = await message.getChat();
      }

      consola.debug("Running plugin onMessageReaction:", plugin.id);

      const result = await plugin.onMessageReaction({
        client,
        logger: plugin._logger,
        config,

        database: plugin._db,

        message,
        chat,
        sender: reaction.senderId,
        permissionLevel,

        reaction,

        generateTemporaryShortLink,
      });

      consola.debug("Handling interaction result:", {
        pluginId: plugin.id,
        result,
      });

      await handleInteractionResult(result, message, plugin);

      consola.debug("Interaction result handled:", plugin.id);
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
    const reply = await message.reply(result.message);

    const interactionContinuationHandler =
      plugin.interactions?.[result.handler];

    if (interactionContinuationHandler) {
      // expire continuations after 5 minutes
      const _timeout = setTimeout(
        async () => {
          await message.react("\u231B");

          interactionContinuations.delete(reply.id._serialized);
        },
        5 * 60 * 1000,
      );

      interactionContinuations.set(reply.id._serialized, {
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
    if (typeof result === "string") {
      await message.reply(result, undefined, {
        linkPreview: false,
      });
    } else if (result === true) {
      await message.react("\u{1F44D}");
    } else if (result === false) {
      await message.react("\u{1F44E}");
    }
  }
}

async function handleError(error: unknown, message: Message) {
  await message.react("\u274C");

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
    await message.reply(
      `Error: ${(error as CommandError).message}`,
      undefined,
      { linkPreview: false },
    );
  } else {
    consola.error("Error while handling command:", error);

    await message.reply(
      `Error:\n\`\`\`\n${Bun.inspect(error, { colors: false })}\`\`\``,
      undefined,
      { linkPreview: false },
    );
  }
}

async function stopGracefully() {
  consola.info("Graceful stop triggered");

  for (const plugin of plugins) {
    if (plugin.onUnload) {
      consola.debug("Unloading plugin on graceful stop:", plugin.id);

      await plugin.onUnload({
        client,
        logger: plugin._logger,
        config,

        database: plugin._db,

        generateTemporaryShortLink,
      });

      consola.debug("Plugin onUnload done:", plugin.id);
    }
  }

  await stop();
}

async function stop() {
  consola.debug("Removing SIGINT listener");
  process.off("SIGINT", stopGracefully);

  consola.debug("Waiting a second before closing client on stop");
  await Bun.sleep(1000);

  consola.debug("Destroying client on stop");
  await client.destroy();

  consola.debug("Stopping server");
  await server.stop();

  consola.debug("Closing plugins' databases");
  for (const plugin of plugins) {
    plugin._db?.close();
  }
}
