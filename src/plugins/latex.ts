import type { Command, OnLoadArgs } from "../plugins";

import { nullable, object, parse, string } from "valibot";
import { MessageMedia } from "whatsapp-web.js";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";
import { Plugin } from "../plugins";

let latex2imageEndpoint: string;

export default class extends Plugin {
  id = "latex";
  name = "LaTeX";
  description = "Plugin for rendering LaTeX equations";
  version = "0.0.1";

  commands: Command[] = [
    {
      name: "latex",
      description: "Render a LaTeX equation",
      minLevel: PermissionLevel.TRUSTED,
      rateLimit: 5000,

      async handler({ message, rest, client, logger }) {
        rest = rest.trim();

        if (!rest) {
          throw new CommandError("you must provide a LaTeX equation to render");
        }

        const latexInput = `\\begin{align*}\n${rest}\n\\end{align*}\n`;

        const { imageUrl, error } = parse(
          object({
            imageUrl: nullable(string()),
            error: nullable(string()),
          }),
          await fetch(latex2imageEndpoint, {
            body: JSON.stringify({
              latexInput,
              outputFormat: "JPG",
              outputScale: "100%",
            }),
            method: "POST",
          }).then((res) => res.json()),
        );

        if (error) {
          throw new CommandError(
            `failed to render LaTeX:\n\`\`\`\n${error}\n\`\`\``,
          );
        }

        if (!imageUrl) {
          throw new CommandError(
            "failed to render LaTeX: no image URL returned",
          );
        }

        logger.info("Rendered LaTeX equation:", imageUrl);

        // TODO: why is the image so massive?
        await client.sendMessage(
          message.from,
          `Rendered LaTeX equation:\n\`\`\`\n${latexInput}\n\`\`\``,
          {
            media: await MessageMedia.fromUrl(imageUrl),
          },
        );

        return true;
      },
    },
  ];

  async onLoad({ logger }: OnLoadArgs) {
    logger.debug("Fetching latex2image endpoint");

    [, , latex2imageEndpoint] =
      (
        await fetch(
          "https://latex2image.joeraut.com/latex2image-client.js",
        ).then((res) => res.text())
      ).match(/LAMBDA_ENDPOINT\s*=\s*(['"`])(.+?)\1/) || [];

    if (!latex2imageEndpoint) {
      throw new Error("Failed to get latex2image endpoint");
    }

    logger.debug("Fetched latex2image endpoint:", latex2imageEndpoint);
  }
}
