import { array, enum_, object, optional, string, tuple, union } from "valibot";

import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

let regexes: {
  regex?: RegExp | null;
  senders?: Set<string> | null;
  minLevel?: PermissionLevel;
  emoji: string;
}[] = [];

export default new Plugin(
  "reactor",
  "Reactor",
  "React to messages with emojis.",
)
  .configSchema(
    optional(
      object({
        reactions: optional(
          array(
            object({
              regex: optional(union([string(), tuple([string(), string()])])),
              senders: optional(array(string())),
              minLevel: optional(enum_(PermissionLevel)),
              emoji: string(),
            }),
          ),
          [],
        ),
      }),
      {},
    ),
  )
  .on({
    load() {
      const reactions = this.config.reactions;

      for (const { regex, senders, minLevel, emoji } of reactions) {
        regexes.push({
          regex:
            typeof regex === "string"
              ? new RegExp(regex)
              : regex
                ? new RegExp(regex[0], regex[1])
                : null,
          senders: senders ? new Set(senders) : null,
          minLevel,
          emoji,
        });
      }
    },
    async message({ message, sender, permissionLevel }) {
      for (const { regex, senders, minLevel, emoji } of regexes) {
        if (minLevel !== undefined && permissionLevel < minLevel) {
          continue;
        }

        if (senders && !senders.has(sender)) {
          continue;
        }

        if (regex && !regex.test(message.body)) {
          continue;
        }

        await message.react(emoji);
      }
    },
  });
