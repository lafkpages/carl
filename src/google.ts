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

const db = new Database("db/google.sqlite", { strict: true });
db.run(`--sql
  CREATE TABLE IF NOT EXISTS google_tokens (
    user TEXT PRIMARY KEY,
    refresh_token TEXT,
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

function saveUserToken(
  user: string,
  tokens: Credentials,
  scope?: string | null,
) {
  consola.debug("Saving Google token for user", user);

  db.run<[string]>(
    `--sql
      INSERT OR IGNORE INTO google_tokens (user) VALUES (?)
    `,
    [user],
  );

  db.run<[string | null, string | null, string | null, string]>(
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

function serialiseScope(scope: Set<string>): string {
  return Array.from(scope).join(" ");
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
  saveUserToken(stateInfo.payload.user, tokens, serialiseScope(scope));

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
  const storedScope = parseScope(storedToken?.scope);

  if (storedToken?.refresh_token) {
    const newClient = createClient(user);
    clients.set(user, {
      scope: parseScope(storedToken.scope),
      client: newClient,
    });

    newClient.setCredentials({
      refresh_token: storedToken.refresh_token,
      access_token: storedToken.access_token,
    });
    saveUserToken(
      user,
      (await newClient.refreshAccessToken()).credentials,
      storedToken.scope,
    );

    if (hasScopes(storedScope, scope)) {
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
  onAuthRequired(
    generateTemporaryShortLink(
      client.generateAuthUrl({
        access_type: "offline",
        scope: Array.from(scopesToRequest),
        state: encrypt(pasetoKey, {
          user,
          linkId,
          scope: serialiseScope(scopesToRequest),
          exp: "5m",
        }),
      }),
      linkId,
    ).url,
  );
  return null;
}

export function getScopes(user: string) {
  const cachedClient = clients.get(user);
  if (cachedClient) {
    return cachedClient.scope;
  }

  const storedToken = db
    .query<{ scope: string | null }, [string]>(
      `--sql
        SELECT scope
        FROM google_tokens
        WHERE user = ?
      `,
    )
    .get(user);
  return parseScope(storedToken?.scope);
}
