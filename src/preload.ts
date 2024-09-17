import { mkdir } from "node:fs/promises";

await mkdir("db/plugins", { recursive: true });
