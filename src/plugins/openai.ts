import type { Command } from "../plugins";

import OpenAI from "openai";

import { PermissionLevel } from "../perms";
import { Plugin } from "../plugins";

const openai = new OpenAI();

export default class extends Plugin {
  id = "openai";
  name = "OpenAI";
  description = "Talk to ChatGPT on WhatsApp!";
  version = "0.0.1";

  commands: Command[] = [
    {
      name: "ai",
      description: "Ask a question to AI",
      minLevel: PermissionLevel.NONE,
      rateLimit: 5000,

      async handler({ rest, logger }) {
        // todo: handle thread of replies as chat history
        // for future self: this is really hard, good luck

        const completion = await openai.chat.completions.create({
          messages: [
            {
              role: "user",
              content: rest,
            },
          ],
          model: "gpt-3.5-turbo",
        });

        logger.debug("AI response:", completion);

        const response = completion.choices[0].message.content;

        if (response) {
          return response;
        } else {
          return false;
        }
      },
    },
  ];
}
