import type { Config } from "./config";

import { mkdir } from "node:fs/promises";

import { init } from "@sentry/bun";

import { configEvents, initialConfig } from "./config";

function initSentry(config: Config) {
  return config.sentry
    ? init({
        dsn:
          typeof config.sentry === "string"
            ? config.sentry
            : "https://83d6f2993580f85ccc38910233e24e82@o4505375756124161.ingest.us.sentry.io/4507963249852416",

        // Tracing
        tracesSampleRate: 1.0, // Capture 100% of the transactions
      })
    : null;
}

export let sentry = initSentry(initialConfig);

configEvents.on("update", async (newConfig, modifiedProperties) => {
  if (!modifiedProperties.includes("sentry")) {
    return;
  }

  await sentry?.close();
  sentry = initSentry(newConfig);
});

await mkdir("db/plugins", { recursive: true });
