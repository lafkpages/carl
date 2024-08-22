import { consola } from "consola";
import { Elysia, t } from "elysia";
import { nanoid } from "nanoid";

import { config } from "./config";
import { handleOAuthCallback } from "./google";

export const publicUrl = config.publicUrl || "http://localhost:3000";

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

export const server = new Elysia()
  .get("/", () => "Hello from WhatsApp PA!")
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
  .listen(3000);
