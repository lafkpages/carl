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
   * How many seconds to wait before allowing a user to run a command again.
   */
  ratelimit: {
    admin: number;
    trusted: number;
  };
  // TODO: implement ratelimits
}
