import type { Command } from ".";
import { PermissionLevel } from "../perms";

import * as commands from ".";

export default {
  minLevel: PermissionLevel.NONE,

  description: "Shows this help message",
  handler(message, client, rest) {
    const showHidden = rest === "all";

    let help = "Commands:";

    for (const [name, cmd] of Object.entries(commands)) {
      if ("hidden" in cmd && cmd.hidden && !showHidden) {
        continue;
      }

      help += `\n* \`/${name}\`: ${cmd.description}`;
    }

    return help;
  },
} satisfies Command;
