import type { Command } from "../plugins";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";
import { Plugin } from "../plugins";

// TODO: pass config in interaction handlers

const pendingPermissionRequests: Record<string, PermissionLevel> = {};

export default class extends Plugin {
  id = "adminutils";
  name = "Admin utilities";
  description = "Commands for administration.";
  version = "0.0.1";

  commands: Command[] = [
    {
      name: "requestpermission",
      description: "Request an admin a certain permission level",
      minLevel: PermissionLevel.NONE,
      rateLimit: /* 1 hour */ 1000 * 60 * 60,

      async handler({ message, rest, sender, config, client }) {
        if (sender in pendingPermissionRequests) {
          throw new CommandError(
            `you already have a pending permission request for permission level \`${PermissionLevel[pendingPermissionRequests[sender]]}\``,
          );
        }

        if (!rest) {
          throw new CommandError(
            "you must specify a permission level to request. For example, `/requestpermission trusted`",
          );
        }

        rest = rest.trim().toUpperCase();

        if (!(rest in PermissionLevel)) {
          throw new CommandError(
            `invalid permission level \`${rest}\`. Valid permission levels are:\n* trusted\n* admin`,
          );
        }

        const contact = await message.getContact();

        const requestedPermissionLevel =
          PermissionLevel[rest as keyof typeof PermissionLevel];

        pendingPermissionRequests[sender] = requestedPermissionLevel;

        for (const admin of config.whitelist.admin) {
          await client.sendMessage(
            admin,
            `User \`${sender}\` (\`${contact.pushname}\`) has requested permission level \`${PermissionLevel[requestedPermissionLevel]}\` (\`${requestedPermissionLevel}\`). To grant this permission, edit the config file and restart the bot.`,
          );
        }

        return true;
      },
    },
  ];
}
