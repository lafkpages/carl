import type { InferOutput } from "valibot";

import consola from "consola";
import { defu } from "defu";
import {
  array,
  boolean,
  looseObject,
  number,
  object,
  optional,
  parse,
  pipe,
  record,
  regex,
  string,
} from "valibot";

const configSchema = object({
  /**
   * A list of plugins to load.
   *
   * Each plugin can either be a path to a plugin file,
   * or the name of a built-in plugin.
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
    admin: number(),
    trusted: number(),
    default: number(),
  }),

  /**
   * Global command aliases. The key is the command name for the alias,
   * and the value is the command name to alias.
   */
  aliases: optional(record(string(), string()), {}),

  /**
   * Configuration for specific plugins.
   */
  pluginsConfig: optional(record(string(), looseObject({})), {}),

  /**
   * If true, disables Puppeteer's headless mode.
   */
  visible: optional(boolean(), false),

  /**
   * The base URL at which this instance is hosted.
   */
  publicUrl: optional(string(), "http://localhost:3000"),

  /**
   * The frequency at which to check the public URL for availability,
   * in milliseconds. Set to 0 to disable.
   */
  publicUrlPingCheckFrequency: optional(number(), 300000),

  helpPageSize: optional(number(), 300),
});

export type Config = InferOutput<typeof configSchema>;

export interface PluginsConfig {
  [pluginId: string]: any;
}

const configFile = Bun.file(require.resolve("../config.json"));

let config = parse(configSchema, await configFile.json());
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

  await Bun.write(configFile, JSON.stringify(mergedConfig, null, 2));

  config = mergedConfig;
}
