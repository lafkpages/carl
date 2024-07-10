import type { Database } from "bun:sqlite";
import type { Message, Whatsapp } from "venom-bot";
import type { PermissionLevel } from "./perms";

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;

  /**
   * Whether this plugin should be hidden from the help command
   */
  hidden?: boolean;

  /**
   * Whether this plugin requires an isolated SQLite database for
   * persistent storage of plugin-specific data
   */
  database?: boolean;

  commands: Command[];

  onLoad?(client: Whatsapp, database: Database | null): MaybePromise<void>;
  onUnload?(client: Whatsapp, database: Database | null): MaybePromise<void>;
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

  handler({}: {
    message: Message;
    rest: string;

    permissionLevel: PermissionLevel;

    client: Whatsapp;

    database: Database | null;
  }): MaybePromise<string | boolean | void>;
}

type MaybePromise<T> = T | Promise<T>;
