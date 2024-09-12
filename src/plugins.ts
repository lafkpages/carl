import type { Database } from "bun:sqlite";
import type { ConsolaInstance } from "consola";
import type { OAuth2Client } from "google-auth-library";
import type { Chat, Client, Message, Reaction } from "whatsapp-web.js";
import type { Config } from "./config";
import type { PermissionLevel } from "./perms";
import type { generateTemporaryShortLink, server } from "./server";

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { consola } from "consola";

export abstract class Plugin {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly version: string;

  /**
   * Whether this plugin should be hidden from the help command
   */
  readonly hidden?: boolean;

  /**
   * Whether this plugin requires an isolated SQLite database for
   * persistent storage of plugin-specific data
   */
  readonly database?: boolean;

  readonly commands?: Command[];
  readonly interactions?: Interactions;

  onLoad?({}: OnLoadArgs): MaybePromise<void>;
  onUnload?({}: OnUnloadArgs): MaybePromise<void>;

  onMessage?({}: OnMessageArgs): MaybePromise<InteractionResult>;
  onMessageReaction?({}: OnMessageReactionArgs): MaybePromise<InteractionResult>;
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
  handler({}: BaseMessageInteractionHandlerArgs & {
    rest: string;

    permissionLevel: PermissionLevel;

    data: unknown;

    getGoogleClient: (scope: string | string[]) => Promise<OAuth2Client>;
  }): MaybePromise<InteractionResult>;
}

interface BaseInteractionHandlerArgs {
  plugin: Plugin;
  client: Client;
  logger: ConsolaInstance;
  config: Config;

  database: Database | null;

  generateTemporaryShortLink: typeof generateTemporaryShortLink;
}

export type Interactions = Record<string, Interaction>;

interface BaseMessageInteractionHandlerArgs extends BaseInteractionHandlerArgs {
  message: Message;
  chat: Chat;
  sender: string;
  permissionLevel: PermissionLevel;
}

export interface OnLoadArgs extends BaseInteractionHandlerArgs {
  server: typeof server;
}

export interface OnUnloadArgs extends BaseInteractionHandlerArgs {}

export interface OnMessageArgs extends BaseMessageInteractionHandlerArgs {}

export interface OnMessageReactionArgs
  extends BaseMessageInteractionHandlerArgs {
  reaction: Reaction;
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

const pluginsDir = join(__dirname, "plugins");

export async function scanPlugins() {
  const plugins = new Map<string, string>();

  for (const entry of await readdir(pluginsDir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) {
      continue;
    }

    const [, pluginId] = entry.name.match(/^(\w+)\.m?[jt]s$/) ?? [];

    if (!pluginId) {
      consola.debug(`Ignoring non-plugin file in plugins scan: ${entry.name}`);
      continue;
    }

    if (plugins.has(pluginId)) {
      throw new Error(`Duplicate plugin found: ${pluginId}`);
    }

    plugins.set(pluginId, join(pluginsDir, entry.name));
  }

  return plugins;
}
