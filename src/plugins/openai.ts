import type { ChatModel } from "openai/resources/index";
import type { Command } from "../plugins";

import OpenAI from "openai";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";
import { Plugin } from "../plugins";

const openai = new OpenAI();

declare module "../config" {
  interface PluginsConfig {
    openai?: {
      model?: ChatModel;
    };
  }
}

const defaultModel: ChatModel = "gpt-4o-mini";

export default class extends Plugin {
  id = "openai";
  name = "OpenAI";
  description = "Talk to ChatGPT on WhatsApp!";
  version = "0.0.1";

  commands: Command[] = [
    {
      name: "ai",
      description: "Ask a question to AI",
      minLevel: PermissionLevel.TRUSTED,
      rateLimit: 5000,

      async handler({ rest, logger, config }) {
        // todo: handle thread of replies as chat history
        // for future self: this is really hard, good luck

        const completion = await openai.chat.completions.create({
          messages: [
            {
              role: "user",
              content: rest,
            },
          ],
          model: config.pluginsConfig.openai?.model || defaultModel,
        });

        logger.debug("AI response:", completion);

        const response = completion.choices[0].message.content;

        if (response) {
          return response;
        } else {
          throw new CommandError("no response from AI");
        }
      },
    },
    {
      name: "summarise",
      description: "Summarise a given text or message",
      minLevel: PermissionLevel.TRUSTED,
      rateLimit: 5000,

      async handler({ message, rest, logger, config }) {
        let text = rest;
        if (!text && message.hasQuotedMsg) {
          text = (await message.getQuotedMessage()).body;
        }

        if (!text) {
          throw new CommandError("no text provided");
        }

        const completion = await openai.chat.completions.create({
          messages: [
            {
              role: "system",
              content: "Give a brief summary of the following text.",
            },
            { role: "user", content: text },
          ],
          model: config.pluginsConfig.openai?.model || defaultModel,
        });

        logger.debug("AI response:", completion);

        const response = completion.choices[0].message.content;

        if (response) {
          return response;
        } else {
          throw new CommandError("no response from AI");
        }
      },
    },
  ];
}
