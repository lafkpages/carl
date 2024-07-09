import type { Message, Whatsapp } from "venom-bot";
import type { PermissionLevel } from "./perms";

export interface Plugin {
  name: string;
  description: string;
  version: string;

  commands: Command[];
}

export interface Command {
  name: string;
  description: string;

  /**
   * The minimum permission level required to run this command
   */
  minLevel: PermissionLevel;

  /**
   * Whether this command should be hidden from the help command
   */
  hidden?: boolean;

  handler(
    message: Message,
    client: Whatsapp,
    rest: string,
    permissionLevel: PermissionLevel,
  ): MaybePromise<string | void>;
}

type MaybePromise<T> = T | Promise<T>;
