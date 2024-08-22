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
    access_token TEXT
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

function saveUserToken(user: string, tokens: Credentials) {
  if (tokens.refresh_token) {
    db.run<[string, string, string | null]>(
      "INSERT OR REPLACE INTO google_tokens (user, refresh_token, access_token) VALUES (?, ?, ?)",
      [user, tokens.refresh_token, tokens.access_token || null],
    );
  }
}

const client = createClient();
const clients = new Map<string, OAuth2Client>();

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

  const stateInfo = decrypt<{ user: string; linkId: string }>(pasetoKey, state);

  let userClient = clients.get(stateInfo.payload.user);

  if (!userClient) {
    userClient = createClient(stateInfo.payload.user);
    clients.set(stateInfo.payload.user, userClient);
  }

  userClient.setCredentials(tokens);
  saveUserToken(stateInfo.payload.user, tokens);

  consola.debug(`Google authenticated user ${stateInfo.payload.user}`);
  removeTemporaryShortLink(stateInfo.payload.linkId);

  return "Authenticated!";
}

export async function getClient(
  user: string,
  scope: string | string[],
  onAuthRequired: (url: string) => void,
) {
  const cachedClient = clients.get(user);
  if (cachedClient) {
    return cachedClient;
  }

  const storedToken = db
    .query<
      {
        refresh_token: string;
        access_token: string | null;
      },
      [string]
    >("SELECT refresh_token, access_token FROM google_tokens WHERE user = ?")
    .get(user);

  if (storedToken) {
    const newClient = createClient(user);
    clients.set(user, newClient);

    newClient.setCredentials(storedToken);
    saveUserToken(user, (await newClient.refreshAccessToken()).credentials);

    consola.debug(`Google authenticated user ${user} from database`);

    return newClient;
  }

  const linkId = nanoid();
  onAuthRequired(
    generateTemporaryShortLink(
      client.generateAuthUrl({
        access_type: "offline",
        scope,
        state: encrypt(pasetoKey, { user, linkId, exp: "5m" }),
      }),
      linkId,
    ).url,
  );
  return null;
}
