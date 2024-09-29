import { rm, watch } from "node:fs/promises";
import { join } from "node:path";

import consola from "consola";

import { getPluginIdFromPath, scanPlugins } from "../plugins";

const typesFile = "./src/plugins/types.d.ts";

await rm(typesFile, { force: true });

const shouldWatch =
  process.argv.includes("--watch") && !process.argv.includes("--no-watch");

async function generateAllPluginTypes() {
  const plugins = new Map<string, string>();
  await scanPlugins(plugins);

  if (!plugins.size) {
    await rm(typesFile, { force: true });
    return;
  }

  let imports = "";
  let declaration = `\
declare module "../plugins" {
  interface Plugins {
`;

  const sortedPlugins = Array.from(plugins.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  for (const [pluginId, path] of sortedPlugins) {
    const importSpecifier = `Plugin_${pluginId}`;

    imports += `\
import type ${importSpecifier} from "${path}";
`;

    declaration += `\
    ${pluginId}: InstanceType<${importSpecifier}>;
`;
  }

  declaration += `\
  }
}`;

  const contents = `\
${imports}
${declaration}
`;

  await Bun.write(typesFile, contents);
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

    await generateAllPluginTypes();
  }
}
