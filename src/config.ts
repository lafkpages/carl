import { readFile } from "node:fs/promises";

import consola from "consola";
import { read, update } from "rc9";

export interface Config {
  /**
   * A list of plugins to load.
   *
   * Each plugin can either be a path to a plugin file,
   * or the name of a built-in plugin.
   */
  plugins: string[];

  /**
   * User IDs that should be given certain permissions.
   */
  whitelist: {
    admin: string[];
    trusted: string[];
  };

  /**
   * Per-user rate limits for different permission levels,
   * in milliseconds.
   */
  ratelimit: {
    admin: number;
    trusted: number;
    default: number;
  };

  /**
   * Global command aliases. The key is the command name for the alias,
   * and the value is the command name to alias.
   */
  aliases?: Record<string, string>;

  /**
   * Configuration for specific plugins.
   */
  pluginsConfig?: PluginsConfig;

  /**
   * If true, disables Puppeteer's headless mode.
   */
  visible?: boolean;

  /**
   * The base URL at which this instance is hosted.
   *
   * @default "http://localhost:3000"
   */
  publicUrl?: string;

  /**
   * The frequency at which to check the public URL for availability,
   * in milliseconds. Set to 0 to disable.
   *
   * @default 300000
   */
  publicUrlPingCheckFrequency?: number;

  helpPageSize?: number;
}

export interface PluginsConfig {
  [pluginId: string]: any;
}

const configName = ".conf";

export const initialConfig = getConfig();

consola.debug("Loaded initial config:", initialConfig);

export async function getRawConfig() {
  return await readFile(configName, "utf-8");
}

export function getConfig() {
  return read<Config>(configName);
}

export function getConfigLazy(): {
  _config: Config | null;
  config: Config;
} {
  return {
    _config: null,
    get config() {
      if (!this._config) {
        this._config = getConfig();
      }
      return this._config;
    },
  };
}

export function updateConfig(
  newConfig: Partial<Config> & Record<string, unknown>,
) {
  update(newConfig, configName);
}
