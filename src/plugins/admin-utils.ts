import type { Plugin } from "../plugins";

import { whitelist } from "../../config.json";
import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

// TODO: pass config in interaction handlers

const pendingPermissionRequests: Record<string, PermissionLevel> = {};

export default {
  id: "admin-utils",
  name: "Admin utilities",
  description: "Commands for administration.",
  version: "0.0.1",

  commands: [
    {
      name: "requestpermission",
      description: "Request an admin a certain permission level",
      minLevel: PermissionLevel.NONE,

      async handler({ message, rest, client }) {
        if (message.sender.id in pendingPermissionRequests) {
          throw new CommandError(
            `you already have a pending permission request for permission level \`${PermissionLevel[pendingPermissionRequests[message.sender.id]]}\``,
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

        const requestedPermissionLevel =
          PermissionLevel[rest as keyof typeof PermissionLevel];

        pendingPermissionRequests[message.sender.id] = requestedPermissionLevel;

        for (const admin of whitelist.admin) {
          await client.sendText(
            admin,
            `User \`${message.sender.id}\` (\`${message.notifyName}\`) has requested permission level \`${PermissionLevel[requestedPermissionLevel]}\` (\`${requestedPermissionLevel}\`). To grant this permission, edit the config file and restart the bot.`,
          );
        }

        return true;
      },
    },
  ],
} satisfies Plugin;
