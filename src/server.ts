import { consola } from "consola";
import { Elysia, t } from "elysia";
import { nanoid } from "nanoid";

import { initialConfig } from "./config";
import { handleOAuthCallback } from "./google";
import { isInGithubCodespace } from "./utils";

export const publicUrl =
  initialConfig.publicUrl ||
  (isInGithubCodespace
    ? `https://${process.env.CODESPACE_NAME}-${initialConfig.port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : `http://localhost:${initialConfig.port}`);

const tempShortLinks = new Map<string, string>();

export function generateTemporaryShortLink(url: string, id?: string) {
  if (tempShortLinks.has(id || "")) {
    if (id) {
      throw new Error("ID already exists");
    }

    return generateTemporaryShortLink(url);
  }

  id ||= nanoid();

  consola.debug("Generated temporary short link:", { id, url });

  tempShortLinks.set(id, url);
  return { id, url: new URL(`s/${id}`, publicUrl).href };
}

export function removeTemporaryShortLink(id: string) {
  consola.debug("Removed temporary short link:", id);
  tempShortLinks.delete(id);
}

const publicUrlPingCheckFrequency =
  initialConfig.publicUrlPingCheckFrequency ?? 300000;
let pingCheckTimeout: Timer;

export async function pingCheck() {
  clearTimeout(pingCheckTimeout);

  const pingCode = nanoid(6);

  const resp = await fetch(new URL(`ping?code=${pingCode}`, publicUrl));

  if (!resp.ok) {
    throw new Error("Failed to ping server via public URL");
  }

  const body = (await resp.text()).trim();

  if (body !== pingCode) {
    throw new Error("Invalid ping response");
  }

  pingCheckTimeout = setTimeout(pingCheck, publicUrlPingCheckFrequency);
  pingCheckTimeout.unref();
}

export const server = new Elysia()
  .get("/", () => "Hello from WhatsApp PA!")
  .get("/ping", ({ query: { code } }) => code, {
    query: t.Object({ code: t.String({ maxLength: 6 }) }),
  })
  .get("/s/:id", ({ params: { id }, redirect, error }) => {
    consola.debug("Redirecting temporary short link:", id);

    const url = tempShortLinks.get(id);

    if (url) {
      return redirect(url, 307);
    }

    return error(404);
  })
  .get(
    "/auth/google",
    async ({ query: { code, state }, error }) => {
      return await handleOAuthCallback(code, state, error);
    },
    { query: t.Object({ code: t.String(), state: t.String() }) },
  )
  .listen(initialConfig.port, () => {
    setTimeout(pingCheck, publicUrlPingCheckFrequency);
  });
