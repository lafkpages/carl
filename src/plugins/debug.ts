import type { Plugin } from "../plugins";

import { CommandPermissionError } from "../error";
import { PermissionLevel } from "../perms";
import { InteractionContinuation } from "../plugins";

export default {
  id: "debug",
  name: "Debug tools",
  description: "Helps debug WhatsApp PA core and plugins",
  version: "0.0.1",
  hidden: true,

  commands: [
    {
      name: "debuginfo",
      description: "Get handy debug information",
      minLevel: PermissionLevel.NONE,

      handler({ message }) {
        return `\
\`\`\`
${Bun.inspect(message, { colors: false })}
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

      async handler({ message, client }) {
        const start = Date.now();

        await client.sendReactions(message.from, "\u{1F3D3}");

        return `Latency: ${start - message.timestamp * 1000}ms`;
      },
    },
    {
      name: "eval",
      description: "Evaluate JavaScript code",
      minLevel: PermissionLevel.ADMIN,

      async handler({ rest, message, client, logger }) {
        return `\`\`\`\n${Bun.inspect(
          await new Promise((resolve, reject) => {
            try {
              resolve(eval(rest));
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
        if (message.mentionedJidList?.length) {
          for (const jid of message.mentionedJidList) {
            await client.sendText(jid, message.body.slice(5));
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

          await client.sendText(to, msg);

          return true;
        } else {
          await client.sendText(message.from, message.body.slice(5));

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
      name: "testinteractioncontinuation",
      description: "Test interaction continuations",
      minLevel: PermissionLevel.TRUSTED,

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
