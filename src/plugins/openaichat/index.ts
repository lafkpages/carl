import { object, optional, string, tuple, union } from "valibot";

import { Plugin } from "../../plugins";

export default new Plugin(
  "openaichat",
  "OpenAI Chat",
  "Chat with the bot instead of using commands.",
)
  .depends("openai")
  .configSchema(
    optional(
      object({
        regex: optional(union([string(), tuple([string(), string()])]), [
          String.raw`(.*\bcarl\b.+|.+\bcarl\b.*)`,
          "i",
        ]),
      }),
      {},
    ),
  )
  .on({
    async message({ message, sender, didHandle, chat, respond }) {
      if (didHandle) {
        return;
      }

      let shouldRespond = false;

      // respond in DMs
      if (sender === chat.id._serialized) {
        shouldRespond = true;
      } else if (this.config.regex) {
        const regex =
          typeof this.config.regex === "string"
            ? new RegExp(this.config.regex)
            : new RegExp(...this.config.regex);

        shouldRespond = regex.test(message.body);
      }

      if (shouldRespond) {
        await respond(await this.dependencies.openai.api.askAi(message.body));
      }
    },
  });
