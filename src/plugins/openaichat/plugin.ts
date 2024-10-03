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

  readonly nlp = {
    en: [
      {
        intent: "agent.name",
        utterances: [
          "what is your name",
          "what should I call you",
          "whats your name",
          "who are you",
          "what are you called",
          "what do you call yourself",
        ],
        answers: [
          "I'm Carl, a helpful WhatsApp assistant! How can I assist you today?",
          "I am a WhatsApp assistant named Carl! How can I help you today?",
          "You can call me Carl, your personal WhatsApp assistant! How can I help you today?",
          "I'm a WhatsApp bot named Carl. How can I help you today?",
        ],
      },
      {
        intent: "agent.how",
        utterances: [
          "how are you",
          "how are you doing",
          "how do you do",
          "how are you today",
          "how do you feel",
          "what's up",
          "are you okay",
        ],
        answers: [
          "I'm doing great, thank you! How can I assist you today?",
          "I'm doing well, thank you! How can I help you today?",
          "I'm doing fine, thank you! How can I assist you today?",
        ],
      },
      {
        intent: "reminders.add",
        utterances: [
          "set a reminder",
          "add a reminder",
          "remind me to {{ reminder }} at {{ time }}",
          "set a reminder for {{ reminder }} at {{ time }}",
          "remind me to {{ reminder }} at {{ time }} on {{ date }}",
          "set a reminder for {reminder} at {{ time }} on {{ date }}",
          "remind me to {{ reminder }} at {{ time }} on {{ date }} {{ time }}",
          "set a reminder for {reminder} at {{ time }} on {{ date }} {{ time }}",
          "remind me to {{ reminder }} at {{ time }} on {{ date }} {{ time }} {{ date }}",
          "set a reminder for {{ reminder }} at {{ time }} on {{ date }} {{ time }} {{ date }}",
        ],
        answers: [
          "TODO: Add reminder to {{ reminder }} at {{ time }} on {{ date }}",
        ],
      },
    ],
  };

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
