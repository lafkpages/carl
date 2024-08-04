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
  pluginsConfig?: {
    translate?: {
      /**
       * The URL to a LibreTranslate server. D
       */
      url?: string;
    };
    [pluginId: string]: any;
  };

  /**
   * If true, disables Puppeteer's headless mode.
   */
  visible?: boolean;
}
