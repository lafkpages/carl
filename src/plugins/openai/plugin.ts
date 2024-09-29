import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources/index";
import type { Contact, Message } from "whatsapp-web.js";
import type { InteractionArgs, InteractionResult } from "../../plugins";

import Mime from "mime";
import objectHash from "object-hash";
import OpenAI, { toFile } from "openai";
import { number, object, optional, string } from "valibot";
import { MessageMedia, MessageTypes } from "whatsapp-web.js";

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { InteractionContinuation, Plugin } from "../../plugins";

const openai = new OpenAI();

export default class extends Plugin<"openai"> {
  readonly id = "openai";
  readonly name = "OpenAI";
  readonly description = "Talk to ChatGPT on WhatsApp!";
  readonly version = "0.0.1";
  readonly database = true;

  readonly configSchema = optional(
    object({
      model: optional(string(), "gpt-4o-mini"),

      /**
       * Maximum length of a conversation to summarise.
       */
      maxConversationLength: optional(number(), 500),

      systemPrompt: optional(
        string(),
        "You are Carl, a helpful WhatsApp AI assistant. Do not use markdown in responses, instead use WhatsApp formatting.",
      ),
    }),
    {},
  );

  constructor() {
    super();

    this.registerCommands([
      {
        name: "ai",
        description: "Ask a question to AI",
        minLevel: PermissionLevel.TRUSTED,
        rateLimit: [
          {
            duration: 5000,
            max: 1,
          },
          {
            // 20 per hour
            duration: 3_600_000,
            max: 20,
          },
        ],

        async handler({ data }) {
          return await this.askAi(data);
        },
      },
      {
        name: "summarise",
        description: "Summarise a given text or message",
        minLevel: PermissionLevel.TRUSTED,
        rateLimit: [
          {
            duration: 5000,
            max: 1,
          },
          {
            // 20 per hour
            duration: 3_600_000,
            max: 20,
          },
        ],

        async handler({ message, data }) {
          let messages: ChatCompletionMessageParam[] = [
            { role: "system", content: this.config.systemPrompt },
            {
              role: "system",
              content:
                "Give a brief summary of the following WhatsApp messages.",
            },
          ];

          let quotedMsg: Message | null = null;
          if (message.hasQuotedMsg) {
            quotedMsg = await message.getQuotedMessage();
            const completion =
              await this.whatsappMessageToChatCompletionMessage(
                quotedMsg,
                null,
                false,
              );

            if (completion) {
              messages.push(completion);
            }
          }

          if (data || message.hasMedia) {
            const completion =
              await this.whatsappMessageToChatCompletionMessage(
                message,
                data,
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

          const cached = this.getCached(hash);

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
            model: this.config.model,
          });

          this.logger.debug("AI response:", completion);

          const response = this.returnResponse(
            completion.choices[0].message.content,
          );

          this.setCache(hash, response);

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
        rateLimit: [
          {
            // once per 10 minutes
            duration: 600_000,
            max: 1,
          },
        ],

        async handler({ message }) {
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
              this.config.maxConversationLength === -1
                ? Infinity
                : this.config.maxConversationLength,
          });

          let found = false;
          for (let i = messages.length - 1; i >= 0; i--) {
            const currentMessage = messages[i];

            if (currentMessage.id._serialized === message.id._serialized) {
              continue;
            }

            const completionMessage =
              await this.whatsappMessageToChatCompletionMessage(currentMessage);

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

          conversation.push(
            { role: "system", content: this.config.systemPrompt },
            {
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
            },
          );

          conversation.reverse();

          const hash = objectHash(conversation);

          const cached = this.getCached(hash);

          if (cached) {
            return cached;
          }

          this.logger.debug("conversation:", conversation);

          const completion = await openai.chat.completions.create({
            messages: conversation,
            model: this.config.model,
          });

          this.logger.debug("AI response:", completion);

          const response = this.returnResponse(
            completion.choices[0].message.content,
          ).replace(/^( *[*-] +)\*(\*.+?\*)\*/gm, "$1$2");

          this.setCache(hash, response);

          return response;
        },
      },
      {
        name: "transcribe",
        description: "Transcribe an audio message",
        minLevel: PermissionLevel.TRUSTED,
        rateLimit: [
          {
            duration: 5000,
            max: 1,
          },
          {
            // 20 per hour
            duration: 3_600_000,
            max: 20,
          },
        ],

        async handler({ message }) {
          if (!message.hasQuotedMsg) {
            throw new CommandError("reply to an audio message");
          }

          const quotedMsg = await message.getQuotedMessage();

          await quotedMsg.reply(await this.transcribeMessage(quotedMsg));
        },
      },
      {
        name: "generate",
        description: "Generate an image using DALL-E",
        minLevel: PermissionLevel.TRUSTED,
        rateLimit: [
          {
            // one per minute
            duration: 60_000,
            max: 1,
          },
        ],

        async handler({ message, data, sender }) {
          const hash = `image_${Bun.hash(data).toString(36)}`;

          const cache = this.getCached(hash, true);

          let imageData: string;
          let caption: string | undefined;

          if (cache) {
            imageData = cache.toBase64();
          } else {
            const result = await openai.images.generate({
              model: "dall-e-2",
              prompt: data,
              size: "256x256",
              quality: "standard",
              user: sender,
              response_format: "b64_json",
            });

            const [image] = result.data;

            imageData = image.b64_json!;
            caption = image.revised_prompt;

            this.setCache(hash, Buffer.from(imageData, "base64"), true);
          }

          await message.reply(
            new MessageMedia("image/png", imageData),
            undefined,
            { caption },
          );
        },
      },
      {
        name: "speak",
        description: "Generate speech from text",
        minLevel: PermissionLevel.TRUSTED,
        rateLimit: [
          {
            // one per minute
            duration: 60_000,
            max: 1,
          },
        ],

        async handler({ message, data }) {
          let input = data;

          let quotedMsg: Message | null = null;
          if (message.hasQuotedMsg) {
            quotedMsg = await message.getQuotedMessage();
            input = quotedMsg.body;
          }

          if (!input) {
            throw new CommandError("no text provided");
          }

          const hash = `speech_${Bun.hash(input).toString(36)}`;

          const cache = this.getCached(hash, true);

          if (cache) {
            const media = new MessageMedia("audio/mpeg", cache.toBase64());

            if (quotedMsg) {
              await quotedMsg.reply(media);
              return;
            }
            return media;
          }

          const result = await openai.audio.speech.create({
            input,
            model: "tts-1",
            voice: "fable",
          });
          const resultData = new Uint8Array(await result.arrayBuffer());

          this.setCache(hash, resultData, true);

          const media = new MessageMedia("audio/mpeg", resultData.toBase64());

          if (quotedMsg) {
            await quotedMsg.reply(media);
            return;
          }
          return media;
        },
      },
    ]);

    this.on("load", () => {
      this.db.run(`--sql
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

      this.db.run(`--sql
      CREATE TABLE IF NOT EXISTS binary_cache (
        key TEXT PRIMARY KEY,
        value BLOB NOT NULL
      );
    `);
    });
  }

  returnResponse(response: string | null) {
    if (response) {
      return response;
    } else {
      throw new CommandError("no response from AI");
    }
  }

  async askAi(message: string) {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: this.config.systemPrompt },
      {
        role: "user",
        content: message,
      },
    ];

    const hash = objectHash(messages);

    const cached = this.getCached(hash);

    let response: string;
    if (cached) {
      response = cached;
    } else {
      const completion = await openai.chat.completions.create({
        messages,
        model: this.config.model,
      });

      this.logger.debug("AI response:", completion);

      response = this.returnResponse(completion.choices[0].message.content);

      this.setCache(hash, response);
    }

    messages.push({
      role: "assistant",
      content: response,
    });

    return new InteractionContinuation(
      response,
      this,
      this.aiContinuation,
      messages,
    );
  }

  async aiContinuation({
    message,
    data,
  }: InteractionArgs<
    ChatCompletionMessageParam[]
  >): Promise<InteractionResult> {
    const messages: ChatCompletionMessageParam[] = [
      ...data,
      { role: "user", content: message.body },
    ];

    const hash = objectHash(messages);

    const cached = this.getCached(hash);

    let response: string;
    if (cached) {
      response = cached;
    } else {
      const completion = await openai.chat.completions.create({
        messages,
        model: this.config.model,
      });

      response = this.returnResponse(completion.choices[0].message.content);

      this.setCache(hash, response);
    }

    messages.push({
      role: "assistant",
      content: response,
    });

    return new InteractionContinuation(
      response,
      this,
      this.aiContinuation,
      messages,
    );
  }

  getCached<Bin extends boolean = false>(hash: string, bin?: Bin) {
    return (
      this.db
        .query<
          {
            value: Bin extends true ? Uint8Array : string;
          },
          [string]
        >(`SELECT value FROM ${bin ? "binary_cache" : "cache"} WHERE key = ?`)
        .get(hash)?.value || null
    );
  }

  setCache<Bin extends boolean = false>(
    hash: string,
    value: Bin extends true ? NodeJS.TypedArray : string,
    bin?: Bin,
  ) {
    this.db.run<[string, Bin extends true ? NodeJS.TypedArray : string]>(
      `INSERT INTO ${bin ? "binary_cache" : "cache"} (key, value) VALUES (?, ?)`,
      [hash, value],
    );
  }

  async whatsappMessageToChatCompletionMessage(
    message: Message,
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
          content = await this.transcribeMessage(message);
        } catch (err) {
          this.logger.error(
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

  async transcribeMessage(message: Message) {
    if (!message.hasMedia) {
      throw new CommandError("message does not contain media");
    }

    if (
      message.type !== MessageTypes.AUDIO &&
      message.type !== MessageTypes.VOICE &&
      message.type !== MessageTypes.VIDEO
    ) {
      throw new CommandError(
        "message must be an audio, voice or video message",
      );
    }

    const media = await message.downloadMedia();

    // underscore to prevent collisions between other type of hash from objectHash
    const hash = `_${Bun.hash(media.data).toString(36)}`;

    const cached = this.getCached(hash);

    if (cached) {
      return cached;
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

    this.setCache(hash, transcription.text);

    return transcription.text;
  }
}
