import { nullable, object, parse, string } from "valibot";
import { MessageMedia } from "whatsapp-web.js";

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

let latex2imageEndpoint: string;

export default class extends Plugin<"latex"> {
  readonly id = "latex";
  readonly name = "LaTeX";
  readonly description = "Plugin for rendering LaTeX equations";
  readonly version = "0.0.1";

  constructor() {
    super();

    this.registerCommands([
      {
        name: "latex",
        description: "Render a LaTeX equation",
        minLevel: PermissionLevel.TRUSTED,
        rateLimit: [
          {
            // 5 times per minute
            duration: 1000 * 60,
            max: 5,
          },
        ],

        async handler({ message, data }) {
          data = data.trim();

          if (!data) {
            throw new CommandError(
              "you must provide a LaTeX equation to render",
            );
          }

          const latexInput = `\\begin{align*}\n${data}\n\\end{align*}\n`;

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

          this.logger.info("Rendered LaTeX equation:", imageUrl);

          // TODO: why is the image so massive?
          await this.client.sendMessage(
            message.from,
            `Rendered LaTeX equation:\n\`\`\`\n${latexInput}\n\`\`\``,
            {
              media: await MessageMedia.fromUrl(imageUrl),
            },
          );

          return true;
        },
      },
    ]);

    this.on("load", async () => {
      this.logger.debug("Fetching latex2image endpoint");

      [, , latex2imageEndpoint] =
        (
          await fetch(
            "https://latex2image.joeraut.com/latex2image-client.js",
          ).then((res) => res.text())
        ).match(/LAMBDA_ENDPOINT\s*=\s*(['"`])(.+?)\1/) || [];

      if (!latex2imageEndpoint) {
        throw new Error("Failed to get latex2image endpoint");
      }

      this.logger.debug("Fetched latex2image endpoint:", latex2imageEndpoint);
    });
  }
}
