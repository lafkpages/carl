import { PermissionLevel } from "./perms";

export interface CommandErrorOptions extends ErrorOptions {
  /**
   * If thrown inside an interaction continuation,
   * whether to preserve the continuation or not.
   *
   * @default true
   */
  preserveInteractionContinuation?: boolean;
}

export class CommandError extends Error {
  /**
   * @internal
   */
  _preserveInteractionContinuation;

  constructor(message: string, options?: CommandErrorOptions) {
    super(message, options);
    this.name = "CommandError";

    this._preserveInteractionContinuation =
      options?.preserveInteractionContinuation ?? true;
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

    // TODO: global plugins registry?
    if (
      // plugins.includes("admin-utils")
      true
    ) {
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
