import type { Command } from ".";
import { PermissionLevel } from "../perms";

export default {
  minLevel: PermissionLevel.MAX,

  description: "For debugging permission errors",
  hidden: true,
  handler(message, client, rest) {},
} satisfies Command;
