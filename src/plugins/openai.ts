import type { Plugin } from "../plugins";

import OpenAI from "openai";

import { PermissionLevel } from "../perms";

const openai = new OpenAI();

export default {
  id: "openai",
  name: "OpenAI",
  description: "Talk to ChatGPT on WhatsApp!",
  version: "0.0.1",

  commands: [
    {
      name: "ai",
      description: "Ask a question to AI",
      minLevel: PermissionLevel.TRUSTED,

      async handler({ message, client, rest }) {
        // todo: handle thread of replies as chat history
        // for future self: this is really hard, good luck

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
          {
            name: message.from,
            role: "user",
            content: rest,
          },
        ];

        const completion = await openai.chat.completions.create({
          messages,
          model: "gpt-3.5-turbo",
        });

        const response = completion.choices[0].message.content;

        if (response) {
          return response;
        } else {
          return false;
        }
      },
    },
  ],
} satisfies Plugin;
