import { plugins } from "../config.json";
import { PermissionLevel } from "./perms";

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

export class CommandPermissionError extends CommandError {
  constructor(command: string, minLevel?: PermissionLevel, extra = "") {
    let message = `You don't have permission to use the command \`${command}\``;

    if (extra) {
      message += ` ${extra}`;
    }

    if (minLevel !== undefined) {
      message += `. Requires at least permission level \`${PermissionLevel[minLevel]}\``;
    }

    if (plugins.includes("admin-utils")) {
      message +=
        ". If you believe this is an error, you can request permission using the `/requestpermission";
      if (minLevel !== undefined) {
        message += ` ${PermissionLevel[minLevel]}`;
      }
      message += "` command.";
    }

    super(message);
    this.name = "CommandPermissionError";
  }
}
