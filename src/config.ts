import type { BaseSchema, InferOutput } from "valibot";
import type { Plugin, Plugins } from "./plugins";

import { EventEmitter } from "node:events";

import consola from "consola";
import { defu } from "defu";
import {
  array,
  boolean,
  check,
  looseObject,
  nullish,
  number,
  object,
  optional,
  parse,
  pipe,
  record,
  regex,
  string,
  union,
  void_,
} from "valibot";

import { rateLimitSchema } from "./ratelimits";
import { isInGithubCodespace } from "./utils";

function configSchema() {
  return object({
    /**
     * A list of plugin IDs to load.
     */
    plugins: array(pipe(string(), regex(/^[a-z]+$/))),

    /**
     * User IDs that should be given certain permissions.
     */
    whitelist: object({
      admin: array(string()),
      trusted: array(string()),
    }),

    /**
     * Per-user rate limits for different permission levels,
     * in milliseconds.
     */
    ratelimit: object({
      admin: array(rateLimitSchema),
      trusted: array(rateLimitSchema),
      default: array(rateLimitSchema),
    }),

    /**
     * Global command aliases. The key is the command name for the alias,
     * and the value is the command name to alias.
     */
    aliases: optional(record(string(), string()), {}),

    /**
     * Configuration for specific plugins.
     */
    pluginsConfig: optional(looseObject(pluginsConfig), {}),

    /**
     * If true, disables Puppeteer's headless mode.
     */
    visible: pipe(
      optional(boolean(), false),
      check((visible) => {
        if (visible && isInGithubCodespace) {
          return false;
        }
        return true;
      }, "Visible mode is not supported in GitHub Codespaces"),
    ),

    port: optional(number(), 3000),

    /**
     * The base URL at which this instance is hosted.
     */
    publicUrl: union([nullish(string()), void_()]),

    /**
     * The frequency at which to check the public URL for availability,
     * in milliseconds. Set to 0 to disable.
     */
    publicUrlPingCheckFrequency: optional(number(), 300_000),

    helpPageSize: optional(number(), 300),

    sentry: optional(union([string(), boolean()]), true),
  });
}

export type Config = InferOutput<ReturnType<typeof configSchema>> & {
  pluginsConfig?: PluginsConfig;
};

type InferPluginConfig<TPlugin, TFallback = never> =
  TPlugin extends Plugin<string, any, any, infer T> ? T : TFallback;

export type PluginsConfig = {
  [pluginId: string]: unknown;
} & {
  [PluginId in keyof Plugins]: InferPluginConfig<Plugins[PluginId], unknown>;
};

const pluginsConfig: {
  [pluginId: string]: BaseSchema<any, any, any>;
} = {};

export function setPluginConfig(
  pluginId: string,
  pluginConfig?: BaseSchema<any, any, any>,
) {
  if (pluginConfig) {
    pluginsConfig[pluginId] = pluginConfig;

    config = parse(configSchema(), rawConfig) as Config;

    return;
  }

  delete pluginsConfig[pluginId];
}

const configFile = Bun.file(require.resolve("../config.json"));

let rawConfig: unknown = await configFile.json();
let config = parse(configSchema(), rawConfig) as Config;
export const initialConfig = config;

consola.debug("Loaded initial config:", initialConfig);

export async function getRawConfig() {
  return await configFile.text();
}

export function getConfig() {
  return config;
}

export async function updateConfig(newConfig: Partial<Config>) {
  const mergedConfig = defu(newConfig, config);

  await _updateConfig(mergedConfig);

  configEvents.emit("update", mergedConfig, Object.keys(newConfig));
}

export async function updateConfigRaw(newConfig: unknown) {
  configEvents.emit("update", await _updateConfig(newConfig));
}

async function _updateConfig(newConfig: unknown) {
  config = parse(configSchema(), newConfig) as Config;

  for (const [pluginId, schema] of Object.entries(pluginsConfig)) {
    if (!schema) {
      continue;
    }

    parse(schema, config.pluginsConfig[pluginId]);
  }

  await Bun.write(configFile, JSON.stringify(newConfig, null, 2));
  rawConfig = newConfig;

  return config;
}

export const configEvents = new EventEmitter<{
  update: [newConfig: Config, modifiedProperties?: string[]];
}>();

configEvents.on("update", (newConfig, modifiedProperties) => {
  consola.debug("Updated config properties:", modifiedProperties);
  consola.verbose("Updated config:", newConfig);
});
