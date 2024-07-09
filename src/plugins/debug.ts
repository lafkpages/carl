import type { Plugin } from "../plugins";

import { CommandPermissionError } from "../error";
import { PermissionLevel } from "../perms";

export default {
  name: "Debug tools",
  description: "Helps debug WhatsApp PA core and plugins",
  version: "0.0.1",
  hidden: true,

  commands: [
    {
      name: "eval",
      description: "Evaluate JavaScript code",
      minLevel: PermissionLevel.ADMIN,

      async handler(message, client, rest) {
        await new Promise((resolve, reject) => {
          try {
            resolve(eval(rest));
          } catch (err) {
            reject(err);
          }
        })
          .then(async (result: unknown) => {
            await client.reply(
              message.from,
              `Result: ${Bun.inspect(result, { colors: false })}`,
              message.id,
            );
          })
          .catch(async (err) => {
            await client.reply(
              message.from,
              `Error: ${Bun.inspect(err, {
                colors: false,
              })}`,
              message.id,
            );
          });
      },
    },
    {
      name: "say",
      description: "Send a message, optionally to a specific chat",
      minLevel: PermissionLevel.TRUSTED,

      async handler(message, client, _rest, permissionLevel) {
        const [, to, rest] = message.body.match(/^\/say (\S+) (.+)/s) || [];

        if (to && rest) {
          if (permissionLevel < PermissionLevel.ADMIN) {
            throw new CommandPermissionError(
              "say",
              PermissionLevel.ADMIN,
              " with a chat specifier",
            );
          }

          await client.sendText(to, rest);
        } else {
          await client.sendText(message.from, message.body.slice(5));
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
  ],
} satisfies Plugin;
