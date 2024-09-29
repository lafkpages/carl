import type { ConsolaInstance } from "consola";
import type { MaybePromise } from "elysia";
import type { OAuth2Client } from "google-auth-library";
import type { BaseSchema } from "valibot";
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
import type { server } from "./server";

import { Database } from "bun:sqlite";
import { consola } from "consola";

import { getConfig } from "./config";
import { AsyncEventEmitter } from "./events";

export interface Plugin<PluginId extends string> {
  /**
   * Whether this plugin should be hidden from the help command
   */
  readonly hidden?: boolean;

  /**
   * Whether this plugin requires an isolated SQLite database for
   * persistent storage of plugin-specific data
   */
  readonly database?: boolean;

  readonly configSchema?: BaseSchema<any, any, any>;
}

interface PluginEvents {
  load: [{ server: typeof server }];
  unload: [];

  message: [
    BaseMessageInteractionHandlerArgs & {
      didHandle: boolean;
    },
  ];
  reaction: [
    BaseMessageInteractionHandlerArgs & {
      reaction: Reaction;
    },
  ];
}

export abstract class Plugin<
  PluginId extends string,
> extends AsyncEventEmitter<PluginEvents> {
  abstract readonly id: PluginId;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly version: string;

  private _commands: (Command & ThisType<this>)[] = [];
  /**
   * Register commands for this plugin.
   *
   * This method should only be called in the constructor of the plugin.
   */
  protected registerCommands(commands: (Command & ThisType<this>)[]) {
    this._commands.push(...commands);
  }

  private _client: Client | null = null;
  protected get client() {
    if (!this._client) {
      throw new Error("Plugin does not have a client");
    }
    return this._client;
  }

  protected get config(): PluginsConfig[PluginId] {
    return getConfig().pluginsConfig[this.id];
  }

  private _db?: Database;
  protected get db() {
    if (!this.database) {
      throw new Error("Plugin does not have a database");
    }

    if (!this._db) {
      this._db = new Database(`db/plugins/${this.id}.sqlite`, {
        strict: true,
      });
      this._db.exec("PRAGMA journal_mode = WAL;");
    }

    return this._db;
  }

  private _logger?: ConsolaInstance;
  protected get logger() {
    if (!this._logger) {
      this._logger = consola.withTag(this.id);
    }
    return this._logger;
  }
}

export interface Command extends Interaction<string> {
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

  handler({}: BaseMessageInteractionHandlerArgs & {
    data: string;
  }): ReturnType<Interaction<string>["handler"]>;
}

export interface Interaction<T> {
  handler({}: InteractionArgs<T>):
    | MaybePromise<InteractionResult>
    | InteractionResultGenerator;
}

export interface InteractionArgs<T = unknown>
  extends BaseMessageInteractionHandlerArgs {
  data: T;
}

export interface GetGoogleClient {
  (scope: string | string[]): Promise<OAuth2Client>;
}

interface BaseMessageInteractionHandlerArgs {
  message: Message;
  chat: Chat;
  sender: string;
  permissionLevel: PermissionLevel;
}

type BasicInteractionResult = string | boolean | void | MessageMedia;

export type InteractionResult =
  | BasicInteractionResult
  | InteractionContinuation<unknown>;

export type InteractionResultGenerator =
  | Generator<BasicInteractionResult, InteractionResult, unknown>
  | AsyncGenerator<BasicInteractionResult, InteractionResult, unknown>;

export class InteractionContinuation<T> {
  message;
  handler;
  data;

  private _plugin: Plugin<string> | null = null;
  private _timer: Timer | null = null;

  constructor(message: string, handler: Interaction<T>["handler"], data?: T) {
    this.handler = handler;
    this.message = message;
    this.data = data;
  }
}

const pluginsGlob = new Bun.Glob("./src/plugins/**/plugin.ts");

export function getPluginIdFromPath(path: string) {
  return path.match(/(?:\/|^)(\w+)\/plugin\.ts$/)?.[1] || null;
}

export async function scanPlugins(map: Map<string, string>) {
  map.clear();

  for await (const entry of pluginsGlob.scan({
    absolute: true,
  })) {
    const pluginId = getPluginIdFromPath(entry);

    if (!pluginId) {
      consola.debug(`Ignoring non-plugin file in plugins scan: ${entry}`);
      continue;
    }

    if (pluginId === "TEMPLATE") {
      continue;
    }

    if (map.has(pluginId)) {
      throw new Error(`Duplicate plugin found: ${pluginId}`);
    }

    map.set(pluginId, entry);
  }
}
