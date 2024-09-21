import type { Config } from "../config";

import { flatten, unflatten } from "flat";
import { isValiError } from "valibot";

import {
  getConfig,
  getRawConfig,
  updateConfig,
  updateConfigRaw,
} from "../config";
import { CommandError } from "../error";
import { PermissionLevel } from "../perms";
import plugin from "../plugins";

export default plugin({
  id: "config",
  name: "Config",
  description: "Bot configuration commands.",
  version: "0.0.1",

  commands: [
    {
      name: "config",
      description: "View or update the bot configuration.",
      minLevel: PermissionLevel.ADMIN,

      async handler({ rest }) {
        const [, key, value] = rest.match(/^(\S+)(?:\s+(\S+))?$/i) || [];

        if (!key) {
          return `\
\`\`\`${(await getRawConfig()).trim()}\`\`\``;
        }

        if (!value) {
          const configFlat = flatten<Config, {}>(getConfig(), { safe: true });

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
    {
      name: "configimport",
      description: "Import a new configuration.",
      minLevel: PermissionLevel.ADMIN,

      async handler({ rest }) {
        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(rest);
        } catch (err) {
          throw new CommandError(`failed to parse value: ${err}`);
        }

        try {
          await updateConfigRaw(parsedValue);
        } catch (err) {
          if (isValiError(err)) {
            throw new CommandError(err.message);
          }
          throw err;
        }

        return true;
      },
    },
  ],
});
