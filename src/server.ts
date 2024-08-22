import Elysia, { t } from "elysia";

import { config } from "./config";
import { handleOAuthCallback } from "./google";

export const publicUrl = config.publicUrl || "http://localhost:3000";

export const server = new Elysia()
  .get("/", () => "Hello from WhatsApp PA!")
  .get(
    "/auth/google",
    async ({ query: { code, state }, error }) => {
      return await handleOAuthCallback(code, state, error);
    },
    { query: t.Object({ code: t.String(), state: t.String() }) },
  )
  .listen(3000);
