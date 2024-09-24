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

import { consola } from "consola";

export interface Plugins {
  [pluginId: string]: PluginDefinition;
}

export interface PluginInteractions {
  [pluginId: string]: {
    [interaction: string]: unknown;
  };
}

export default function plugin<PluginId extends string>(
  plugin: PluginDefinition<PluginId>,
) {
  return plugin;
}

export interface PluginDefinition<PluginId extends string = string> {
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

  readonly commands?: Command<PluginId>[];
  readonly interactions?: {
    [interaction in keyof PluginInteractions[PluginId]]: Interaction<
      PluginInteractions[PluginId][interaction],
      PluginId
    >;
  };
  readonly api?: Record<string, unknown>;

  onLoad?({}: BaseInteractionHandlerArgs<PluginId> & {
    server: typeof server;
  }): MaybePromise<void>;
  onUnload?({}: BaseInteractionHandlerArgs<PluginId>): MaybePromise<void>;

  onMessage?({}: BaseMessageInteractionHandlerArgs<PluginId> & {
    didHandle: boolean;
  }): MaybePromise<InteractionResult>;
  onMessageReaction?({}: BaseMessageInteractionHandlerArgs<PluginId> & {
    reaction: Reaction;
  }): MaybePromise<InteractionResult>;
}

export interface Plugin<PluginId extends string = string>
  extends PluginDefinition<PluginId> {
  _logger: ConsolaInstance;
  _db: Database | null;
}

export interface Command<PluginId extends string>
  extends Interaction<never, PluginId> {
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

export interface Interaction<Data, PluginId extends string> {
  handler({}: BaseMessageInteractionHandlerArgs<PluginId> & {
    rest: string;

    permissionLevel: PermissionLevel;

    data: Data;

    getGoogleClient: GetGoogleClient;
  }): MaybePromise<InteractionResult> | InteractionResultGenerator;
}

export interface GetGoogleClient {
  (scope: string | string[]): Promise<OAuth2Client>;
}

interface BaseInteractionHandlerArgs<PluginId extends string> {
  api: Plugins[PluginId]["api"];
  pluginApis: Partial<PluginApis>;

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

export type InteractionResult =
  | BasicInteractionResult
  | InteractionContinuation;

export type InteractionResultGenerator =
  | Generator<BasicInteractionResult, InteractionResult, unknown>
  | AsyncGenerator<BasicInteractionResult, InteractionResult, unknown>;

export class InteractionContinuation<PluginId extends string = string> {
  handler;
  message;
  data;

  constructor(
    handler: keyof PluginInteractions[PluginId],
    message: string,
    data?: PluginInteractions[PluginId][keyof PluginInteractions[PluginId]],
  ) {
    this.handler = handler;
    this.message = message;
    this.data = data;
  }
}

type MaybePromise<T> = T | Promise<T>;

const pluginsGlob = new Bun.Glob("./src/plugins/**/plugin.ts");

export function getPluginIdFromPath(path: string) {
  return path.match(/(?:\/|^)(\w+)\/plugin\.ts$/)?.[1] || null;
}

export async function scanPlugins() {
  const plugins = new Map<string, string>();

  for await (const entry of pluginsGlob.scan({
    absolute: true,
  })) {
    if (entry.includes(".types/")) {
      consola.debug(`Ignoring type declaration file in plugins scan: ${entry}`);
      continue;
    }

    const pluginId = getPluginIdFromPath(entry);

    if (!pluginId) {
      consola.debug(`Ignoring non-plugin file in plugins scan: ${entry}`);
      continue;
    }

    if (plugins.has(pluginId)) {
      throw new Error(`Duplicate plugin found: ${pluginId}`);
    }

    plugins.set(pluginId, entry);
  }

  return plugins;
}
