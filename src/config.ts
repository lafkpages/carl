export interface Config {
  $schema?: string;

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

  /**
   * API key for https://www.football-data.org.
   */
  footballDataDotOrgApiKey: string | null;
}
