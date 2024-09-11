import type { Command } from "../plugins";

import { PermissionLevel } from "../perms";
import { Plugin } from "../plugins";

export default class extends Plugin {
  id = "";
  name = "";
  description = "";
  version = "0.0.1";

  commands: Command[] = [
    {
      name: "",
      description: "",
      minLevel: PermissionLevel.ADMIN,

      handler({ message, rest }) {},
    },
  ];
}
