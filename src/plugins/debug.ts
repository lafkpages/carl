import type { Plugin } from "../plugins";

import { CommandError, CommandPermissionError } from "../error";
import { PermissionLevel } from "../perms";
import { InteractionContinuation } from "../plugins";

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
      name: "ping",
      description: "Check the bot's latency",
      minLevel: PermissionLevel.NONE,

      async handler({ message }) {
        const start = Date.now();

        await message.react("\u{1F3D3}");

        return `Latency: ${start - message.timestamp * 1000}ms`;
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

      async handler({ client, sender }) {
        const chatIds = await client.getCommonGroups(sender);

        if (!chatIds.length) {
          // There should always be at least one chat in common
          // with the sender and the bot, otherwise how would
          // the bot receive this message?
          throw new CommandError("no common chats \u{1F914}");
        }

        let msg = "Chats:\n";

        for (const id of chatIds) {
          const chat = await client.getChatById(id._serialized);

          msg += `\n* ${chat.name}`;
        }

        return msg;
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
