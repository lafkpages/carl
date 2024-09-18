import type { Config } from "../config";
import type { Command } from "../plugins";

import { flatten, unflatten } from "flat";
import { isValiError } from "valibot";

import { getRawConfig, updateConfig } from "../config";
import { CommandError } from "../error";
import { PermissionLevel } from "../perms";
import { Plugin } from "../plugins";

export default class extends Plugin {
  id = "config";
  name = "Config";
  description = "Bot configuration commands.";
  version = "0.0.1";

  commands: Command[] = [
    {
      name: "config",
      description: "View or update the bot configuration.",
      minLevel: PermissionLevel.ADMIN,

      async handler({ config, rest, logger }) {
        const [, key, value] = rest.match(/^(\S+)(?:\s+(\S+))?$/i) || [];

        if (!key) {
          return `\
\`\`\`${(await getRawConfig()).trim()}\`\`\``;
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

        try {
          await updateConfig(
            unflatten({
              [key]: parsedValue,
            }),
          );
        } catch (err) {
          if (isValiError(err)) {
            throw new CommandError(err.message);
          }
          throw err;
        }

        return true;
      },
    },
  ];
}
