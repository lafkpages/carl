import { array, nullish, object, parse, string, union } from "valibot";

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

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

export default class extends Plugin<"dictionary"> {
  readonly id = "dictionary";
  readonly name = "Dictionary";
  readonly description =
    "A dictionary plugin for looking up words and their definitions.";
  readonly version = "0.0.1";

  constructor() {
    super();

    this.registerCommands([
      {
        name: "defineword",
        description: "Define a word.",
        minLevel: PermissionLevel.NONE,
        rateLimit: [
          {
            duration: 5000,
            max: 1,
          },
        ],

        async handler({ data }) {
          const resp = await fetch(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(data)}`,
          ).then((r) => r.json());

          this.logger.debug("Dictionary API response:", resp);

          const dictData = parse(schema, resp);

          if ("message" in dictData) {
            throw new CommandError(dictData.message);
          }

          if (dictData.length === 0) {
            throw new CommandError("No definitions found.");
          }

          let msg = "";

          for (const entry of dictData) {
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
    ]);
  }
}
