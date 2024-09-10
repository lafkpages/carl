import type { Config } from "../config";
import type { Plugin } from "../plugins";

import { flatten, unflatten } from "flat";

import { updateConfig } from "../config";
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
      description: "View or update the bot configuration.",
      minLevel: PermissionLevel.ADMIN,

      async handler({ config, rest }) {
        const [, key, value] = rest.match(/^(\S+)(?:\s+(\S+))?$/i) || [];

        if (!key) {
          //           return `\
          // \`\`\`
          // ${await getRawConfig()}
          // \`\`\``;
          throw new CommandError("config dump not implemented");
        }

        if (!value) {
          const configFlat = flatten<Config, {}>(config, { safe: true });

          if (key in configFlat) {
            return `*\`${key}\`*: \`${JSON.stringify(configFlat[key as keyof typeof configFlat])}\``;
          }

          throw new CommandError(`config key \`${key}\` not found`);
        }

        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(value);
        } catch (err) {
          throw new CommandError(`failed to parse value: ${err}`);
        }

        updateConfig(
          unflatten({
            [key]: parsedValue,
          }),
        );

        return true;
      },
    },
  ],
} satisfies Plugin;
