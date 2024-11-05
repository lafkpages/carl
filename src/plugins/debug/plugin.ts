import type { ElementHandle } from "puppeteer";
import type { Message } from "whatsapp-web.js";

import { stat } from "node:fs/promises";

import { Database } from "bun:sqlite";
import filesize from "file-size";
import { google } from "googleapis";
import JSZip from "jszip";
import Mime from "mime";
import { Page } from "puppeteer";
import { boolean, object, optional } from "valibot";
import { MessageMedia } from "whatsapp-web.js";

import { CommandError, CommandPermissionError } from "../../error";
import { getGoogleClient, getScopes } from "../../google";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";
import { pingCheck } from "../../server";
import { isInDevelopment } from "../../utils";
import { dbsGlob } from "./dbs";

export default new Plugin(
  "debug",
  "Debug tools",
  "Helps debug WhatsApp PA core and plugins",
)
  .hidden()
  .configSchema(
    optional(
      object({
        evalShellTrimOutput: optional(boolean(), true),
      }),
      {},
    ),
  )
  .registerCommand({
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
  })
  .registerCommand({
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
  })
  .registerCommand({
    name: "botid",
    description: "Get the bot's ID",
    minLevel: PermissionLevel.NONE,

    handler({ message }) {
      return `\`${message.to}\``;
    },
  })
  .registerCommand({
    name: "chatid",
    description: "Get the chat ID",
    minLevel: PermissionLevel.NONE,

    handler({ chat }) {
      return `\`${chat.id._serialized}\``;
    },
  })
  .registerCommand({
    name: "whoami",
    description: "Get your user ID",
    minLevel: PermissionLevel.NONE,

    handler({ sender }) {
      return `\`${sender}\``;
    },
  })
  .registerCommand({
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
  })
  .registerCommand({
    name: "eval",
    description: "Evaluate JavaScript code",
    minLevel: PermissionLevel.ADMIN,

    async handler(args) {
      // Get all arguments as args so they can be used in the eval

      return `\`\`\`\n${Bun.inspect(
        await new Promise((resolve, reject) => {
          try {
            resolve(eval(args.data));
          } catch (err) {
            reject(err);
          }
        }),
        { colors: false },
      )}\n\`\`\``;
    },
  })
  .registerCommand({
    name: "evalshell",
    description: "Evaluate shell commands",
    minLevel: PermissionLevel.ADMIN,

    async handler({ message, data }) {
      const proc = Bun.spawnSync({
        cmd: ["sh", "-c", data],
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

      if (proc.stdout.length) {
        let stdout = proc.stdout.toString("utf-8");

        if (this.config.evalShellTrimOutput) {
          stdout = stdout.trim();
        }

        msg += `\

Stdout:
\`\`\`${stdout}\`\`\``;
      }

      if (proc.stderr.length) {
        let stderr = proc.stderr.toString("utf-8");

        if (this.config.evalShellTrimOutput) {
          stderr = stderr.trim();
        }

        msg += `\

Stderr:
\`\`\`${stderr}\`\`\``;
      }

      return msg.trimStart();
    },
  })
  .registerCommand({
    name: "say",
    description: "Send a message, optionally to a specific chat",
    minLevel: PermissionLevel.TRUSTED,

    async handler({ message, data, permissionLevel }) {
      if (message.mentionedIds.length) {
        for (const id of message.mentionedIds) {
          await this.client.sendMessage(id._serialized, data);
        }

        return true;
      }

      const [, to, msg] = data.match(/^(\S+) (.+)$/s) || [];

      if (to && msg) {
        if (permissionLevel < PermissionLevel.ADMIN) {
          throw new CommandPermissionError(
            "say",
            PermissionLevel.ADMIN,
            "with a chat specifier",
          );
        }

        await this.client.sendMessage(to, msg);

        return true;
      } else {
        await this.client.sendMessage(message.from, data);

        return true;
      }
    },
  })
  .registerCommand({
    name: "permerror",
    description: "Will always throw a permission error",
    minLevel: PermissionLevel.MAX,

    handler() {
      return "Unreachable code";
    },
  })
  .registerCommand({
    name: "emptymessage",
    description: "Send an empty message",
    minLevel: PermissionLevel.NONE,

    async handler() {
      return "";
    },
  })
  .registerCommand({
    name: "chats",
    description: "List all chats you and the bot are in",
    minLevel: PermissionLevel.NONE,

    async handler({ sender, data, permissionLevel }) {
      const canListAllChats = permissionLevel >= PermissionLevel.ADMIN;

      switch (data) {
        case "": {
          const chatIds = await this.client.getCommonGroups(sender);

          if (!chatIds.length) {
            throw new CommandError("no common chats \u{1F914}");
          }

          let msg = "Chats:\n";
          for (const id of chatIds) {
            const chat = await this.client.getChatById(id._serialized);

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

          const chats = await this.client.getChats();

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
  })
  .registerCommand({
    name: "messages",
    description: "List all messages in a chat",
    minLevel: PermissionLevel.TRUSTED,
    rateLimit: [
      {
        duration: 60000,
        max: 5,
      },
    ],

    async handler({ message, data, sender, permissionLevel }) {
      const chatId = data;

      const commonGroups = await this.client.getCommonGroups(sender);
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

      const chat = await this.client.getChatById(chatId);

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
  })
  .registerCommand({
    name: "publicping",
    description: "Ping the instance's public URL",
    minLevel: PermissionLevel.ADMIN,
    hidden: true,

    async handler() {
      await pingCheck();
      return true;
    },
  })
  .registerCommand({
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
  })
  .registerCommand({
    name: "googletest",
    description: "Test Google OAuth",
    minLevel: PermissionLevel.NONE,
    rateLimit: [{ duration: 10000, max: 1 }],
    hidden: true,

    async handler({ sender, chat }) {
      const client = await getGoogleClient(
        this.client,
        sender,
        chat,
        "https://www.googleapis.com/auth/userinfo.profile",
      );
      const oauth = google.oauth2({
        version: "v2",
        auth: client,
      });

      const { data } = await oauth.userinfo.get();

      return `\`\`\`\n${Bun.inspect(data, { colors: false })}\n\`\`\``;
    },
  })
  .registerCommand({
    name: "screenshot",
    description: "Take a screenshot of the WhatsApp Web page",
    minLevel: PermissionLevel.ADMIN,

    async handler({ message, data }) {
      let target: ElementHandle | Page | null | undefined;
      switch (data) {
        case "":
        case "page":
        case "pupPage": {
          target = this.client.pupPage;
          break;
        }

        case "chats":
        case "sidePane": {
          target = await this.client.pupPage?.$("#pane-side div");
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
  })
  .registerCommand({
    name: "firstmessage",
    description: "Get the first message in a chat",
    minLevel: PermissionLevel.NONE,
    rateLimit: [
      {
        duration: 10000,
        max: 1,
      },
    ],

    async handler({ chat }) {
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

      this.logger.debug(
        "First message:",
        firstMessage,
        firstMessage.body,
        firstMessage.type,
      );

      await firstMessage.reply("^");
    },
  })
  .registerCommand({
    name: "downloadmedia",
    description: "Download media from a message",
    minLevel: PermissionLevel.ADMIN,

    async handler({ message }) {
      if (!message.hasQuotedMsg) {
        throw new CommandError("no quoted message");
      }

      const quotedMessage = await message.getQuotedMessage();

      if (!quotedMessage.hasMedia) {
        throw new CommandError("quoted message has no media");
      }

      const media = await quotedMessage.downloadMedia();

      let filename = media.filename;
      if (!filename) {
        const ext = Mime.getExtension(media.mimetype);

        if (ext) {
          filename = `${Date.now()}.${ext}`;
        } else {
          filename = `${Date.now()}`;
        }
      }

      await Bun.write(
        `media/${quotedMessage.id._serialized}/${filename}`,
        Buffer.from(media.data, "base64"),
      );

      return true;
    },
  })
  .registerCommand({
    name: "plugindbs",
    description: "List all plugin databases",
    minLevel: PermissionLevel.ADMIN,

    async handler({ data }) {
      switch (data) {
        case "export": {
          const zip = new JSZip();

          for await (const dbPath of dbsGlob.scan()) {
            const db = new Database(dbPath, { readonly: true });

            zip.file(dbPath, db.serialize());

            db.close();
          }

          return new MessageMedia(
            "application/zip",
            await zip.generateAsync({ type: "base64" }),
          );
        }

        case "list":
        case "": {
          let msg = "Databases:";

          for await (const dbPath of dbsGlob.scan()) {
            const stats = await stat(dbPath);
            const size = filesize(stats.size).human();

            msg += `\n* \`${dbPath}\`: ${size}`;
          }

          if (msg.length <= 10) {
            throw new CommandError("no databases found");
          }

          return msg;
        }

        default: {
          throw new CommandError("invalid argument");
        }
      }
    },
  })
  .registerInteraction({
    name: "testinteractioncontinuation",
    handler({ message, data }) {
      if (data) {
        return `Hello, you are \`${data}\` and you are \`${message.body}\` years old`;
      }

      return this.interactionContinuation(
        "testinteractioncontinuation",
        "How old are you?",
        message.body,
      );
    },
  })
  .registerCommand({
    name: "testinteractioncontinuation",
    description: "Test interaction continuations",
    minLevel: PermissionLevel.NONE,

    handler() {
      return this.interactionContinuation(
        "testinteractioncontinuation",
        "Hello, what's your name?",
      );
    },
  });
