import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";
import { sendMessageToAdmins } from "../../utils";

// TODO: pass config in interaction handlers

const pendingPermissionRequests: Record<string, PermissionLevel> = {};

export default class extends Plugin<"adminutils"> {
  readonly id = "adminutils";
  readonly name = "Admin utilities";
  readonly description = "Commands for administration.";
  readonly version = "0.0.1";

  constructor() {
    super();

    this.registerCommands([
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

        async handler({ message, data, sender }) {
          if (sender in pendingPermissionRequests) {
            throw new CommandError(
              `you already have a pending permission request for permission level \`${PermissionLevel[pendingPermissionRequests[sender]]}\``,
            );
          }

          if (!data) {
            throw new CommandError(
              "you must specify a permission level to request. For example, `/requestpermission trusted`",
            );
          }

          data = data.trim().toUpperCase();

          if (!(data in PermissionLevel)) {
            throw new CommandError(
              `invalid permission level \`${data}\`. Valid permission levels are:\n* trusted\n* admin`,
            );
          }

          const contact = await message.getContact();

          const requestedPermissionLevel =
            PermissionLevel[data as keyof typeof PermissionLevel];

          pendingPermissionRequests[sender] = requestedPermissionLevel;

          await sendMessageToAdmins(
            this.client,
            `User \`${sender}\` (\`${contact.pushname}\`) has requested permission level \`${PermissionLevel[requestedPermissionLevel]}\` (\`${requestedPermissionLevel}\`). To grant this permission, edit the config file and restart the bot.`,
          );

          return true;
        },
      },
    ]);
  }
}
