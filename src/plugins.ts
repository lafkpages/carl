import type { Database } from "bun:sqlite";
import type { ConsolaInstance } from "consola";
import type { OAuth2Client } from "google-auth-library";
import type { Chat, Client, Message, Reaction } from "whatsapp-web.js";
import type { PluginsConfig } from "./config";
import type { PermissionLevel } from "./perms";
import type { RateLimit } from "./ratelimits";
import type { generateTemporaryShortLink, server } from "./server";

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { consola } from "consola";

export interface PluginApis {
  [pluginId: string]: Record<string, unknown>;
}

export default function plugin<TId extends string>(plugin: Plugin<TId>) {
  return plugin;
}

export interface InternalPlugin<TId extends string = string> {
  readonly id: TId;
  readonly name: string;
  readonly description: string;
  readonly version: string;

  /**
   * Whether this plugin should be hidden from the help command
   */
  readonly hidden?: boolean;

  /**
   * Whether this plugin requires an isolated SQLite database for
   * persistent storage of plugin-specific data
   */
  readonly database?: boolean;

  readonly commands?: Command<this>[];
  readonly interactions?: Interactions<this>;
  readonly api?: PluginApis[TId];

  onLoad?({}: BaseInteractionHandlerArgs<this> & {
    server: typeof server;
  }): MaybePromise<void>;
  onUnload?({}: BaseInteractionHandlerArgs<this>): MaybePromise<void>;

  onMessage?({}: BaseMessageInteractionHandlerArgs<this>): MaybePromise<InteractionResult>;
  onMessageReaction?({}: BaseMessageInteractionHandlerArgs<this> & {
    reaction: Reaction;
  }): MaybePromise<InteractionResult>;

  _logger: ConsolaInstance;
  _db: Database | null;
}

export type Plugin<TId extends string = string> = Omit<
  InternalPlugin<TId>,
  "_logger" | "_db"
>;

export interface Command<TPlugin extends Plugin> extends Interaction<TPlugin> {
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
  rateLimit?: RateLimit[];
}

export interface Interaction<TPlugin extends Plugin> {
  handler({}: BaseMessageInteractionHandlerArgs<TPlugin> & {
    rest: string;

    permissionLevel: PermissionLevel;

    data: unknown;

    getGoogleClient: (scope: string | string[]) => Promise<OAuth2Client>;
  }): MaybePromise<InteractionResult> | InteractionResultGenerator;
}

interface BaseInteractionHandlerArgs<TPlugin extends Plugin> {
  api: PluginApis[TPlugin["id"]];
  client: Client;
  logger: ConsolaInstance;
  config: PluginsConfig[TPlugin["id"]];

  database: Database | null;

  generateTemporaryShortLink: typeof generateTemporaryShortLink;
}

export type Interactions<TPlugin extends Plugin> = Record<
  string,
  Interaction<TPlugin>
>;

interface BaseMessageInteractionHandlerArgs<TPlugin extends Plugin>
  extends BaseInteractionHandlerArgs<TPlugin> {
  message: Message;
  chat: Chat;
  sender: string;
  permissionLevel: PermissionLevel;
}

type BasicInteractionResult = string | boolean | void;

export type InteractionResult =
  | BasicInteractionResult
  | InteractionContinuation;

export type InteractionResultGenerator =
  | Generator<BasicInteractionResult, InteractionResult, unknown>
  | AsyncGenerator<BasicInteractionResult, InteractionResult, unknown>;

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
