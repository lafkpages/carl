import type { ConsolaInstance } from "consola";
import type { MaybePromise } from "elysia";
import type { OAuth2Client } from "google-auth-library";
import type { BaseSchema, InferOutput } from "valibot";
import type {
  Chat,
  Client,
  Message,
  MessageMedia,
  Reaction,
} from "whatsapp-web.js";
import type { PermissionLevel } from "./perms";
import type { RateLimit } from "./ratelimits";
import type { server } from "./server";

import { Database } from "bun:sqlite";
import { consola } from "consola";

import { getConfig } from "./config";
import { AsyncEventEmitter } from "./events";

interface PluginEvents {
  load: [{ server: typeof server }];
  unload: [];

  message: [
    BaseMessageInteractionHandlerArgs &
      BaseRespondableInteractionHandlerArgs & {
        didHandle: boolean;
      },
  ];
  reaction: [
    BaseMessageInteractionHandlerArgs &
      BaseRespondableInteractionHandlerArgs & {
        reaction: Reaction;
      },
  ];
}

export class Plugin<
  PluginId extends string,
  Depends extends string[] = [],
  Interactions extends { [key: string]: unknown } = {},
  ConfigSchema extends BaseSchema<any, any, any> = BaseSchema<any, any, any>,
  Api extends { [key: string]: unknown } | null = {},
> extends AsyncEventEmitter<PluginEvents> {
  readonly id: PluginId;
  readonly name;
  readonly description;

  private _loaded = false;
  private _ensureNotLoaded() {
    if (this._loaded) {
      throw new Error(`Plugin already marked as loaded: ${this.id}`);
    }
  }

  private _hidden = false;
  /**
   * Whether this plugin should be hidden from the help command
   */
  hidden(hidden = true) {
    this._ensureNotLoaded();

    this._hidden = hidden;
    return this;
  }

  private _configSchema?: ConfigSchema;
  /**
   * Define a schema for this plugin's configuration.
   *
   * The schema is used to validate the configuration set for this plugin.
   */
  configSchema<TConfigSchema extends BaseSchema<any, any, any>>(
    schema: TConfigSchema,
  ): Plugin<PluginId, Depends, Interactions, TConfigSchema, Api> {
    this._ensureNotLoaded();

    // @ts-expect-error
    this._configSchema = schema;
    // @ts-expect-error
    return this;
  }

  get config(): InferOutput<ConfigSchema> {
    return getConfig().pluginsConfig[this.id];
  }

  constructor(id: PluginId, name: string, description: string) {
    super();

    this.id = id;
    this.name = name;
    this.description = description;
  }

  private _depends?: Depends;
  dependencies: PluginId extends keyof Plugins
    ? Depends extends readonly string[] // ensure dependencies are defined
      ? string[] extends Depends // ensure dependencies are marked with `as const`
        ? null
        : {
            [SubPluginId in Depends[number] &
              keyof Plugins]: Plugins[SubPluginId];
          }
      : null
    : null = null as any;

  /**
   * Plugin IDs that this plugin depends on. They will be loaded before
   * this plugin, and accessible via `this.dependencies`.
   */
  depends<Depends extends string[]>(
    ...depends: Depends
  ): Plugin<PluginId, Depends, Interactions, ConfigSchema, Api> {
    this._ensureNotLoaded();

    // @ts-expect-error
    this._depends = depends;

    // @ts-expect-error
    return this;
  }

  private _commands: (Command & ThisType<this>)[] = [];
  /**
   * Register a command for this plugin.
   */
  registerCommand(command: Command & ThisType<this>) {
    this._ensureNotLoaded();

    this._commands.push(command);
    return this;
  }

  private _interactions?: Interactions;
  /**
   * Register an interaction for this plugin.
   */
  registerInteraction<
    TKey extends string,
    T,
    TThis extends Plugin<
      PluginId,
      Depends,
      Interactions & { [key in TKey]: T },
      ConfigSchema,
      Api
    >,
  >({
    name,
    handler,
  }: {
    name: TKey;
    handler: Interaction<T>;
  } & ThisType<TThis>): TThis {
    this._ensureNotLoaded();

    if (!this._interactions) {
      // @ts-expect-error
      this._interactions = {};
    }

    // @ts-expect-error
    this._interactions[name] = handler;

    // @ts-expect-error
    return this;
  }

  interactionContinuation<
    THandler extends keyof Interactions & string,
    T extends Interactions[THandler],
  >(handler: THandler, message: string, data?: T) {
    return new InteractionContinuation(this, handler, message, data);
  }

  // @ts-expect-error
  api: Api = null;
  registerApi<TApi extends { [key: string]: unknown }>(
    api: TApi &
      ThisType<
        Plugin<PluginId, Depends, Interactions, ConfigSchema, Api & TApi>
      >,
  ): Plugin<PluginId, Depends, Interactions, ConfigSchema, Api & TApi> {
    if (!this.api) {
      // @ts-expect-error
      this.api = {};
    }

    for (const key in api) {
      const value = api[key];

      if (typeof value === "function") {
        this.api[key] = value.bind(this);
      } else {
        this.api[key] = value;
      }
    }

    // @ts-expect-error
    return this;
  }

  private _client: Client | null = null;
  get client() {
    if (!this._client) {
      throw new Error("Plugin does not have a client");
    }
    return this._client;
  }

  private _db?: Database | null;
  get db() {
    if (!this._db) {
      this._db = new Database(`db/plugins/${this.id}.sqlite`, {
        strict: true,
      });
      this._db.exec("PRAGMA journal_mode = WAL;");
    }

    return this._db;
  }

  private _logger?: ConsolaInstance;
  get logger() {
    if (!this._logger) {
      this._logger = consola.withTag(this.id);
    }
    return this._logger;
  }
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

  /**
   * Optional rate limits for this command.
   *
   * It is a good idea to rate limit commands that interact with
   * external APIs to prevent abuse.
   */
  rateLimit?: RateLimit[];

  handler: Interaction<string>;
}

export interface Interaction<T> {
  ({}: BaseMessageInteractionHandlerArgs & {
    data: T;
  }): MaybePromise<InteractionResult> | InteractionResultGenerator;
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

interface BaseRespondableInteractionHandlerArgs {
  respond(result: InteractionResult): Promise<Message | null>;
}

type BasicInteractionResult = string | boolean | void | MessageMedia;

export type InteractionResult =
  | BasicInteractionResult
  | InteractionContinuation;

export type InteractionResultGenerator =
  | Generator<BasicInteractionResult, InteractionResult, unknown>
  | AsyncGenerator<BasicInteractionResult, InteractionResult, unknown>;

export class InteractionContinuation {
  plugin;
  handler;
  message;
  data;

  _timer: Timer | null = null;

  constructor(
    plugin: Plugin<string, any, any>,
    handler: string,
    message: string,
    data?: unknown,
  ) {
    this.plugin = plugin;
    this.message = message;
    this.handler = handler;
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
