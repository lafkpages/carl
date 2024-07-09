import type { Message, Whatsapp } from "venom-bot";
import type { PermissionLevel } from "../perms";

type MaybePromise<T> = T | Promise<T>;

export interface Command {
  minLevel: PermissionLevel;

  description: string;
  hidden?: boolean;
  handler(
    message: Message,
    client: Whatsapp,
    rest: string,
    permissionLevel: PermissionLevel,
  ): MaybePromise<string | void>;
}

export { default as eval } from "./eval";
export { default as help } from "./help";
export { default as permerror } from "./permerror";
export { default as random } from "./random";
export { default as say } from "./say";
export { default as stop } from "./stop";
