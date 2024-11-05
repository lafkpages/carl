import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

export default new Plugin("", "", "").registerCommand({
  name: "",
  description: "",
  minLevel: PermissionLevel.ADMIN,

  handler({ message, data }) {},
});
