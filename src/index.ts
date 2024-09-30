import type { Chat, Message } from "whatsapp-web.js";
import type { InteractionResult, InteractionResultGenerator } from "./plugins";

import { InteractionContinuation, Plugin } from "./plugins";

import "./sentry";

import type { InternalCommand } from "./pluginsManager";
import type { RateLimit, RateLimitEvent } from "./ratelimits";

import { captureException } from "@sentry/bun";
import { consola } from "consola";
import { generate } from "qrcode-terminal";
import { LocalAuth, MessageMedia } from "whatsapp-web.js";

import { getConfig, initialConfig } from "./config";
import { CommandError, CommandPermissionError } from "./error";
import { generateHelp, generateHelpPage } from "./help";
import { getPermissionLevel, PermissionLevel } from "./perms";
import { PluginsManager } from "./pluginsManager";
import {
  checkRateLimit,
  getPermissionLevelRateLimits,
  rateLimit,
} from "./ratelimits";
import { server } from "./server";
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

const userCommandAliases = new Map<string, Map<string, string>>();

class CorePlugin extends Plugin<"core"> {
  id = "core" as const;
  name = "Core";
  description = "Core commands";
  version = "1.0.0";
  database = true;

  constructor() {
    super();

    this.registerCommands([
      {
        name: "help",
        description:
          "Shows this help message (use `/help all` to show hidden commands)",
        minLevel: PermissionLevel.NONE,

        handler({ data, permissionLevel }) {
          const numbers = data.match(/\d+/g);

          if (numbers && numbers.length > 1) {
            throw new CommandError("invalid arguments. Usage: `/help [page]`");
          }

          const page = parseInt(numbers?.[0] || "1");
          const showHidden = data.includes("all");

          if (page < 1) {
            throw new CommandError("page number must be greater than 0");
          }

          return generateHelpPage(
            generateHelp(pluginsManager, permissionLevel, showHidden),
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

        async handler({ data }) {
          data = data.trim().toLowerCase();

          const pluginIdsToReload = data ? new Set(data.split(/[,\s]+/)) : null;

          if (pluginIdsToReload?.size === 0) {
            return false;
          }

          if (pluginIdsToReload?.has("core")) {
            throw new CommandError("cannot reload core plugin");
          }

          await pluginsManager.scanPlugins();

          if (!pluginIdsToReload) {
            for (const plugin of pluginsManager) {
              if (plugin.id === "core") {
                continue;
              }

              await pluginsManager.unloadPlugin(plugin.id);
            }
            await pluginsManager.loadPlugins(getConfig().plugins);
            return true;
          }

          const config = getConfig();

          // Unload plugins
          for (const plugin of pluginIdsToReload) {
            await pluginsManager.unloadPlugin(plugin);
          }

          // Reload plugins
          await pluginsManager.loadPlugins(pluginIdsToReload);

          // Fire plugin onLoad events
          for (const pluginId of pluginIdsToReload) {
            const plugin = pluginsManager.getPlugin(pluginId);

            if (!plugin) {
              throw new Error(`Plugin ${pluginId} not found (unreachable)`);
            }

            await plugin.run("load", {
              server,
            });
          }

          return true;
        },
      },
      {
        name: "alias",
        description: "Set an alias for a command",
        minLevel: PermissionLevel.NONE,

        handler({ data, sender }) {
          if (!data) {
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

          const [, alias, command] = data.match(/^\/?(.+)\s+\/?(.+)$/) || [];

          if (!alias) {
            throw new CommandError("Usage: `/alias <alias> <command>`");
          }

          this.db.run<[string, string, string]>(
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

        handler({ data, sender }) {
          if (!data) {
            throw new CommandError("Usage: `/unalias <alias>`");
          }

          const userAliases = userCommandAliases.get(sender);

          if (!userAliases) {
            throw new CommandError("You have no aliases set");
          }

          if (!userAliases.has(data)) {
            return `Alias \`${data}\` not found`;
          }

          this.db.run<[string, string]>(
            "DELETE FROM aliases WHERE user = ? AND alias = ?",
            [sender, data],
          );

          userAliases.delete(data);

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

        handler({ data }) {
          if (!data) {
            throw new CommandError("Usage: `/resolvecommand <command>`");
          }

          const cmd = resolveCommand(data);

          if (cmd) {
            return `Command \`${data}\` resolves to \`${cmd._plugin.id}/${cmd.name}\``;
          } else {
            return false;
          }
        },
      },
    ]);

    this.on("load", () => {
      // Configure database
      this.db.run(`--sql
        CREATE TABLE IF NOT EXISTS aliases (
          user TEXT NOT NULL,
          alias TEXT NOT NULL,
          command TEXT NOT NULL,
          PRIMARY KEY (user, alias)
        );
      `);

      // Load user command aliases
      const aliasEntries = this.db
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
    });

    this.on("reaction", async ({ reaction, message, permissionLevel }) => {
      if (
        reaction.reaction === "\u{1F5D1}\u{FE0F}" &&
        // Only allow deleting messages from the bot
        message.fromMe &&
        // Only trusted users can delete messages
        permissionLevel >= PermissionLevel.TRUSTED
      ) {
        await message.delete(true);
      }
    });
  }
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: initialConfig.visible ? false : undefined,
    args: isInGithubCodespace
      ? ["--no-sandbox", "--disable-setuid-sandbox"]
      : undefined,
  },
});

// Load plugins
const pluginsManager = new PluginsManager(client);
pluginsManager.registerPlugin(new CorePlugin());
await pluginsManager.scanPlugins();
await pluginsManager.loadPlugins(getConfig().plugins);

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
for (const plugin of pluginsManager) {
  if (plugin.hasListeners("load")) {
    consola.debug("Running plugin onLoad:", plugin.id);

    await plugin.run("load", {
      server,
    });

    consola.debug("Plugin onLoad done:", plugin.id);
  }
}

process.on("SIGINT", stopGracefully);

const interactionContinuations = new Map<
  string,
  InteractionContinuation<unknown>
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

  let [, command, data] = message.body.match(/^\/(\w+)\s*(.*)?$/is) || [];
  data ||= "";

  let didHandle = false;

  const quotedMsg = message.hasQuotedMsg
    ? await message.getQuotedMessage()
    : null;
  if (quotedMsg && interactionContinuations.has(quotedMsg.id._serialized)) {
    consola.debug("Interaction continuation found:", quotedMsg.id);

    try {
      await chat.sendSeen();
      await chat.sendStateTyping();

      const interactionContinuation = interactionContinuations.get(
        quotedMsg.id._serialized,
      )!;

      const { handler, plugin, data } = interactionContinuation;

      if (!plugin) {
        throw new Error("Interaction continuation has no associated plugin");
      }

      const result = await handler.call(plugin, {
        message,
        sender,
        permissionLevel,
        chat,
        data,
      });

      await handleInteractionResult(result, message, plugin);
      await cleanupInteractionContinuation(quotedMsg);
    } catch (err) {
      await handleError(err, message, quotedMsg);
    }

    didHandle = true;
  } else if (command) {
    consola.info("Command received:", { command, data, sender });

    const cmd = resolveCommand(command, sender);

    if (cmd) {
      await execute(cmd, data, message, chat, rateLimitEvent, userRateLimits);
    } else {
      await handleError(
        new CommandError(`unknown command: \`${command}\``),
        message,
      );
    }

    didHandle = true;
  }

  for (const plugin of pluginsManager) {
    if (plugin.hasListeners("message")) {
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
        await plugin.run("message", {
          message,
          chat,
          sender,
          permissionLevel,

          didHandle,
          async respond(result) {
            return await handleInteractionResult(result, message, plugin);
          },
        });
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

  for (const plugin of pluginsManager) {
    if (plugin.hasListeners("reaction")) {
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

      await plugin.run("reaction", {
        message,
        chat,
        sender: reaction.senderId,
        permissionLevel,

        reaction,
        async respond(result) {
          consola.debug("Handling interaction result:", {
            pluginId: plugin.id,
            result,
          });

          return await handleInteractionResult(result, message!, plugin);
        },
      });

      consola.debug("Interaction result handled:", plugin.id);
    }
  }
});

async function execute(
  command: InternalCommand,
  data: string,
  message: Message,
  chat: Chat,
  rateLimitEvent: RateLimitEvent,
  userRateLimits: RateLimit[],
) {
  const sender = getMessageSender(message);
  const permissionLevel = getPermissionLevel(sender, chat.id);

  await chat.sendSeen();

  const commandRateLimits = command.rateLimit
    ? [...userRateLimits, ...command.rateLimit]
    : userRateLimits;

  if (
    checkRateLimit(sender, commandRateLimits, command._plugin.id, command.name)
  ) {
    await message.react("\u23F3");
  } else {
    rateLimitEvent.plugin = command._plugin.id;
    rateLimitEvent.command = command.name;

    chat.sendStateTyping();

    if (permissionLevel >= command.minLevel) {
      try {
        const result = await command.handler({
          message,
          data,
          sender,
          chat,

          permissionLevel,
        });

        await handleInteractionResult(result, message, command._plugin);
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
  const cmd = pluginsManager.getCommand(command);
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
  plugin: Plugin<string>,
  _editMessage?: Message | null,
) {
  if (result instanceof InteractionContinuation) {
    const reply = await message.reply(result.message);
    reply.react("\u{1F4AC}");

    // expire continuations after 5 minutes
    // @ts-expect-error: _timer is private
    result._timer = setTimeout(
      async () => {
        await reply.react("\u231B");

        interactionContinuations.delete(reply.id._serialized);
      },
      5 * 60 * 1000,
    );

    interactionContinuations.set(reply.id._serialized, result);
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

  return null;
}

async function handleError(
  error: unknown,
  message: Message,
  interactionContinuationMessage?: Message | null,
  command?: InternalCommand | null,
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
Error while handling command \`${command._plugin.id}\`/\`${command.name}\`:
\`\`\`
${Bun.inspect(error, { colors: false })}\`\`\``,
        { linkPreview: false },
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

  // @ts-expect-error: _timer is private
  const { _timer } = interactionContinuation;

  if (!_timer) {
    throw new Error("Interaction continuation timer not found");
  }

  // prevent the expiration timeout from running
  clearTimeout(_timer);

  // delete the interaction continuation to prevent it from being used again
  interactionContinuations.delete(message.id._serialized);

  // remove the indicator reaction
  await message.react("");
}

async function stopGracefully() {
  consola.info("Graceful stop triggered");

  for (const plugin of pluginsManager) {
    await pluginsManager.unloadPlugin(plugin.id);
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

  consola.info("Unloading plugins");
  for (const plugin of pluginsManager) {
    await pluginsManager.unloadPlugin(plugin.id, false);
  }
}
