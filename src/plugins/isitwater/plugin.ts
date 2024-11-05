import type { Message } from "whatsapp-web.js";

import assert from "node:assert";

import { MessageTypes } from "whatsapp-web.js";

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

const apiKey = process.env.ISITWATER_API_KEY;

if (!apiKey) {
  throw new Error("$ISITWATER_API_KEY is not set");
}

export default new Plugin(
  "isitwater",
  "Is It Water?",
  "A plugin to check if a given location is on water or not.",
)
  .registerApi({
    api: {
      async handleMessage(
        message: Message,
        latitude?: string,
        longitude?: string,
      ) {
        assert(apiKey);

        if (!latitude) {
          latitude = message.location.latitude;
        }
        if (!longitude) {
          longitude = message.location.longitude;
        }

        assert(latitude);
        assert(longitude);

        const resp = await fetch(
          `https://isitwater-com.p.rapidapi.com/?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&rapidapi-key=${encodeURIComponent(apiKey)}`,
        );

        if (!resp.ok) {
          this.logger.error(
            "Failed to fetch IsItWater API:",
            resp.status,
            resp.statusText,
          );
          return;
        }

        const { water } = await resp.json();

        if (typeof water !== "boolean") {
          this.logger.error(
            "Invalid response from IsItWater API:",
            typeof water,
            water,
          );
          return;
        }

        await message.react(water ? "\u{1F30A}" : "\u26F0\uFE0F");
      },
    },
  })
  .registerCommand({
    name: "isitwater",
    description: "Check if a location is on water or land",
    minLevel: PermissionLevel.NONE,
    rateLimit: [
      {
        duration: 10000,
        max: 5,
      },
    ],

    async handler({ message, data }) {
      let locationMessage = message;
      let latitude = "";
      let longitude = "";

      if (message.type === MessageTypes.LOCATION) {
        locationMessage = message;
      } else if (message.hasQuotedMsg) {
        const quotedMsg = await message.getQuotedMessage();

        if (quotedMsg.type === MessageTypes.LOCATION) {
          locationMessage = quotedMsg;
        }
      } else {
        const [, latArg, lngArg] = data.match(/^\s*(.+?)[\s,]+(.+?)$/) ?? [];
        latitude = latArg;
        longitude = lngArg;
      }

      if (!latitude || !longitude) {
        throw new CommandError(
          "Invalid location. Please provide a valid location or reply to a message with a location.",
        );
      }

      await this.api.handleMessage(locationMessage, latitude, longitude);
    },
  })
  .on({
    async message({ message }) {
      if (message.type === MessageTypes.LOCATION) {
        await this.api.handleMessage(message);
      }
    },
  });
