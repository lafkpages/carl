import type { PermissionLevel } from "../perms";

import plugin from "../plugins";

let regexes: {
  regex?: RegExp | null;
  senders?: Set<string> | null;
  minLevel?: PermissionLevel;
  emoji: string;
}[] = [];

declare module "../config" {
  interface PluginsConfig {
    reactor?: {
      reactions: {
        regex?: string | [string, string];
        senders?: string[];
        minLevel?: PermissionLevel;
        emoji: string;
      }[];
    };
  }
}

export default plugin({
  id: "reactor",
  name: "Reactor",
  description: "React to messages with emojis.",
  version: "0.0.1",

  onLoad({ config }) {
    const reactions = config?.reactions;

    if (!reactions) {
      return;
    }

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

  async onMessage({ message, sender, permissionLevel }) {
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
