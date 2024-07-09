import type { Command } from ".";
import { PermissionLevel } from "../perms";

export default {
  minLevel: PermissionLevel.ADMIN,

  description: "Stop the bot",
  handler(message, client, rest) {
    setTimeout(async () => {
      await client.close();

      setTimeout(() => {
        process.exit();
      }, 1000);
    }, 1000);
  },
} satisfies Command;
