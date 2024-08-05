import type { Plugin } from "../plugins";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

export default {
  id: "viewonce",
  name: "View Once",
  description: "Allows saving view-once media",
  version: "0.0.1",

  commands: [
    {
      name: "keep",
      description: "Save a view-once media",
      minLevel: PermissionLevel.TRUSTED,

      async handler({ message, sender, client }) {
        if (!message.hasQuotedMsg) {
          throw new CommandError(
            "you need to reply to a view-once message to save it",
          );
        }

        const quotedMsg = await message.getQuotedMessage();

        if (!quotedMsg.hasMedia) {
          throw new CommandError("the replied message doesn't have media");
        }

        const media = await quotedMsg.downloadMedia();

        await client.sendMessage(sender, "View-once media saved!", {
          media,
          quotedMessageId: quotedMsg.id._serialized,
        });

        return true;
      },
    },
  ],
} satisfies Plugin;
