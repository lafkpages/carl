import _config from "../config.json";

export const config = _config as Config;

export interface Config {
  $schema?: string;

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
}

export interface PluginsConfig {
  [pluginId: string]: any;
}
