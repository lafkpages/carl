import { object, optional, string, tuple, union } from "valibot";

import { Plugin } from "../../plugins";

export default class extends Plugin<"openaichat"> {
  readonly id = "openaichat";
  readonly name = "OpenAI Chat";
  readonly description = "Chat with the bot instead of using commands.";
  readonly version = "0.0.1";
  readonly depends = ["openai"] as const;

  readonly configSchema = optional(
    object({
      regex: optional(union([string(), tuple([string(), string()])]), [
        String.raw`(.*\bcarl\b.+|.+\bcarl\b.*)`,
        "i",
      ]),
    }),
    {},
  );

  constructor() {
    super();

    this.on(
      "message",
      async ({ message, sender, didHandle, chat, respond }) => {
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
          await respond(await this.dependencies.openai.askAi(message.body));
        }
      },
    );
  }
}
