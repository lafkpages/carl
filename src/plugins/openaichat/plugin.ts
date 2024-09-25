import type { Plugin } from "./$types";

import { object, optional, string, tuple, union } from "valibot";

import { getConfig } from "../../config";

export default {
  id: "openaichat",
  name: "OpenAI Chat",
  description: "Chat with the bot instead of using commands.",
  version: "0.0.1",

  async onMessage({ message, sender, didHandle, chat, config, pluginApis }) {
    if (didHandle) {
      return;
    }

    let shouldRespond = false;

    // respond in DMs
    if (sender === chat.id._serialized) {
      shouldRespond = true;
    } else if (config?.regex) {
      const regex =
        typeof config?.regex === "string"
          ? new RegExp(config.regex)
          : new RegExp(...config.regex);

      shouldRespond = regex.test(message.body);
    }

    if (!shouldRespond) {
      return;
    }

    return await pluginApis.openai?.askAi(
      message.body,
      getConfig().pluginsConfig.openai,
    );
  },
} satisfies Plugin;

export const config = optional(
  object({
    regex: optional(union([string(), tuple([string(), string()])])),
  }),
);
