import type { Command } from ".";

import { PermissionLevel } from "../perms";

export default {
  minLevel: PermissionLevel.ADMIN,

  description: "",
  handler(message, client, rest) {},
} satisfies Command;
