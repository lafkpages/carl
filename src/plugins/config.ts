import type { Config } from "../config";
import type { Plugin } from "../plugins";

import { flatten } from "flat";

import { getRawConfig, updateConfig } from "../config";
import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

export default {
  id: "config",
  name: "Config",
  description: "Bot configuration commands.",
  version: "0.0.1",

  commands: [
    {
      name: "config",
      description: "",
      minLevel: PermissionLevel.ADMIN,

      async handler({ config, rest }) {
        const [, key, value] = rest.match(/^(\S+)(?:\s+(\S+))?$/i) || [];

        if (!key) {
          return `\
\`\`\`
${await getRawConfig()}
\`\`\``;
        }

        if (!value) {
          const configFlat = flatten<Config, {}>(config, { safe: true });

          if (key in configFlat) {
            return `*\`${key}\`*: \`${JSON.stringify(configFlat[key as keyof typeof configFlat])}\``;
          }

          throw new CommandError(`config key \`${key}\` not found`);
        }

        updateConfig({
          [key]: value,
        });

        return true;
      },
    },
  ],
} satisfies Plugin;
