import type { Message } from "whatsapp-web.js";

import translate, { languages } from "google-translate-api-x";
import { object, optional, picklist } from "valibot";

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

function checkLanguageCode(code: string) {
  if (!(code in languages)) {
    throw new CommandError(
      "invalid language code. Use `/translatelangs` to see a list of available languages.",
    );
  }
}

export default class extends Plugin {
  id = "translate";
  name = "Translate";
  description = "Text language translation and detection";
  version = "0.0.1";
  database = true;

  configSchema = optional(
    object({
      defaultLanguage: optional(
        picklist(Object.keys(languages) as (keyof typeof languages)[]),
        "en",
      ),
    }),
    {},
  );

  constructor() {
    super();

    this.registerCommands([
      {
        name: "translate",
        description: "Translate text to a different language",
        minLevel: PermissionLevel.NONE,
        rateLimit: [
          {
            duration: 3000,
            max: 1,
          },
        ],

        async handler({ message, data, sender }) {
          let text = "";
          let to = "";

          let quotedMsg: Message | null = null;
          if (message.hasQuotedMsg) {
            quotedMsg = await message.getQuotedMessage();
            text = quotedMsg.body;
            to = data;
          } else if (data) {
            const [, toArg, textArg] = data.match(/^\((\w+)\)\s+(.+)$/) || [];

            if (toArg && textArg) {
              to = toArg;
              text = textArg;
            } else {
              text = data;
            }
          }

          if (!text) {
            throw new CommandError(
              "no text to translate provided.\n\nUsage: `/translate (en) Hola, que tal?`\nThe language code in parentheses is optional. If not provided, it will use your default configured language.\n\nYou can also reply to a message with `/translate` to translate it, optionally providing a language code.",
            );
          }

          if (!to) {
            const toEntry = this.db
              .query<
                { to: string },
                [string]
              >('SELECT "to" FROM translate WHERE user = ?')
              .get(sender);
            to = toEntry?.to || this.config.defaultLanguage;

            if (!toEntry) {
              this.db.run<[string, string]>(
                'INSERT INTO translate (user, "to") VALUES (?, ?)',
                [sender, to],
              );

              // TODO: allow configuring default language
              await this.client.sendMessage(
                sender,
                `Your default language for \`/translate\` has been set to ${languages[to as keyof typeof languages]}. You can change it by using \`/translatelang <language>\``,
              );
            }
          }

          checkLanguageCode(to);

          const translation = await translate(text, {
            to,
          });

          if (quotedMsg) {
            await quotedMsg.reply(translation.text);
            return;
          }
          return translation.text;
        },
      },
      {
        name: "translatelang",
        description: "Set your default language for translations",
        minLevel: PermissionLevel.NONE,

        handler({ data, sender }) {
          if (!data) {
            throw new CommandError("no language provided");
          }

          checkLanguageCode(data);

          const changes = this.db.run<[string, string]>(
            'INSERT OR REPLACE INTO translate (user, "to") VALUES (?, ?)',
            [sender, data],
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

        handler() {
          let msg = "Available languages for translation:";
          for (const [code, name] of Object.entries(languages)) {
            msg += `\n* \`${code}\`: ${name}`;
          }

          return msg;
        },
      },
    ]);

    this.on("load", () => {
      this.db.run(`--sql
        CREATE TABLE IF NOT EXISTS "translate" (
          "user" TEXT,
          "to" TEXT NOT NULL,
          PRIMARY KEY ("user")
        );
      `);
    });
  }
}
