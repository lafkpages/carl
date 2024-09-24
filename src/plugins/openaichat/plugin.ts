import type { Plugin } from "./$types";

import { getConfig } from "../../config";

export default {
  id: "openaichat",
  name: "OpenAI Chat",
  description: "Chat with the bot instead of using commands.",
  version: "0.0.1",

  async onMessage({
    message,
    sender,
    didHandleCommand,
    chat,
    config,
    pluginApis,
  }) {
    if (didHandleCommand) {
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

declare module "../../config" {
  interface PluginsConfig {
    openaichat?: {
      regex?: string | [string, string];
    };
  }
}
