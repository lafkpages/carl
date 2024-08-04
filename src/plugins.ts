import type { Database } from "bun:sqlite";
import type { ConsolaInstance } from "consola";
import type { Chat, Client, Message } from "whatsapp-web.js";
import type { Config } from "./config";
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

  commands?: Command[];
  interactions?: Record<string, Interaction>;

  onLoad?({}: {
    client: Client;
    logger: ConsolaInstance;
    config: Config;

    database: Database | null;
  }): MaybePromise<void>;
  onUnload?({}: {
    client: Client;
    logger: ConsolaInstance;
    config: Config;

    database: Database | null;
  }): MaybePromise<void>;
  onMessage?({}: {
    client: Client;
    logger: ConsolaInstance;
    config: Config;

    database: Database | null;

    message: Message;
    sender: string;
    chat: Chat;
  }): MaybePromise<InteractionResult>;
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

  /**
   * Optional rate limit for this command in milliseconds. If set
   * to 0 or omitted, the command will not be rate limited. Note
   * that rate limiting is per user, per plugin, per command.
   *
   * It is a good idea to rate limit commands that interact with
   * external APIs to prevent abuse.
   */
  rateLimit?: number;
}

export interface Interaction {
  handler({}: {
    message: Message;
    rest: string;
    sender: string;
    chat: Chat;

    permissionLevel: PermissionLevel;

    client: Client;
    logger: ConsolaInstance;
    config: Config;

    database: Database | null;

    data: unknown;
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
  data;

  constructor(handler: string, message: string, data?: unknown) {
    this.handler = handler;
    this.message = message;
    this.data = data;
  }
}

type MaybePromise<T> = T | Promise<T>;
