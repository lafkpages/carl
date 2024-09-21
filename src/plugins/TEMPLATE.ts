import { PermissionLevel } from "../perms";
import plugin from "../plugins";

export default plugin({
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
});
