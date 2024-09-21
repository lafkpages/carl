import { CommandError } from "../error";
import { PermissionLevel } from "../perms";
import plugin from "../plugins";
import { sendMessageToAdmins } from "../utils";

// TODO: pass config in interaction handlers

const pendingPermissionRequests: Record<string, PermissionLevel> = {};

export default plugin({
  id: "adminutils",
  name: "Admin utilities",
  description: "Commands for administration.",
  version: "0.0.1",

  commands: [
    {
      name: "requestpermission",
      description: "Request an admin a certain permission level",
      minLevel: PermissionLevel.NONE,
      rateLimit: [
        {
          // Once per hour
          duration: 1000 * 60 * 60,
          max: 1,
        },
      ],

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

        await sendMessageToAdmins(
          client,
          `User \`${sender}\` (\`${contact.pushname}\`) has requested permission level \`${PermissionLevel[requestedPermissionLevel]}\` (\`${requestedPermissionLevel}\`). To grant this permission, edit the config file and restart the bot.`,
        );

        return true;
      },
    },
  ],
});
