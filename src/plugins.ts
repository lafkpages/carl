import type { Database } from "bun:sqlite";
import type { ConsolaInstance } from "consola";
import type { OAuth2Client } from "google-auth-library";
import type {
  Chat,
  Client,
  Message,
  MessageMedia,
  Reaction,
} from "whatsapp-web.js";
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

export default function plugin<
  TId extends string,
  TInteractions extends string,
>(plugin: Plugin<TId, TInteractions>) {
  return plugin;
}

export interface InternalPlugin<
  PluginId extends string = string,
  PluginInteractions extends string = string,
> {
  readonly id: PluginId;
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

  readonly commands?: Command<PluginId, PluginInteractions>[];
  readonly interactions?: Record<
    PluginInteractions,
    Interaction<PluginId, PluginInteractions>
  >;
  readonly api?: PluginApis[PluginId];

  onLoad?({}: BaseInteractionHandlerArgs<PluginId> & {
    server: typeof server;
  }): MaybePromise<void>;
  onUnload?({}: BaseInteractionHandlerArgs<PluginId>): MaybePromise<void>;

  onMessage?({}: BaseMessageInteractionHandlerArgs<PluginId> & {
    didHandleCommand: boolean;
  }): MaybePromise<InteractionResult<PluginInteractions>>;
  onMessageReaction?({}: BaseMessageInteractionHandlerArgs<PluginId> & {
    reaction: Reaction;
  }): MaybePromise<InteractionResult<PluginInteractions>>;

  _logger: ConsolaInstance;
  _db: Database | null;
}

export type Plugin<
  PluginId extends string = string,
  PluginInteractions extends string = string,
> = Omit<InternalPlugin<PluginId, PluginInteractions>, "_logger" | "_db">;

export interface Command<
  PluginId extends string,
  PluginInteractions extends string,
> extends Interaction<PluginId, PluginInteractions> {
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

export interface Interaction<
  PluginId extends string,
  PluginInteractions extends string,
> {
  handler({}: BaseMessageInteractionHandlerArgs<PluginId> & {
    rest: string;

    permissionLevel: PermissionLevel;

    data: unknown;

    getGoogleClient: (scope: string | string[]) => Promise<OAuth2Client>;
  }):
    | MaybePromise<InteractionResult<PluginInteractions>>
    | InteractionResultGenerator<PluginInteractions>;
}

interface BaseInteractionHandlerArgs<PluginId extends string> {
  api: PluginApis[PluginId];
  client: Client;
  logger: ConsolaInstance;
  config: PluginsConfig[PluginId];

  database: Database | null;

  generateTemporaryShortLink: typeof generateTemporaryShortLink;
}

interface BaseMessageInteractionHandlerArgs<PluginId extends string>
  extends BaseInteractionHandlerArgs<PluginId> {
  message: Message;
  chat: Chat;
  sender: string;
  permissionLevel: PermissionLevel;
}

type BasicInteractionResult = string | boolean | void | MessageMedia;

export type InteractionResult<PluginInteractions extends string> =
  | BasicInteractionResult
  | InteractionContinuation<PluginInteractions>;

export type InteractionResultGenerator<PluginInteractions extends string> =
  | Generator<
      BasicInteractionResult,
      InteractionResult<PluginInteractions>,
      unknown
    >
  | AsyncGenerator<
      BasicInteractionResult,
      InteractionResult<PluginInteractions>,
      unknown
    >;

export class InteractionContinuation<PluginInteractions extends string> {
  handler;
  message;
  data;

  constructor(handler: PluginInteractions, message: string, data?: unknown) {
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
