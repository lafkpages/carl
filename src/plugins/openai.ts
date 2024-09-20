import type { Database } from "bun:sqlite";
import type { ConsolaInstance } from "consola";
import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatModel,
} from "openai/resources/index";
import type { Contact, Message } from "whatsapp-web.js";
import type { Plugin } from "../plugins";

import Mime from "mime";
import objectHash from "object-hash";
import OpenAI, { toFile } from "openai";
import { MessageMedia, MessageTypes } from "whatsapp-web.js";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

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
  database: Database,
  logger: ConsolaInstance,
  body?: string | null,
  includeNames = true,
): Promise<ChatCompletionMessageParam | null> {
  let contact: Contact;
  if (includeNames) {
    contact = await message.getContact();
  }

  body ||= message.body;

  let content: string | ChatCompletionContentPart[];

  if (message.hasMedia) {
    const media = await message.downloadMedia();

    if (media.mimetype.startsWith("image")) {
      content = [
        {
          type: "text",
          text: body,
        },
        {
          type: "image_url",
          image_url: { url: `data:${media.mimetype};base64,${media.data}` },
        },
      ];
    } else {
      try {
        content = await transcribeMessage(message, database);
      } catch (err) {
        logger.error(
          "Error transcribing message in whatsappMessageToChatCompletionMessage:",
          err,
        );
        content = body;
      }
    }
  } else {
    content = body;
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

async function transcribeMessage(message: Message, database: Database) {
  if (!message.hasMedia) {
    throw new CommandError("message does not contain media");
  }

  if (
    message.type !== MessageTypes.AUDIO &&
    message.type !== MessageTypes.VOICE &&
    message.type !== MessageTypes.VIDEO
  ) {
    throw new CommandError("message must be an audio, voice or video message");
  }

  const media = await message.downloadMedia();

  // underscore to prevent collisions between other type of hash from objectHash
  const hash = `_${Bun.hash(media.data).toString(36)}`;

  const cached = database!
    .query<
      {
        value: string;
      },
      [string]
    >("SELECT value FROM cache WHERE key = ?")
    .get(hash);

  if (cached) {
    return cached.value;
  }

  let filename = media.filename;
  if (!filename) {
    const ext = Mime.getExtension(media.mimetype);

    if (ext) {
      filename = `${hash}.${ext}`;
    }
  }

  if (!filename) {
    throw new CommandError("could not determine file extension");
  }

  const transcription = await openai.audio.transcriptions.create({
    file: await toFile(Buffer.from(media.data, "base64"), filename),
    model: "whisper-1",
  });

  database!.run<[string, string]>(
    "INSERT INTO cache (key, value) VALUES (?, ?)",
    [hash, transcription.text],
  );

  return transcription.text;
}

function getCached<Bin extends boolean = false>(
  hash: string,
  database: Database,
  bin?: Bin,
) {
  return (
    database!
      .query<
        {
          value: Bin extends true ? Uint8Array : string;
        },
        [string]
      >(`SELECT value FROM ${bin ? "binary_cache" : "cache"} WHERE key = ?`)
      .get(hash)?.value || null
  );
}

export default {
  id: "openai",
  name: "OpenAI",
  description: "Talk to ChatGPT on WhatsApp!",
  version: "0.0.1",

  database: true,

  commands: [
    {
      name: "ai",
      description: "Ask a question to AI",
      minLevel: PermissionLevel.TRUSTED,
      rateLimit: 5000,

      async handler({ rest, logger, config, database }) {
        // todo: handle thread of replies as chat history
        // for future self: this is really hard, good luck

        const messages: ChatCompletionMessageParam[] = [
          {
            role: "user",
            content: rest,
          },
        ];

        const hash = objectHash(messages);

        const cached = getCached(hash, database!);

        if (cached) {
          return cached;
        }

        const completion = await openai.chat.completions.create({
          messages,
          model: config.pluginsConfig.openai?.model || defaultModel,
        });

        logger.debug("AI response:", completion);

        const response = returnResponse(completion.choices[0].message.content);

        database!.run<[string, string]>(
          "INSERT INTO cache (key, value) VALUES (?, ?)",
          [hash, response],
        );

        return response;
      },
    },
    {
      name: "summarise",
      description: "Summarise a given text or message",
      minLevel: PermissionLevel.TRUSTED,
      rateLimit: 5000,

      async handler({ message, rest, logger, config, database }) {
        let messages: ChatCompletionMessageParam[] = [
          {
            role: "system",
            content: "Give a brief summary of the following WhatsApp messages.",
          },
        ];

        let quotedMsg: Message | null = null;
        if (message.hasQuotedMsg) {
          quotedMsg = await message.getQuotedMessage();
          const completion = await whatsappMessageToChatCompletionMessage(
            quotedMsg,
            database!,
            logger,
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
            database!,
            logger,
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

        const hash = objectHash(messages);

        const cached = getCached(hash, database!);

        if (cached) {
          if (quotedMsg) {
            await quotedMsg.reply(cached, undefined, {
              linkPreview: false,
            });
            return;
          }
          return cached;
        }

        const completion = await openai.chat.completions.create({
          messages,
          model: config.pluginsConfig.openai?.model || defaultModel,
        });

        logger.debug("AI response:", completion);

        const response = returnResponse(completion.choices[0].message.content);

        database!.run<[string, string]>(
          "INSERT INTO cache (key, value) VALUES (?, ?)",
          [hash, response],
        );

        if (quotedMsg) {
          await quotedMsg.reply(response, undefined, { linkPreview: false });
          return;
        }
        return response;
      },
    },
    {
      name: "summariseconvo",
      description: "Summarise a conversation",
      minLevel: PermissionLevel.TRUSTED,
      rateLimit: 60000,

      async handler({ message, logger, config, database }) {
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

          if (currentMessage.id._serialized === message.id._serialized) {
            continue;
          }

          const completionMessage =
            await whatsappMessageToChatCompletionMessage(
              currentMessage,
              database!,
              logger,
            );

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

        const hash = objectHash(conversation);

        const cached = getCached(hash, database!);

        if (cached) {
          return cached;
        }

        logger.debug("conversation:", conversation);

        const completion = await openai.chat.completions.create({
          messages: conversation,
          model: config.pluginsConfig.openai?.model || defaultModel,
        });

        logger.debug("AI response:", completion);

        const response = returnResponse(
          completion.choices[0].message.content,
        ).replace(/^( *[*-] +)\*(\*.+?\*)\*/gm, "$1$2");

        database!.run<[string, string]>(
          "INSERT INTO cache (key, value) VALUES (?, ?)",
          [hash, response],
        );

        return response;
      },
    },
    {
      name: "transcribe",
      description: "Transcribe an audio message",
      minLevel: PermissionLevel.TRUSTED,
      rateLimit: 60000,

      async handler({ message, database }) {
        if (!message.hasQuotedMsg) {
          throw new CommandError("reply to an audio message");
        }

        const quotedMsg = await message.getQuotedMessage();

        await quotedMsg.reply(await transcribeMessage(quotedMsg, database!));
      },
    },
    {
      name: "generate",
      description: "Generate an image using DALL-E",
      minLevel: PermissionLevel.TRUSTED,
      rateLimit: 60000,

      async handler({ message, rest, sender, logger, database }) {
        const hash = `image_${Bun.hash(rest).toString(36)}`;

        const cache = getCached(hash, database!, true);

        let imageData: string;
        let caption: string | undefined;

        if (cache) {
          imageData = cache.toBase64();
        } else {
          const result = await openai.images.generate({
            model: "dall-e-2",
            prompt: rest,
            size: "256x256",
            quality: "standard",
            user: sender,
            response_format: "b64_json",
          });

          const [image] = result.data;

          imageData = image.b64_json!;
          caption = image.revised_prompt;

          database!.run<[string, Uint8Array]>(
            "INSERT INTO binary_cache (key, value) VALUES (?, ?)",
            [hash, Buffer.from(imageData, "base64")],
          );
        }

        await message.reply(
          new MessageMedia("image/png", imageData),
          undefined,
          { caption },
        );
      },
    },
  ],

  onLoad({ database }) {
    database!.run(`--sql
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    database!.run(`--sql
      CREATE TABLE IF NOT EXISTS binary_cache (
        key TEXT PRIMARY KEY,
        value BLOB NOT NULL
      );
    `);
  },
} satisfies Plugin;
