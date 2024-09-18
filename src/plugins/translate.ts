import type { Config } from "../config";
import type { Plugin } from "../plugins";

import { libreTranslate } from "libretranslate-ts";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

const apiKey = process.env.TRANSLATE_API_KEY;

if (apiKey) {
  libreTranslate.setApiKey(apiKey);
}

function updateConfig(config: Config) {
  if (config.pluginsConfig?.translate?.url) {
    libreTranslate.setApiEndpoint(config.pluginsConfig.translate.url);
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
      name: "detect",
      description: "Detect the language of a text",
      minLevel: PermissionLevel.NONE,
      rateLimit: 2000,

      async handler({ message, rest, config }) {
        updateConfig(config);

        let text = "";

        if (message.hasQuotedMsg) {
          const quotedMsg = await message.getQuotedMessage();

          if (quotedMsg.body) {
            text = quotedMsg.body;
          }
        } else if (rest) {
          text = rest;
        }

        if (!text) {
          throw new CommandError("no text to detect language provided");
        }

        const language = await libreTranslate.detect(text);

        if (language.error) {
          throw new CommandError(language.error);
        }

        return `\`${language.language}\``;
      },
    },
    {
      name: "translate",
      description: "Translate text to a different language",
      minLevel: PermissionLevel.NONE,
      rateLimit: 10000,

      async handler({ message, rest, sender, config, database, client }) {
        updateConfig(config);

        let from = "auto";
        let text = "";

        if (message.hasQuotedMsg) {
          const quotedMsg = await message.getQuotedMessage();

          if (quotedMsg.body) {
            if (rest) {
              const [, fromArg] = rest.match(/^\((\w+)\)/) || [];

              from = fromArg || rest;
            }

            text = quotedMsg.body;
          }
        } else if (rest) {
          const [, fromArg, textArg] = rest.match(/^\((\w+)\)\s+(.+)$/) || [];

          if (fromArg && textArg) {
            from = fromArg;
            text = textArg;
          } else {
            text = rest;
          }
        }

        if (!text) {
          throw new CommandError(
            "no text to translate provided.\n\nUsage: `/translate (es) Hola, que tal?`\nThe language code in parentheses is optional. If not provided, the language will be detected automatically, but detection will delay the response.\n\nYou can also reply to a message with `/translate` to translate it.",
          );
        }

        if (from === "auto") {
          const detectedLanguage = await libreTranslate.detect(text);

          if (detectedLanguage.error) {
            throw new CommandError(
              `failed to detect language: ${detectedLanguage.error}`,
            );
          }

          from = detectedLanguage.language;

          if (!from) {
            throw new CommandError("could not detect source language");
          }
        } else if (!from) {
          throw new CommandError("source language not specified");
        }

        const toEntry = database!
          .query<
            { to: string },
            [string]
          >('SELECT "to" FROM translate WHERE user = ?')
          .get(sender);
        const to = toEntry?.to || "en";

        if (!toEntry) {
          database!.run<[string, string]>(
            'INSERT INTO translate (user, "to") VALUES (?, ?)',
            [sender, to],
          );

          await client.sendMessage(
            sender,
            "Your default language for `/translate` has been set to English. You can change it by using `/translatelang <language>`",
          );
        }

        const translation = await libreTranslate.translate(text, from, to);

        if (translation.error) {
          throw new Error(translation.error);
        }

        return translation.translatedText;
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

      async handler({ config }) {
        updateConfig(config);

        const languages = await libreTranslate.listLanguages();

        if (!languages?.length) {
          throw new CommandError("failed to fetch languages");
        }

        let msg = "Available languages for translation:";
        for (const lang of languages) {
          msg += `\n* \`${lang.code}\`: ${lang.name}`;
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

declare module "../config" {
  interface PluginsConfig {
    translate?: {
      /**
       * The URL to a LibreTranslate server.
       */
      url?: string;
    };
  }
}
