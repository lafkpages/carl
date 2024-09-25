import type { ConsolaInstance } from "consola";
import type { Chat, Message } from "whatsapp-web.js";
import type {
  _PluginApis,
  Command,
  GetGoogleClient,
  Interaction,
  InteractionResult,
  InteractionResultGenerator,
  PluginDefinition,
  PluginExports,
} from "./plugins";

import "./sentry";

import type { RateLimit, RateLimitEvent } from "./ratelimits";

import { captureException } from "@sentry/bun";
import { Database } from "bun:sqlite";
import { consola } from "consola";
import { generate } from "qrcode-terminal";
import { LocalAuth, MessageMedia } from "whatsapp-web.js";

import { getConfig, initialConfig, setPluginConfig } from "./config";
import { CommandError, CommandPermissionError } from "./error";
import { getClient } from "./google";
import { generateHelp, generateHelpPage } from "./help";
import { getPermissionLevel, PermissionLevel } from "./perms";
import { InteractionContinuation, scanPlugins } from "./plugins";
import {
  checkRateLimit,
  getPermissionLevelRateLimits,
  rateLimit,
} from "./ratelimits";
import { generateTemporaryShortLink, server } from "./server";
import {
  getMessageSender,
  isInGithubCodespace,
  sendMessageToAdmins,
} from "./utils";

const { Client } =
  require("whatsapp-web.js") as typeof import("whatsapp-web.js");

if (!process.isBun) {
  consola.fatal("WhatsApp PA must be run with Bun");
  process.exit(1);
}

interface InternalPlugin<PluginId extends string = string>
  extends PluginDefinition<PluginId> {
  _logger: ConsolaInstance;
  _db: Database | null;

  _unload(runOnUnload?: boolean): Promise<void>;
}
interface InternalCommand<PluginId extends string> extends Command<PluginId> {
  plugin: InternalPlugin<PluginId>;
  _logger: ConsolaInstance;
}

const commands = new Map<string, InternalCommand<string>>();
const plugins: {
  [PluginId in string]: InternalPlugin<PluginId>;
} = {};
const pluginApis: Partial<_PluginApis> = {};
let pluginsDir = await scanPlugins();

const userCommandAliases = new Map<string, Map<string, string>>();

function loadPlugin(plugin: PluginExports<string>) {
  consola.info("Loading plugin:", plugin.default.id);
  consola.debug("Loading plugin:", plugin);

  if (plugin.config) {
    // If the plugin has config, it will be declared
    // on PluginsConfig so the type assertion is safe
    setPluginConfig(plugin.default.id, plugin.config);
  }

  const _logger = consola.withDefaults({
    tag: plugin.default.id,
  });

  const _db = plugin.default.database
    ? new Database(`db/plugins/${plugin.default.id}.sqlite`, { strict: true })
    : null;
  _db?.exec("PRAGMA journal_mode = WAL;");

  const _plugin: InternalPlugin = {
    ...plugin.default,
    _logger,
    _db,
    async _unload(runOnUnload = true) {
      consola.info("Unloading plugin:", this.id);

      delete plugins[this.id];
      this._db?.close();

      for (const [commandName, command] of commands) {
        if (command.plugin === this) {
          commands.delete(commandName);
        }
      }

      if (runOnUnload && this.onUnload) {
        await this.onUnload({
          api: pluginApis[this.id] || {},
          pluginApis,
          client,
          logger: this._logger,
          config: getConfig().pluginsConfig[this.id],

          database: this._db,

          generateTemporaryShortLink,
        });
      }
    },
  };

  // Set config before storing plugin because setPluginConfig
  // may throw an error if the config is invalid

  plugins[plugin.default.id] = _plugin;
  pluginApis[plugin.default.id] = plugin.api;

  if (plugin.default.commands) {
    for (const cmd of plugin.default.commands) {
      const existingCommand = commands.get(cmd.name);
      if (existingCommand) {
        consola.error("Duplicate command, dupe not loaded", {
          cmdName: cmd.name,
          existingPlugin: existingCommand.plugin.id,
          newPlugin: plugin.default.id,
        });

        continue;
      }

      commands.set(cmd.name, {
        ...cmd,
        plugin: _plugin,
        _logger: _logger.withDefaults({
          tag: `${plugin.default.id}/${cmd.name}`,
        }),
      });
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

    consola.info("Importing plugin:", pluginIdentifier, pluginPath);

    // add a cache buster to the import path
    // so that plugins can be reloaded
    const plugin: PluginExports<typeof pluginIdentifier> = await import(
      `${pluginPath}?${now}`
    );

    if (plugin.default.id !== pluginIdentifier) {
      consola.error("Plugin ID does not match plugin file name.", {
        pluginId: plugin.default.id,
        pluginIdentifier,
      });
      continue;
    }

    try {
      loadPlugin(plugin);
    } catch (err) {
      consola.error(`Error loading plugin "${pluginIdentifier}":`, err);
    }
  }
}

const corePlugin = {
  default: {
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
            generateHelp(Object.values(plugins), permissionLevel, showHidden),
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

          const pluginIdsToReload = rest ? new Set(rest.split(/[,\s]+/)) : null;

          if (pluginIdsToReload?.size === 0) {
            return false;
          }

          if (pluginIdsToReload?.has("core")) {
            throw new CommandError("cannot reload core plugin");
          }

          pluginsDir = await scanPlugins();

          const pluginsToReload: InternalPlugin[] = pluginIdsToReload
            ? []
            : Object.values(plugins);

          if (pluginIdsToReload) {
            for (const pluginId of pluginIdsToReload) {
              if (!pluginsDir.has(pluginId)) {
                throw new CommandError(`plugin \`${pluginId}\` not found`);
              }

              let loaded = false;
              for (const plugin in plugins) {
                if (plugin === pluginId) {
                  loaded = true;
                  pluginsToReload.push(plugins[plugin]);
                  break;
                }
              }

              if (!loaded) {
                throw new CommandError(`plugin \`${pluginId}\` not loaded`);
              }
            }
          }

          const config = getConfig();

          // Unload plugins
          for (const plugin of pluginsToReload) {
            await plugin._unload();
          }

          // Reload plugins
          await loadPluginsFromConfig(pluginIdsToReload);

          // Fire plugin onLoad events
          for (const plugin of pluginsToReload) {
            await plugin.onLoad?.({
              api: pluginApis[plugin.id] || {},
              pluginApis,
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
  },
} satisfies PluginExports<"core">;

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
for (const plugin of Object.values(plugins)) {
  if (plugin.onLoad) {
    consola.debug("Running plugin onLoad:", plugin.id);

    await plugin.onLoad({
      api: pluginApis[plugin.id] || {},
      pluginApis,
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

interface InternalInteraction<Data, PluginId extends string>
  extends Interaction<Data, PluginId> {
  _data: unknown;
  _plugin: InternalPlugin;
  _timeout: Timer;
}

const interactionContinuations = new Map<
  string,
  InternalInteraction<unknown, string>
>();

client.on("message", async (message) => {
  if (!message.body) {
    return;
  }

  // Ignore messages that are older than 30 seconds
  if (Date.now() - message.timestamp * 1000 > 30 * 1000) {
    return;
  }

  const sender = getMessageSender(message);
  const chat = await message.getChat();

  const config = getConfig();

  const permissionLevel = getPermissionLevel(sender, chat.id);

  const userRateLimits = getPermissionLevelRateLimits(permissionLevel);

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

  let didHandle = false;

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

        api: pluginApis[_plugin.id] || {},
        pluginApis,
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

    didHandle = true;
  } else if (command) {
    consola.info("Command received:", { command, rest, sender });

    const cmd = resolveCommand(command, sender);

    if (cmd) {
      await execute(
        cmd,
        rest,
        message,
        chat,
        rateLimitEvent,
        userRateLimits,
        getGoogleClient,
      );
    } else {
      await handleError(
        new CommandError(`unknown command: \`${command}\``),
        message,
      );
    }

    didHandle = true;
  }

  for (const plugin of Object.values(plugins)) {
    if (plugin.onMessage) {
      if (checkRateLimit(sender, userRateLimits)) {
        consola.info("User rate limited at onMessage:", sender);
        return;
      }

      if (rateLimitEvent.plugin) {
        rateLimit(sender, {
          ...rateLimitEvent,
          plugin: plugin.id,
        });
      } else {
        rateLimitEvent.plugin = plugin.id;
      }

      consola.debug("Running plugin onMessage:", plugin.id);

      try {
        const result = await plugin.onMessage({
          api: pluginApis[plugin.id] || {},
          pluginApis,
          client,
          logger: plugin._logger,
          config: config.pluginsConfig[plugin.id],

          database: plugin._db,

          message,
          chat,
          sender,
          permissionLevel,

          didHandle,

          generateTemporaryShortLink,
        });

        await handleInteractionResult(result, message, plugin);
      } catch (err) {
        await handleError(err, message);
      }
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

  for (const plugin of Object.values(plugins)) {
    if (plugin.onMessageReaction) {
      if (!message) {
        message = await client
          .getMessageById(reaction.msgId._serialized)
          .catch(() => null);

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
        api: pluginApis[plugin.id] || {},
        pluginApis,
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

async function execute(
  command: InternalCommand<string>,
  rest: string,
  message: Message,
  chat: Chat,
  rateLimitEvent: RateLimitEvent,
  userRateLimits: RateLimit[],
  getGoogleClient: GetGoogleClient,
) {
  const sender = getMessageSender(message);
  const permissionLevel = getPermissionLevel(sender, chat.id);

  await chat.sendSeen();

  const commandRateLimits = command.rateLimit
    ? [...userRateLimits, ...command.rateLimit]
    : userRateLimits;

  if (
    checkRateLimit(sender, commandRateLimits, command.plugin.id, command.name)
  ) {
    await message.react("\u23F3");
  } else {
    rateLimitEvent.plugin = command.plugin.id;
    rateLimitEvent.command = command.name;

    chat.sendStateTyping();

    if (permissionLevel >= command.minLevel) {
      try {
        const result = await command.handler({
          message,
          rest,
          sender,
          chat,

          permissionLevel,

          api: pluginApis[command.plugin.id] || {},
          pluginApis,
          client,
          logger: command._logger,
          config: getConfig().pluginsConfig[command.plugin.id],

          database: command.plugin._db,

          data: null as never,

          generateTemporaryShortLink,
          getGoogleClient,
        });

        await handleInteractionResult(result, message, command.plugin);
      } catch (err) {
        await handleError(err, message, null, command);
      }
    } else {
      await handleError(
        new CommandPermissionError(command.name, command.minLevel),
        message,
      );
    }
  }
}

function resolveCommand(command: string, user?: string) {
  const cmd = commands.get(command);
  if (cmd) {
    return cmd;
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
  result: InteractionResult | InteractionResultGenerator,
  message: Message,
  plugin: InternalPlugin,
  _editMessage?: Message | null,
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
    if (typeof result === "string" || result instanceof MessageMedia) {
      if (_editMessage) {
        return await _editMessage.edit(result, { linkPreview: false });
      } else {
        return await message.reply(result, undefined, {
          linkPreview: false,
        });
      }
    } else if (result === true) {
      await message.react("\u{1F44D}");
    } else if (result === false) {
      await message.react("\u{1F44E}");
    } else if (result) {
      if (_editMessage) {
        throw new Error("cannot iterate generator inside generator");
      }

      let newMessage: Message | null = null;

      while (true) {
        const { done, value } = await result.next(newMessage);

        if (done) {
          await handleInteractionResult(value, message, plugin, newMessage);
          break;
        }

        const _newMessage = await handleInteractionResult(
          value,
          message,
          plugin,
          newMessage,
        );
        if (_newMessage) {
          newMessage = _newMessage;
        }
      }
    }
  }
}

async function handleError(
  error: unknown,
  message: Message,
  interactionContinuationMessage?: Message | null,
  command?: InternalCommand<string> | null,
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

  for (const plugin of Object.values(plugins)) {
    if (plugin.onUnload) {
      consola.debug("Unloading plugin on graceful stop:", plugin.id);

      await plugin.onUnload({
        api: pluginApis[plugin.id] || {},
        pluginApis,
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
  for (const plugin of Object.values(plugins)) {
    plugin._db?.close();
  }
}
