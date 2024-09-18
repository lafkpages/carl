import type { Plugin } from "../plugins";

import translate, { languages } from "google-translate-api-x";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

function checkLanguageCode(code: string) {
  if (!(code in languages)) {
    throw new CommandError(
      "invalid language code. Use `/translatelangs` to see a list of available languages.",
    );
  }
}

declare module "../config" {
  interface PluginsConfig {
    translate?: {
      defaultLanguage?: keyof typeof languages;
    };
  }
}

export default {
  id: "translate",
  name: "Translate",
  description: "Text language translation and detection",
  version: "0.0.1",

  database: true,

  commands: [
    {
      name: "translate",
      description: "Translate text to a different language",
      minLevel: PermissionLevel.NONE,
      rateLimit: 10000,

      async handler({
        message,
        rest,
        sender,
        config,
        database,
        client,
        logger,
      }) {
        let text = "";
        let to = "";

        if (message.hasQuotedMsg) {
          const quotedMsg = await message.getQuotedMessage();
          text = quotedMsg.body;
          to = rest;
        } else if (rest) {
          const [, toArg, textArg] = rest.match(/^\((\w+)\)\s+(.+)$/) || [];

          if (toArg && textArg) {
            to = toArg;
            text = textArg;
          } else {
            text = rest;
          }
        }

        if (!text) {
          throw new CommandError(
            "no text to translate provided.\n\nUsage: `/translate (en) Hola, que tal?`\nThe language code in parentheses is optional. If not provided, it will use your default configured language.\n\nYou can also reply to a message with `/translate` to translate it, optionally providing a language code.",
          );
        }

        if (!to) {
          const toEntry = database!
            .query<
              { to: string },
              [string]
            >('SELECT "to" FROM translate WHERE user = ?')
            .get(sender);
          to =
            toEntry?.to ||
            config.pluginsConfig.translate?.defaultLanguage ||
            "en";

          if (!toEntry) {
            database!.run<[string, string]>(
              'INSERT INTO translate (user, "to") VALUES (?, ?)',
              [sender, to],
            );

            // TODO: allow configuring default language
            await client.sendMessage(
              sender,
              `Your default language for \`/translate\` has been set to ${languages[to as keyof typeof languages]}. You can change it by using \`/translatelang <language>\``,
            );
          }
        }

        checkLanguageCode(to);

        const translation = await translate(text, {
          to,
        });

        return translation.text;
      },
    },
    {
      name: "translatelang",
      description: "Set your default language for translations",
      minLevel: PermissionLevel.NONE,

      handler({ rest, sender, database }) {
        if (!rest) {
          throw new CommandError("no language provided");
        }

        checkLanguageCode(rest);

        const changes = database!.run<[string, string]>(
          'INSERT OR REPLACE INTO translate (user, "to") VALUES (?, ?)',
          [sender, rest],
        );

        if (changes.changes === 0) {
          throw new CommandError("failed to set default language");
        }

        return true;
      },
    },
    {
      name: "translatelangs",
      description: "List available languages for translation",
      minLevel: PermissionLevel.NONE,
      rateLimit: 10000,

      async handler() {
        let msg = "Available languages for translation:";
        for (const [code, name] of Object.entries(languages)) {
          msg += `\n* \`${code}\`: ${name}`;
        }

        return msg;
      },
    },
  ],

  onLoad({ database }) {
    database!.run(`\
CREATE TABLE IF NOT EXISTS "translate" (
  "user" TEXT,
  "to" TEXT NOT NULL,
  PRIMARY KEY ("user")
);`);
  },
} satisfies Plugin;
