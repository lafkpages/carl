import type { Client, Message } from "whatsapp-web.js";
import type { Plugin } from "../plugins";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

async function handleKeep(message: Message, client: Client, sender: string) {
  const media = await message.downloadMedia();

  await client.sendMessage(sender, "View-once media saved!", {
    media,
    quotedMessageId: message.id._serialized,
  });
}

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

      async handler({ message, rest, sender, client }) {
        let quotedMsg: Message | undefined;

        if (rest) {
          quotedMsg = await client.getMessageById(rest);

          if (!quotedMsg) {
            return false;
          }
        } else if (!message.hasQuotedMsg) {
          throw new CommandError(
            "you need to reply to a view-once message to save it",
          );
        }

        if (!quotedMsg) {
          quotedMsg = await message.getQuotedMessage();
        }

        if (!quotedMsg.hasMedia) {
          throw new CommandError("the replied message doesn't have media");
        }

        await handleKeep(quotedMsg, client, sender);

        return true;
      },
    },
  ],

  async onMessageReaction({
    reaction,
    message,
    sender,
    permissionLevel,
    client,
  }) {
    if (reaction.reaction !== "\u267E\uFE0F") {
      return;
    }

    // Only allow trusted users to save view-once media
    if (permissionLevel < PermissionLevel.TRUSTED) {
      return;
    }

    if (!message.hasMedia) {
      return;
    }

    await handleKeep(message, client, sender);
  },
} satisfies Plugin;
