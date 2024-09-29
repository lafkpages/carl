import { object, optional, string, tuple, union } from "valibot";

import { getConfig } from "../../config";
import { Plugin } from "../../plugins";

export default class extends Plugin {
  id = "openaichat";
  name = "OpenAI Chat";
  description = "Chat with the bot instead of using commands.";
  version = "0.0.1";

  configSchema = optional(
    object({
      regex: optional(union([string(), tuple([string(), string()])])),
    }),
  );

  constructor() {
    super();

    this.on("message", async ({ message, sender, didHandle, chat }) => {
      if (didHandle) {
        return;
      }

      let shouldRespond = false;

      // respond in DMs
      if (sender === chat.id._serialized) {
        shouldRespond = true;
      } else if (this.config?.regex) {
        const regex =
          typeof this.config?.regex === "string"
            ? new RegExp(this.config.regex)
            : new RegExp(...this.config.regex);

        shouldRespond = regex.test(message.body);
      }

      if (!shouldRespond) {
        return;
      }

      throw new Error("Not implemented");

      return await pluginApis.openai?.askAi(
        message.body,
        getConfig().pluginsConfig.openai,
      );
    });
  }
}
