import type { error as ElysiaError } from "elysia/error";
import type { Credentials, OAuth2Client } from "google-auth-library";

import { mkdir } from "node:fs/promises";

import { Database } from "bun:sqlite";
import { consola } from "consola";
import { google } from "googleapis";
import { nanoid } from "nanoid";
import { decrypt, encrypt, generateKeys } from "paseto-ts/v4";

import {
  generateTemporaryShortLink,
  publicUrl,
  removeTemporaryShortLink,
} from "./server";

await mkdir("db", { recursive: true });

const db = new Database("db/core.sqlite", { strict: true });
db.run(`
CREATE TABLE IF NOT EXISTS google_tokens (
  user TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  scope TEXT
);
`);

const pasetoKey = generateKeys("local");

function createClient(user?: string) {
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
      saveUserToken(user, tokens);
    });
  }

  return client;
}

function saveUserToken(user: string, tokens: Credentials, scope?: string) {
  if (tokens.refresh_token) {
    db.run<[string, string, string | null]>(
      "INSERT OR REPLACE INTO google_tokens (user, refresh_token, access_token) VALUES (?, ?, ?)",
      [user, tokens.refresh_token, tokens.access_token || null],
    );

    if (scope) {
      db.run<[string, string]>(
        "UPDATE google_tokens SET scope = ? WHERE user = ?",
        [scope, user],
      );
    }
  }
}

function parseScope(scope?: string | string[] | null): Set<string> {
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
}

const client = createClient();
const clients = new Map<string, { scope: Set<string>; client: OAuth2Client }>();

export async function handleOAuthCallback(
  code: string,
  state: string,
  error: typeof ElysiaError,
) {
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token) {
    error(500);
    return;
  }

  const stateInfo = decrypt<{
    user: string;
    linkId: string;
    scope: string | string[];
  }>(pasetoKey, state);
  const scope = parseScope(stateInfo.payload.scope);

  let userClient = clients.get(stateInfo.payload.user);

  if (userClient) {
    userClient.scope = scope;
  } else {
    userClient = { scope, client: createClient(stateInfo.payload.user) };
    clients.set(stateInfo.payload.user, userClient);
  }

  userClient.client.setCredentials(tokens);
  saveUserToken(stateInfo.payload.user, tokens);

  consola.debug(
    "Google authenticated user",
    stateInfo.payload.user,
    "with scope:",
    scope,
  );
  removeTemporaryShortLink(stateInfo.payload.linkId);

  return "Authenticated!";
}

function hasScopes(currentScopes: Set<string>, requiredScopes: Set<string>) {
  for (const s of requiredScopes) {
    if (!currentScopes.has(s)) {
      return false;
    }
  }

  return true;
}

export async function getClient(
  user: string,
  _scope: string | string[],
  onAuthRequired: (url: string) => void,
) {
  const scope = parseScope(_scope);

  const cachedClient = clients.get(user);
  if (cachedClient) {
    if (hasScopes(cachedClient.scope, scope)) {
      return cachedClient.client;
    }
  }

  const storedToken = db
    .query<
      {
        refresh_token: string;
        access_token: string | null;
        scope: string | null;
      },
      [string]
    >(
      "SELECT refresh_token, access_token, scope FROM google_tokens WHERE user = ?",
    )
    .get(user);

  if (storedToken) {
    const newClient = createClient(user);
    clients.set(user, {
      scope: parseScope(storedToken.scope),
      client: newClient,
    });

    newClient.setCredentials({
      refresh_token: storedToken.refresh_token,
      access_token: storedToken.access_token,
    });
    saveUserToken(user, (await newClient.refreshAccessToken()).credentials);

    if (hasScopes(parseScope(storedToken.scope), scope)) {
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

  const linkId = nanoid();
  onAuthRequired(
    generateTemporaryShortLink(
      client.generateAuthUrl({
        access_type: "offline",
        scope: Array.from(scopesToRequest),
        state: encrypt(pasetoKey, {
          user,
          linkId,
          scope: Array.from(scopesToRequest).join(" "),
          exp: "5m",
        }),
      }),
      linkId,
    ).url,
  );
  return null;
}
