import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

export default class extends Plugin<""> {
  readonly id = "";
  readonly name = "";
  readonly description = "";
  readonly version = "0.0.1";

  constructor() {
    super();

    this.registerCommands([
      {
        name: "",
        description: "",
        minLevel: PermissionLevel.ADMIN,

        handler({ message, data }) {},
      },
    ]);
  }
}
