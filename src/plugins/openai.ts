import type {
  ChatCompletionMessageParam,
  ChatModel,
} from "openai/resources/index";
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

      /**
       * Maximum length of a conversation to summarise.
       */
      maxConversationLength?: number;
    };
  }
}

const defaultModel: ChatModel = "gpt-4o-mini";
const defaultMaxConversationLength = 500;

function returnResponse(response: string | null) {
  if (response) {
    return response;
  } else {
    throw new CommandError("no response from AI");
  }
}

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

        return returnResponse(completion.choices[0].message.content);
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

        return returnResponse(completion.choices[0].message.content);
      },
    },
    {
      name: "summariseconvo",
      description: "Summarise a conversation",
      minLevel: PermissionLevel.TRUSTED,
      rateLimit: 60000,

      async handler({ message, logger, config }) {
        if (!message.hasQuotedMsg) {
          throw new CommandError(
            "reply to a message you want to summarise from",
          );
        }

        const quotedMsg = await message.getQuotedMessage();
        const chat = await quotedMsg.getChat();

        const conversation: ChatCompletionMessageParam[] = [];

        const messages = await chat.fetchMessages({
          limit:
            config.pluginsConfig.openai?.maxConversationLength === -1
              ? Infinity
              : config.pluginsConfig.openai?.maxConversationLength ||
                defaultMaxConversationLength,
        });

        let found = false;
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i];
          const user = await message.getContact();

          const name = user.pushname.replace(/[^a-zA-Z0-9_-]/g, "");

          conversation.push({
            role: "user",
            name,
            content: message.body,
          });

          if (message.id._serialized === quotedMsg.id._serialized) {
            found = true;
            break;
          }
        }

        if (!found) {
          throw new CommandError("quoted message not found in conversation");
        }

        conversation.push({
          role: "system",
          content:
            "Summarise the following WhatsApp conversation. Provide bullet points for each topic that was discussed.",
        });

        conversation.reverse();

        logger.debug("conversation:", conversation);

        const completion = await openai.chat.completions.create({
          messages: conversation,
          model: config.pluginsConfig.openai?.model || defaultModel,
        });

        logger.debug("AI response:", completion);

        return returnResponse(completion.choices[0].message.content);
      },
    },
  ];
}
