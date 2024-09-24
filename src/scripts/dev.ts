import { rm, watch } from "node:fs/promises";
import { join, relative } from "node:path";

import consola from "consola";

import { getPluginIdFromPath, scanPlugins } from "../plugins";

await rm("./src/plugins/.types", { recursive: true, force: true });

const shouldWatch = process.argv.includes("--watch");

async function generateAllPluginTypes() {
  const plugins = await scanPlugins();

  for (const [pluginId, path] of plugins) {
    await generatePluginTypes(pluginId, path);
  }
}

async function generatePluginTypes(pluginId: string, path: string) {
  consola.debug("Generating types for plugin:", pluginId, path);

  const pluginIdString =
    pluginId === "TEMPLATE" ? '""' : JSON.stringify(pluginId);

  const srcDir = join("../..", relative(path, join(process.cwd(), "src")));
  const pluginsPath = JSON.stringify(join(srcDir, "plugins.ts"));
  const configPath = JSON.stringify(join(srcDir, "config.ts"));

  await Bun.write(
    join("./src/plugins/.types", relative(process.cwd(), path)).slice(0, -9) +
      "$types.ts",
    `\
import type { PluginDefinition } from ${pluginsPath};
import type _plugin from "./plugin";
import type { PluginConfig } from "./plugin";

export type Plugin = PluginDefinition<${pluginIdString}>;

type plugin = typeof _plugin;

declare module ${pluginsPath} {
  interface Plugins {
    ${pluginIdString}: plugin;
  }
}

declare module ${configPath} {
  interface PluginsConfig {
    ${pluginIdString}?: PluginConfig;
  }
}
`,
  );
}

await generateAllPluginTypes();

if (shouldWatch) {
  const watcher = watch("./src/plugins", { recursive: true });

  for await (const { eventType, filename } of watcher) {
    if (!filename) {
      consola.warn("No filename detected in event:", eventType);
      continue;
    }

    const path = join(process.cwd(), "src/plugins", filename);
    const pluginId = getPluginIdFromPath(path);

    if (!pluginId) {
      consola.debug("Ignoring non-plugin file in watch:", path);
      continue;
    }

    consola.debug("File", eventType, "detected:", pluginId, path);

    await generatePluginTypes(pluginId, path);
  }
}
