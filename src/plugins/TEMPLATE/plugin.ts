import type { Plugin } from "./$types";

import { PermissionLevel } from "../../perms";

export default {
  id: "",
  name: "",
  description: "",
  version: "0.0.1",

  commands: [
    {
      name: "",
      description: "",
      minLevel: PermissionLevel.ADMIN,

      handler({ message, rest }) {},
    },
  ],
} satisfies Plugin;
