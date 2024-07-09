import type { Command } from ".";
import { CommandPermissionError } from "../error";
import { PermissionLevel } from "../perms";

export default {
  minLevel: PermissionLevel.TRUSTED,

  description: "Send a message, optionally to a specific chat",
  async handler(message, client, _rest, permissionLevel) {
    const [, to, rest] = message.body.match(/^\/say (\S+) (.+)/s) || [];

    if (to && rest) {
      if (permissionLevel < PermissionLevel.ADMIN) {
        throw new CommandPermissionError(
          "say",
          PermissionLevel.ADMIN,
          " with a chat specifier"
        );
      }

      await client.sendText(to, rest);
    } else {
      await client.sendText(message.from, message.body.slice(5));
    }
  },
} satisfies Command;
