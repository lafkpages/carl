import type { Plugin } from "../plugins";

import { PermissionLevel } from "../perms";

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

      handler(message, client, rest, permissionLevel) {},
    },
  ],
} satisfies Plugin;
