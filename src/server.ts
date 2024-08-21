import Elysia, { t } from "elysia";

import { handleOAuthCallback } from "./google";

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
