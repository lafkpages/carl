import type { ConsolaInstance } from "consola";
import type { Chat, Message, MessageId } from "whatsapp-web.js";
import type {
  Command,
  Interaction,
  InteractionResult,
  InternalPlugin,
  Plugin,
} from "./plugins";

import "./sentry";

import type { RateLimit } from "./ratelimits";

import { captureException } from "@sentry/bun";
import { Database } from "bun:sqlite";
import { consola } from "consola";
import { generate } from "qrcode-terminal";
import { LocalAuth } from "whatsapp-web.js";

import { getConfig, initialConfig } from "./config";
import { CommandError, CommandPermissionError } from "./error";
import { getClient } from "./google";
import { generateHelp, generateHelpPage } from "./help";
import { getPermissionLevel, PermissionLevel } from "./perms";
import plugin, { InteractionContinuation, scanPlugins } from "./plugins";
import { checkRateLimit, rateLimit } from "./ratelimits";
import { generateTemporaryShortLink, server } from "./server";
import { isInGithubCodespace, sendMessageToAdmins } from "./utils";

const { Client } =
  require("whatsapp-web.js") as typeof import("whatsapp-web.js");

if (!process.isBun) {
  consola.fatal("WhatsApp PA must be run with Bun");
  process.exit(1);
}

interface InternalCommand<TPlugin extends InternalPlugin>
  extends Command<TPlugin> {
  plugin: TPlugin;
  _logger: ConsolaInstance;
}
const commands: Record<string, InternalCommand<InternalPlugin>> = {};
const plugins: InternalPlugin[] = [];
let pluginsDir = await scanPlugins();

const userCommandAliases = new Map<string, Map<string, string>>();

function loadPlugin(plugin: Plugin) {
  consola.info("Loading plugin:", plugin.id);
  consola.debug("Loading plugin:", plugin);

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

  const config = getConfig();

  for (const pluginIdentifier of idsToLoad || config.plugins) {
    const pluginPath = pluginsDir.get(pluginIdentifier);

    if (!pluginPath) {
      consola.error("Plugin not found:", pluginIdentifier);
      continue;
    }

    consola.info("Importing plugin:", pluginIdentifier);

    // add a cache buster to the import path
    // so that plugins can be reloaded
    const plugin: Plugin = (await import(`${pluginPath}?${now}`)).default;

    if (plugin.id !== pluginIdentifier) {
      consola.error("Plugin ID does not match plugin file name.", {
        pluginId: plugin.id,
        pluginIdentifier,
      });
      continue;
    }

    loadPlugin(plugin);
  }
}

const corePlugin: Plugin = plugin({
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

      handler({ rest, permissionLevel }) {
        const numbers = rest.match(/\d+/g);

        if (numbers && numbers.length > 1) {
          throw new CommandError("invalid arguments. Usage: `/help [page]`");
        }

        const page = parseInt(numbers?.[0] || "1");
        const showHidden = rest.includes("all");

        if (page < 1) {
          throw new CommandError("page number must be greater than 0");
        }

        return generateHelpPage(
          generateHelp(plugins, permissionLevel, showHidden),
          page,
        );
      },
    },
    {
      name: "stop",
      description: "Stop the bot gracefully",
      minLevel: PermissionLevel.ADMIN,

      handler() {
        stopGracefully();
        return true;
      },
    },
    {
      name: "forcestop",
      description: "Stop the bot without unloading plugins",
      minLevel: PermissionLevel.ADMIN,

      handler() {
        stop();
        return true;
      },
    },
    {
      name: "reload",
      description: "Reload plugins",
      minLevel: PermissionLevel.ADMIN,

      async handler({ rest, logger }) {
        rest = rest.trim().toLowerCase();

        const pluginsToReload = rest ? new Set(rest.split(/[,\s]+/)) : null;

        if (pluginsToReload?.size === 0) {
          return false;
        }

        if (pluginsToReload?.has("core")) {
          throw new CommandError("cannot reload core plugin");
        }

        pluginsDir = await scanPlugins();

        if (pluginsToReload) {
          for (const pluginId of pluginsToReload) {
            if (!pluginsDir.has(pluginId)) {
              throw new CommandError(`plugin \`${pluginId}\` not found`);
            }

            if (!plugins.some((plugin) => plugin.id === pluginId)) {
              throw new CommandError(`plugin \`${pluginId}\` not loaded`);
            }
          }
        }

        const config = getConfig();

        // Run plugin onUnload events
        for (const plugin of plugins) {
          if (pluginsToReload && !pluginsToReload.has(plugin.id)) {
            continue;
          }

          if (plugin.onUnload) {
            logger.info("Unloading plugin:", plugin.id);

            await plugin.onUnload({
              api: plugin.api || {},
              client,
              logger: plugin._logger,
              config: config.pluginsConfig[plugin.id],

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
        if (!pluginsToReload) {
          loadPlugin(corePlugin);
        }
        await loadPluginsFromConfig(pluginsToReload);

        // Fire plugin onLoad events
        for (const plugin of plugins) {
          if (pluginsToReload && !pluginsToReload.has(plugin.id)) {
            continue;
          }

          await plugin.onLoad?.({
            api: plugin.api || {},
            client,
            logger: plugin._logger,
            config: config.pluginsConfig[plugin.id],

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
});

// Load plugins
loadPlugin(corePlugin);
await loadPluginsFromConfig();

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: initialConfig.visible ? false : undefined,
    args: isInGithubCodespace
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
      api: plugin.api || {},
      client,
      logger: plugin._logger,
      config: initialConfig.pluginsConfig[plugin.id],

      database: plugin._db,
      server,

      generateTemporaryShortLink,
    });

    consola.debug("Plugin onLoad done:", plugin.id);
  }
}

process.on("SIGINT", stopGracefully);

interface InternalInteraction<TPlugin extends InternalPlugin>
  extends Interaction<TPlugin> {
  _data: unknown;
  _plugin: InternalPlugin;
  _timeout: Timer;
}

const interactionContinuations = new Map<
  string,
  InternalInteraction<InternalPlugin>
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

  const config = getConfig();

  const permissionLevel = Math.max(
    getPermissionLevel(sender),
    getPermissionLevel(chat.id._serialized),
  );

  const userRateLimits: RateLimit[] =
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
  });

  const rateLimitEvent = rateLimit(sender, { points: 1 });

  let [, command, rest] = message.body.match(/^\/(\w+)\s*(.*)?$/is) || [];
  rest ||= "";

  async function getGoogleClient(scope: string | string[]) {
    return (await getClient(sender, scope, (url) => {
      if (chat.id._serialized === sender) {
        throw new CommandError(
          `please login with Google using the link below:\n${url}`,
        );
      } else {
        client.sendMessage(
          sender,
          `Please login with Google using the link below:\n${url}`,
          { linkPreview: false },
        );

        throw new CommandError(
          `please login with Google using the link sent to you privately`,
        );
      }
    }))!;
  }

  const quotedMsg = message.hasQuotedMsg
    ? await message.getQuotedMessage()
    : null;
  if (quotedMsg && interactionContinuations.has(quotedMsg.id._serialized)) {
    consola.debug("Interaction continuation found:", quotedMsg.id);

    try {
      await chat.sendSeen();
      await chat.sendStateTyping();

      const {
        handler: interactionContinuationHandler,
        _data,
        _plugin,
      } = interactionContinuations.get(quotedMsg.id._serialized)!;

      const result = await interactionContinuationHandler({
        message,
        rest: message.body,
        sender,
        chat,

        permissionLevel,

        api: _plugin.api || {},
        client,
        logger: _plugin._logger.withDefaults({
          tag: `${_plugin.id}:${interactionContinuationHandler.name}`,
        }),
        config: config.pluginsConfig[_plugin.id],

        database: _plugin._db,

        data: _data,

        generateTemporaryShortLink,
        getGoogleClient,
      });

      await handleInteractionResult(result, message, _plugin);
      await cleanupInteractionContinuation(quotedMsg);
    } catch (err) {
      await handleError(err, message, quotedMsg);
    }
  } else if (command) {
    consola.info("Command received:", { command, rest });

    const cmd = resolveCommand(command, sender);

    if (cmd) {
      await chat.sendSeen();

      const commandRateLimits = cmd.rateLimit
        ? [...userRateLimits, ...cmd.rateLimit]
        : userRateLimits;

      if (checkRateLimit(sender, commandRateLimits, cmd.plugin.id, cmd.name)) {
        await message.react("\u23F3");
      } else {
        rateLimitEvent.plugin = cmd.plugin.id;
        rateLimitEvent.command = cmd.name;

        chat.sendStateTyping();

        if (permissionLevel >= cmd.minLevel) {
          try {
            const result = await cmd.handler({
              message,
              rest,
              sender,
              chat,

              permissionLevel,

              api: cmd.plugin.api || {},
              client,
              logger: cmd._logger,
              config: config.pluginsConfig[cmd.plugin.id],

              database: cmd.plugin._db,

              data: null,

              generateTemporaryShortLink,
              getGoogleClient,
            });

            await handleInteractionResult(result, message, cmd.plugin);
          } catch (err) {
            await handleError(err, message, null, cmd);
          }
        } else {
          await handleError(
            new CommandPermissionError(command, cmd.minLevel),
            message,
          );
        }
      }
    } else {
      await handleError(
        new CommandError(`unknown command: \`${command}\``),
        message,
      );
    }
  }

  for (const plugin of plugins) {
    if (plugin.onMessage) {
      if (checkRateLimit(sender, userRateLimits)) {
        consola.info("User rate limited at onMessage:", sender);
        return;
      }
      rateLimitEvent.plugin = plugin.id;

      consola.debug("Running plugin onMessage:", plugin.id);

      const result = await plugin.onMessage({
        api: plugin.api || {},
        client,
        logger: plugin._logger,
        config: config.pluginsConfig[plugin.id],

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

  // Ignore reactions that are older than 30 seconds
  if (Date.now() - reaction.timestamp * 1000 > 30 * 1000) {
    return;
  }

  // Lazy load the message and chat objects
  let message: Message | null = null;
  let chat: Chat | null = null;

  const config = getConfig();

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
        api: plugin.api || {},
        client,
        logger: plugin._logger,
        config: config.pluginsConfig[plugin.id],

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

  const config = getConfig();

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
  if (result instanceof InteractionContinuation) {
    const reply = await message.reply(result.message);
    reply.react("\u{1F4AC}");

    const interactionContinuationHandler =
      plugin.interactions?.[result.handler];

    if (interactionContinuationHandler) {
      // expire continuations after 5 minutes
      const _timeout = setTimeout(
        async () => {
          await message.react("");
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

async function handleError(
  error: unknown,
  message: Message,
  interactionContinuationMessage?: Message | null,
  command?: InternalCommand<InternalPlugin> | null,
) {
  await message.react("\u274C");

  if (error instanceof CommandError) {
    const commandError = error as CommandError;

    await message.reply(`Error: ${commandError.message}`, undefined, {
      linkPreview: false,
    });

    if (
      !commandError._preserveInteractionContinuation &&
      interactionContinuationMessage
    ) {
      await cleanupInteractionContinuation(interactionContinuationMessage);
    }
  } else {
    consola.error("Error while handling command:", error);

    captureException(error, {
      user: {
        whatsappFrom: message.from,
        whatsappAuthor: message.author,
      },
    });

    await message.reply(
      `Error:\n\`\`\`\n${Bun.inspect(error, { colors: false })}\`\`\``,
      undefined,
      { linkPreview: false },
    );

    if (interactionContinuationMessage) {
      await cleanupInteractionContinuation(interactionContinuationMessage);
    }

    if (command) {
      await sendMessageToAdmins(
        client,
        `\
Error while handling command \`${command.plugin.id}\`/\`${command.name}\`:
\`\`\`
${Bun.inspect(error, { colors: false })}\`\`\``,
      );
    }
  }
}

async function cleanupInteractionContinuation(message: Message) {
  const interactionContinuation = interactionContinuations.get(
    message.id._serialized,
  );

  if (!interactionContinuation) {
    throw new Error("Interaction continuation not found");
  }

  // prevent the expiration timeout from running
  clearTimeout(interactionContinuation._timeout);

  // delete the interaction continuation to prevent it from being used again
  interactionContinuations.delete(message.id._serialized);

  // remove the indicator reaction
  await message.react("");
}

async function stopGracefully() {
  consola.info("Graceful stop triggered");

  const config = getConfig();

  for (const plugin of plugins) {
    if (plugin.onUnload) {
      consola.debug("Unloading plugin on graceful stop:", plugin.id);

      await plugin.onUnload({
        api: plugin.api || {},
        client,
        logger: plugin._logger,
        config: config.pluginsConfig[plugin.id],

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
