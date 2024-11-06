import type { error as ElysiaError } from "elysia/error";
import type { Credentials, OAuth2Client } from "google-auth-library";
import type { Chat } from "whatsapp-web.js";

import { consola } from "consola";
import { google } from "googleapis";
import { nanoid } from "nanoid";
import { decrypt, encrypt, generateKeys } from "paseto-ts/v4";

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";
import {
  generateTemporaryShortLink,
  removeTemporaryShortLink,
} from "../../server";
import { publicUrl } from "../../server/common";

export default new Plugin("google", "Google", "Google OAuth2 plugin")
  .hidden()
  .registerApi<{
    _oauthClient?: OAuth2Client;
    _oauthClients: Map<string, { scope: Set<string>; client: OAuth2Client }>;
    _pasetoKey: string;
  }>({
    _oauthClients: new Map(),
    _pasetoKey: generateKeys("local"),
  })
  .registerApi({
    _createClient(user?: string) {
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        throw new Error("No Google client ID or secret");
      }

      const client = new google.auth.OAuth2({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: new URL("auth/google", publicUrl).href,
      });

      if (user) {
        client.on("tokens", (tokens) => {
          this.api._saveUserToken(user, tokens);
        });
      }

      return client;
    },

    _saveUserToken(user: string, tokens: Credentials, scope?: string | null) {
      consola.debug("Saving Google token for user", user);

      this.db.run<[string]>(
        `--sql
          INSERT OR IGNORE INTO google_tokens (user) VALUES (?)
        `,
        [user],
      );

      this.db.run<[string | null, string | null, string | null, string]>(
        `--sql
          UPDATE google_tokens SET
            refresh_token = coalesce(?, refresh_token),
            access_token = coalesce(?, access_token),
            scope = coalesce(?, scope)
          WHERE user = ?
        `,
        [
          tokens.refresh_token || null,
          tokens.access_token || null,
          scope || null,
          user,
        ],
      );
    },

    _parseScope(scope?: string | string[] | null): Set<string> {
      if (!scope) {
        return new Set();
      }

      const parsed = new Set<string>();

      for (const s of typeof scope === "string" ? scope.split(" ") : scope) {
        if (s.startsWith("https://www.googleapis.com/auth/")) {
          parsed.add(s);
        } else {
          parsed.add(`https://www.googleapis.com/auth/${s}`);
        }
      }

      return parsed;
    },

    _serialiseScope(scope: Set<string>): string {
      return Array.from(scope).join(" ");
    },

    async handleOAuthCallback(
      code: string,
      state: string,
      error: typeof ElysiaError,
    ) {
      if (!this.api._oauthClient) {
        error(500, "No Google OAuth client");
        return;
      }

      const { tokens } = await this.api._oauthClient.getToken(code);

      if (!tokens.access_token) {
        error(500);
        return;
      }

      const stateInfo = decrypt<{
        user: string;
        linkId: string;
        scope: string | string[];
      }>(this.api._pasetoKey, state);
      const scope = this.api._parseScope(stateInfo.payload.scope);

      let userClient = this.api._oauthClients.get(stateInfo.payload.user);

      if (userClient) {
        userClient.scope = scope;
      } else {
        userClient = {
          scope,
          client: this.api._createClient(stateInfo.payload.user),
        };
        this.api._oauthClients.set(stateInfo.payload.user, userClient);
      }

      userClient.client.setCredentials(tokens);
      this.api._saveUserToken(
        stateInfo.payload.user,
        tokens,
        this.api._serialiseScope(scope),
      );

      consola.debug(
        "Google authenticated user",
        stateInfo.payload.user,
        "with scope:",
        scope,
      );
      removeTemporaryShortLink(stateInfo.payload.linkId);

      return "Authenticated!";
    },

    async getGoogleClient(user: string, chat: Chat, _scope: string | string[]) {
      if (!this.api._oauthClient) {
        throw new Error("No Google OAuth client");
      }

      const scope = this.api._parseScope(_scope);

      const cachedClient = this.api._oauthClients.get(user);
      if (cachedClient) {
        if (this.api._hasScopes(cachedClient.scope, scope)) {
          return cachedClient.client;
        }
      }

      const storedToken = this.db
        .query<
          {
            refresh_token: string;
            access_token: string | null;
            scope: string | null;
          },
          [string]
        >(
          `--sql
        SELECT
          refresh_token,
          access_token,
          scope
        FROM
          google_tokens
        WHERE
          user = ?
      `,
        )
        .get(user);
      const storedScope = this.api._parseScope(storedToken?.scope);

      if (storedToken?.refresh_token) {
        const newClient = this.api._createClient(user);
        this.api._oauthClients.set(user, {
          scope: this.api._parseScope(storedToken.scope),
          client: newClient,
        });

        newClient.setCredentials({
          refresh_token: storedToken.refresh_token,
          access_token: storedToken.access_token,
        });
        this.api._saveUserToken(
          user,
          (await newClient.refreshAccessToken()).credentials,
          storedToken.scope,
        );

        if (this.api._hasScopes(storedScope, scope)) {
          consola.debug("Google authenticated user", user, "from database");

          return newClient;
        }
      }

      const scopesToRequest = scope;

      if (cachedClient) {
        for (const s of cachedClient.scope) {
          scopesToRequest.add(s);
        }
      }

      for (const s of storedScope) {
        scopesToRequest.add(s);
      }

      const linkId = nanoid();
      const url = generateTemporaryShortLink(
        this.api._oauthClient.generateAuthUrl({
          access_type: "offline",
          scope: Array.from(scopesToRequest),
          state: encrypt(this.api._pasetoKey, {
            user,
            linkId,
            scope: this.api._serialiseScope(scopesToRequest),
            exp: "5m",
          }),
        }),
        linkId,
      ).url;

      if (chat.id._serialized === user) {
        throw new CommandError(
          `please login with Google using the link below:\n${url}`,
        );
      } else {
        this.client.sendMessage(
          user,
          `Please login with Google using the link below:\n${url}`,
          { linkPreview: false },
        );

        throw new CommandError(
          `please login with Google using the link sent to you privately`,
        );
      }
    },

    getScopes(user: string) {
      const cachedClient = this.api._oauthClients.get(user);
      if (cachedClient) {
        return cachedClient.scope;
      }

      const storedToken = this.db
        .query<{ scope: string | null }, [string]>(
          `--sql
            SELECT scope
            FROM google_tokens
            WHERE user = ?
          `,
        )
        .get(user);
      return this.api._parseScope(storedToken?.scope);
    },

    _hasScopes(currentScopes: Set<string>, requiredScopes: Set<string>) {
      for (const s of requiredScopes) {
        if (!currentScopes.has(s)) {
          return false;
        }
      }

      return true;
    },
  })
  .registerCommand({
    name: "googleauth",
    description: "View your Google OAuth2 authentication status",
    minLevel: PermissionLevel.NONE,

    async handler({ sender }) {
      const scopes = this.api.getScopes(sender);

      if (!scopes.size) {
        return false;
      }

      let msg = "Authenticated with Google with scopes:";
      for (const scope of scopes) {
        msg += `\n* \`${scope}\``;
      }

      return msg;
    },
  })
  .registerCommand({
    name: "googletest",
    description: "Test Google OAuth",
    minLevel: PermissionLevel.NONE,
    rateLimit: [{ duration: 10000, max: 1 }],
    hidden: true,

    async handler({ sender, chat }) {
      const client = await this.api.getGoogleClient(
        sender,
        chat,
        "https://www.googleapis.com/auth/userinfo.profile",
      );
      const oauth = google.oauth2({
        version: "v2",
        auth: client,
      });

      const { data } = await oauth.userinfo.get();

      return `\`\`\`\n${Bun.inspect(data, { colors: false })}\n\`\`\``;
    },
  })
  .on({
    load() {
      this.db.run(`--sql
        CREATE TABLE IF NOT EXISTS google_tokens (
          user TEXT PRIMARY KEY,
          refresh_token TEXT,
          access_token TEXT,
          scope TEXT
        );
      `);

      this.api._oauthClient = this.api._createClient();
    },
  });
