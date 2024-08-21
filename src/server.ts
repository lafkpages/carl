import Elysia from "elysia";

export const server = new Elysia()
  .get("/", () => "Hello from WhatsApp PA!")
  .listen(3000);
