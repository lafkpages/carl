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
  interactions?: Record<string, Interaction>;

  onLoad?(client: Whatsapp, database: Database | null): MaybePromise<void>;
  onUnload?(client: Whatsapp, database: Database | null): MaybePromise<void>;
}

export interface Command extends Interaction {
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
}

export interface Interaction {
  handler({}: {
    message: Message;
    rest: string;

    permissionLevel: PermissionLevel;

    client: Whatsapp;

    database: Database | null;
  }): MaybePromise<InteractionResult>;
}

export type InteractionResult =
  | InteractionContinuation
  | string
  | boolean
  | void;

export class InteractionContinuation {
  handler;
  message;

  constructor(handler: string, message: string) {
    this.handler = handler;
    this.message = message;
  }
}

type MaybePromise<T> = T | Promise<T>;
