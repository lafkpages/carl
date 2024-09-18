import type { ElementHandle, Page } from "puppeteer";
import type { Message } from "whatsapp-web.js";
import type { Plugin } from "../plugins";

import { google } from "googleapis";
import { MessageMedia } from "whatsapp-web.js";

import { CommandError, CommandPermissionError } from "../error";
import { getScopes } from "../google";
import { PermissionLevel } from "../perms";
import { InteractionContinuation } from "../plugins";
import { pingCheck } from "../server";
import { isInDevelopment } from "../utils";

declare module "../config" {
  interface PluginsConfig {
    debug?: {
      evalShellTrimOutput?: boolean;
    };
  }
}

export default {
  id: "debug",
  name: "Debug tools",
  description: "Helps debug WhatsApp PA core and plugins",
  version: "0.0.2",
  hidden: true,

  commands: [
    {
      name: "debuginfo",
      description: "Get handy debug information",
      minLevel: PermissionLevel.ADMIN,

      handler({ message }) {
        const strippedMessage = { ...message, client: "[SNIP]" };

        return `\
\`\`\`
${Bun.inspect(strippedMessage, { colors: false })}
\`\`\``;
      },
    },
    {
      name: "messageid",
      description: "Get the quoted message ID",
      minLevel: PermissionLevel.NONE,

      async handler({ message }) {
        if (!message.hasQuotedMsg) {
          throw new CommandError("no quoted message");
        }

        const quotedMessage = await message.getQuotedMessage();

        return `\
\`\`\`
${Bun.inspect(quotedMessage.id, { colors: false })}
\`\`\``;
      },
    },
    {
      name: "botid",
      description: "Get the bot's ID",
      minLevel: PermissionLevel.NONE,

      handler({ message }) {
        return `\`${message.to}\``;
      },
    },
    {
      name: "chatid",
      description: "Get the chat ID",
      minLevel: PermissionLevel.NONE,

      handler({ chat }) {
        return `\`${chat.id._serialized}\``;
      },
    },
    {
      name: "whoami",
      description: "Get your user ID",
      minLevel: PermissionLevel.NONE,

      handler({ sender }) {
        return `\`${sender}\``;
      },
    },
    {
      name: "ping",
      description: "Check the bot's latency",
      minLevel: PermissionLevel.NONE,

      async handler({ message }) {
        const start = Date.now();

        await message.react("\u{1F3D3}");

        const msg = await message.reply(
          `Latency: ${start - message.timestamp * 1000}ms`,
        );

        if (isInDevelopment) {
          await msg.react("\u2692\uFE0F");
        }
      },
    },
    {
      name: "eval",
      description: "Evaluate JavaScript code",
      minLevel: PermissionLevel.ADMIN,

      async handler(args) {
        // Get all arguments as args so they can be used in the eval

        return `\`\`\`\n${Bun.inspect(
          await new Promise((resolve, reject) => {
            try {
              resolve(eval(args.rest));
            } catch (err) {
              reject(err);
            }
          }),
          { colors: false },
        )}\n\`\`\``;
      },
    },
    {
      name: "evalshell",
      description: "Evaluate shell commands",
      minLevel: PermissionLevel.ADMIN,

      async handler({ message, rest, config }) {
        const proc = Bun.spawnSync({
          cmd: ["sh", "-c", rest],
        });

        await message.react(proc.success ? "\u2705" : "\u274C");

        let msg = "";

        if (proc.exitCode) {
          msg += `\
Exit code: ${proc.exitCode}`;
        }

        if (proc.signalCode) {
          msg += `\
Signal code: ${proc.signalCode}`;
        }

        const trimOutput =
          config.pluginsConfig?.debug?.evalShellTrimOutput ?? true;

        if (proc.stdout.length) {
          let stdout = proc.stdout.toString("utf-8");

          if (trimOutput) {
            stdout = stdout.trim();
          }

          msg += `\

Stdout:
\`\`\`${stdout}\`\`\``;
        }

        if (proc.stderr.length) {
          let stderr = proc.stderr.toString("utf-8");

          if (trimOutput) {
            stderr = stderr.trim();
          }

          msg += `\

Stderr:
\`\`\`${stderr}\`\`\``;
        }

        return msg.trimStart();
      },
    },
    {
      name: "say",
      description: "Send a message, optionally to a specific chat",
      minLevel: PermissionLevel.TRUSTED,

      async handler({ message, client, rest, permissionLevel }) {
        if (message.mentionedIds.length) {
          for (const id of message.mentionedIds) {
            await client.sendMessage(id._serialized, rest);
          }

          return true;
        }

        const [, to, msg] = rest.match(/^(\S+) (.+)$/s) || [];

        if (to && msg) {
          if (permissionLevel < PermissionLevel.ADMIN) {
            throw new CommandPermissionError(
              "say",
              PermissionLevel.ADMIN,
              "with a chat specifier",
            );
          }

          await client.sendMessage(to, msg);

          return true;
        } else {
          await client.sendMessage(message.from, rest);

          return true;
        }
      },
    },
    {
      name: "permerror",
      description: "Will always throw a permission error",
      minLevel: PermissionLevel.MAX,

      handler() {
        return "Unreachable code";
      },
    },
    {
      name: "emptymessage",
      description: "Send an empty message",
      minLevel: PermissionLevel.NONE,

      async handler() {
        return "";
      },
    },
    {
      name: "chats",
      description: "List all chats you and the bot are in",
      minLevel: PermissionLevel.NONE,

      async handler({ client, sender, rest, permissionLevel }) {
        const canListAllChats = permissionLevel >= PermissionLevel.ADMIN;

        switch (rest) {
          case "": {
            const chatIds = await client.getCommonGroups(sender);

            if (!chatIds.length) {
              throw new CommandError("no common chats \u{1F914}");
            }

            let msg = "Chats:\n";
            for (const id of chatIds) {
              const chat = await client.getChatById(id._serialized);

              msg += `\n* \`${id._serialized}\`: ${chat.name}`;
            }

            return msg;
          }

          case "all": {
            if (!canListAllChats) {
              throw new CommandPermissionError(
                "chats",
                PermissionLevel.ADMIN,
                "list all",
              );
            }

            const chats = await client.getChats();

            if (!chats.length) {
              throw new CommandError("no chats \u{1F914}");
            }

            let msg = "Chats:\n";
            for (const chat of chats) {
              msg += `\n* \`${chat.id._serialized}\`: ${chat.name}`;
            }

            return msg;
          }

          default: {
            throw new CommandError(
              `invalid argument. Usage: \`/chats${canListAllChats ? " [all]" : ""}\``,
            );
          }
        }
      },
    },
    {
      name: "messages",
      description: "List all messages in a chat",
      minLevel: PermissionLevel.TRUSTED,
      rateLimit: 10000,

      async handler({ client, message, rest, sender, permissionLevel }) {
        const chatId = rest;

        const commonGroups = await client.getCommonGroups(sender);
        let found = false;
        for (const id of commonGroups) {
          if (id._serialized === chatId) {
            found = true;
            break;
          }
        }

        if (!found) {
          if (permissionLevel < PermissionLevel.ADMIN) {
            throw new CommandPermissionError(
              "messages",
              PermissionLevel.ADMIN,
              "with a chat specifier",
            );
          } else {
            await message.react("\u{1F440}");
          }
        }

        const chat = await client.getChatById(chatId);

        const messages = await chat.fetchMessages({
          limit: permissionLevel >= PermissionLevel.ADMIN ? 100 : 10,
        });

        let msg = "";
        for (const message of messages) {
          msg += `* \`${message.author || message.from}\` at ${new Date(message.timestamp)} (\`${message.id._serialized}\`)`;

          if (message.hasMedia) {
            msg += `\nMedia: \`${message.type}\``;
          }

          if (message.body) {
            msg += `\n> ${message.body.length >= 50 ? message.body.slice(0, 50) + "..." : message.body}`;
          }

          msg += "\n\n";
        }

        return msg;
      },
    },
    {
      name: "publicping",
      description: "Ping the instance's public URL",
      minLevel: PermissionLevel.ADMIN,
      hidden: true,

      async handler() {
        await pingCheck();
        return true;
      },
    },
    {
      name: "googleauth",
      description: "View your Google OAuth2 authentication status",
      minLevel: PermissionLevel.NONE,

      async handler({ sender }) {
        const scopes = getScopes(sender);

        if (!scopes.size) {
          return false;
        }

        let msg = "Authenticated with Google with scopes:";
        for (const scope of scopes) {
          msg += `\n* \`${scope}\``;
        }

        return msg;
      },
    },
    {
      name: "googletest",
      description: "Test Google OAuth",
      minLevel: PermissionLevel.NONE,
      rateLimit: 10000,
      hidden: true,

      async handler({ getGoogleClient }) {
        const client = await getGoogleClient(
          "https://www.googleapis.com/auth/userinfo.profile",
        );
        const oauth = google.oauth2({
          version: "v2",
          auth: client,
        });

        const { data } = await oauth.userinfo.get();

        return `\`\`\`\n${Bun.inspect(data, { colors: false })}\n\`\`\``;
      },
    },
    {
      name: "screenshot",
      description: "Take a screenshot of the WhatsApp Web page",
      minLevel: PermissionLevel.ADMIN,

      async handler({ message, rest, client }) {
        let target: ElementHandle | Page | null | undefined;
        switch (rest) {
          case "":
          case "page":
          case "pupPage": {
            target = client.pupPage;
            break;
          }

          case "chats":
          case "sidePane": {
            target = await client.pupPage?.$("#pane-side div");
            break;
          }

          default: {
            throw new CommandError("invalid target");
          }
        }

        if (!target) {
          throw new CommandError("target not found");
        }

        let screenshot = await target.screenshot({
          type: "jpeg",
          // fullPage: true,
          captureBeyondViewport: true,
        });

        if (typeof screenshot === "string") {
          throw new CommandError("got unexpected string screenshot");
        }

        await message.reply(
          new MessageMedia("image/jpeg", screenshot.toString("base64")),
        );
      },
    },
    {
      name: "firstmessage",
      description: "Get the first message in a chat",
      minLevel: PermissionLevel.NONE,
      rateLimit: 10000,

      async handler({ chat, logger }) {
        const messages = await chat.fetchMessages({ limit: Infinity });

        let firstMessage: Message | null = null;
        for (const message of messages) {
          if (message.body) {
            firstMessage = message;
            break;
          }
        }

        if (!firstMessage) {
          throw new CommandError("no messages found");
        }

        logger.debug(
          "First message:",
          firstMessage,
          firstMessage.body,
          firstMessage.type,
        );

        await firstMessage.reply("^");
      },
    },
    {
      name: "testinteractioncontinuation",
      description: "Test interaction continuations",
      minLevel: PermissionLevel.NONE,

      handler() {
        return new InteractionContinuation(
          "testinteractioncontinuation",
          "Hello, what's your name?",
        );
      },
    },
  ],

  interactions: {
    testinteractioncontinuation: {
      handler({ message, data }) {
        if (data) {
          return `Hello, you are \`${data}\` and you are \`${message.body}\` years old`;
        }

        return new InteractionContinuation(
          "testinteractioncontinuation",
          "How old are you?",
          message.body,
        );
      },
    },
  },
} satisfies Plugin;
