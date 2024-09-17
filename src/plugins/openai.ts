import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatModel,
} from "openai/resources/index";
import type { Contact, Message } from "whatsapp-web.js";
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

async function whatsappMessageToChatCompletionMessage(
  message: Message,
  body?: string | null,
  includeNames = true,
): Promise<ChatCompletionMessageParam | null> {
  let contact: Contact;
  if (includeNames) {
    contact = await message.getContact();
  }

  let content: string | ChatCompletionContentPart[];

  if (message.hasMedia) {
    const media = await message.downloadMedia();

    content = [
      {
        type: "text",
        text: message.body,
      },
      {
        type: "image_url",
        image_url: { url: `data:${media.mimetype};base64,${media.data}` },
      },
    ];
  } else {
    content = body || message.body;
  }

  if (!content) {
    return null;
  }

  return {
    role: "user",
    content,
    name: includeNames
      ? contact!.pushname?.replace(/[^a-zA-Z0-9_-]/g, "")
      : undefined,
  };
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
        let messages: ChatCompletionMessageParam[] = [
          {
            role: "system",
            content: "Give a brief summary of the following WhatsApp messages.",
          },
        ];

        if (message.hasQuotedMsg) {
          const quotedMsg = await message.getQuotedMessage();
          const completion = await whatsappMessageToChatCompletionMessage(
            quotedMsg,
            null,
            false,
          );

          if (completion) {
            messages.push(completion);
          }
        }

        if (rest || message.hasMedia) {
          const completion = await whatsappMessageToChatCompletionMessage(
            message,
            rest,
            false,
          );

          if (completion) {
            messages.push(completion);
          }
        }

        if (messages.length <= 1) {
          throw new CommandError("no text provided");
        }

        const completion = await openai.chat.completions.create({
          messages,
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
          const currentMessage = messages[i];

          const completionMessage =
            await whatsappMessageToChatCompletionMessage(currentMessage);

          if (completionMessage) {
            conversation.push(completionMessage);
          }

          if (currentMessage.id._serialized === quotedMsg.id._serialized) {
            found = true;
            break;
          }
        }

        if (!found) {
          throw new CommandError("quoted message not found in conversation");
        }

        conversation.push({
          role: "system",
          content: `\
Briefly summarise the following WhatsApp conversation. Provide bullet points for each topic that was discussed.
Follow the format below, and do not include a title.

* *Topic 1*: short sentence summary
* *Topic 2*: short sentence summary
* *Topic 3*: short sentence summary

...

Brief overall summary
`,
        });

        conversation.reverse();

        logger.debug("conversation:", conversation);

        const completion = await openai.chat.completions.create({
          messages: conversation,
          model: config.pluginsConfig.openai?.model || defaultModel,
        });

        logger.debug("AI response:", completion);

        const response = returnResponse(completion.choices[0].message.content);
        return response.replace(/^( *[*-] +)\*(\*.+?\*)\*/gm, "$1$2");
      },
    },
  ];
}
