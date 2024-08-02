import type { Plugin } from "../plugins";

import { array, nullish, object, parse, string, union } from "valibot";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

const schema = union([
  array(
    object({
      word: string(),
      phonetic: string(),
      phonetics: array(
        object({
          text: string(),
          audio: nullish(string()),
        }),
      ),
      origin: nullish(string()),
      meanings: array(
        object({
          partOfSpeech: string(),
          definitions: array(
            object({
              definition: string(),
              example: nullish(string()),
              synonyms: array(string()),
              antonyms: array(string()),
            }),
          ),
        }),
      ),
      sourceUrls: nullish(array(string())),
    }),
  ),
  object({
    title: nullish(string()),
    message: string(),
    resolution: nullish(string()),
  }),
]);

export default {
  id: "dictionary",
  name: "Dictionary",
  description:
    "A dictionary plugin for looking up words and their definitions.",
  version: "0.0.1",

  commands: [
    {
      name: "defineword",
      description: "Define a word.",
      minLevel: PermissionLevel.TRUSTED,

      async handler({ rest, logger }) {
        const resp = await fetch(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(rest)}`,
        ).then((r) => r.json());

        logger.debug("Dictionary API response:", resp);

        const data = parse(schema, resp);

        if ("message" in data) {
          throw new CommandError(data.message);
        }

        if (data.length === 0) {
          throw new CommandError("No definitions found.");
        }

        let msg = "";

        for (const entry of data) {
          msg += `*${entry.word}* (${entry.phonetic})\n`;

          for (const meaning of entry.meanings) {
            msg += `\n${meaning.partOfSpeech}\n`;

            for (const definition of meaning.definitions) {
              msg += `* ${definition.definition}\n`;
              if (definition.example) {
                msg += `    - _${definition.example}_\n`;
              }
            }
          }

          msg += "\n";
        }

        return msg.slice(0, -2);
      },
    },
  ],
} satisfies Plugin;
