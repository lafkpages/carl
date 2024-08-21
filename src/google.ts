import type { error as ElysiaError } from "elysia/error";
import type { Credentials, OAuth2Client } from "google-auth-library";

import { Database } from "bun:sqlite";
import consola from "consola";
import { google } from "googleapis";
import { decrypt, encrypt, generateKeys } from "paseto-ts/v4";

const db = new Database("db/core.sqlite", { strict: true });
db.run(`
CREATE TABLE IF NOT EXISTS google_tokens (
    user TEXT PRIMARY KEY,
    refresh_token TEXT NOT NULL
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
    redirectUri: "http://localhost:3000/auth/google",
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
    db.run<[string, string]>(
      "INSERT OR REPLACE INTO google_tokens (user, refresh_token) VALUES (?, ?)",
      [user, tokens.refresh_token],
    );
  }
}

const client = createClient();
const clients = new Map<string, OAuth2Client>();

function getOAuthUrl(scope: string | string[], state: string) {
  return client.generateAuthUrl({
    access_type: "offline",
    scope,
    state,
  });
}

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

  const stateInfo = decrypt<{ user: string }>(pasetoKey, state);

  let userClient = clients.get(stateInfo.payload.user);

  if (!userClient) {
    userClient = createClient(stateInfo.payload.user);
    clients.set(stateInfo.payload.user, userClient);
  }

  userClient.setCredentials(tokens);
  saveUserToken(stateInfo.payload.user, tokens);

  consola.debug(`Google authenticated user ${stateInfo.payload.user}`);

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
      },
      [string]
    >("SELECT refresh_token FROM google_tokens WHERE user = ?")
    .get(user);

  if (storedToken) {
    const newClient = createClient(user);
    clients.set(user, newClient);

    newClient.setCredentials(storedToken);

    consola.debug(`Google authenticated user ${user} from database`);

    return newClient;
  }

  onAuthRequired(getOAuthUrl(scope, encrypt(pasetoKey, { user, exp: "5m" })));
  return null;
}
