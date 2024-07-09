import type { Command } from ".";

import { PermissionLevel } from "../perms";

export default {
  minLevel: PermissionLevel.ADMIN,

  description: "Evaluate JavaScript code",
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
} satisfies Command;
