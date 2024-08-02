import type { Message } from "venom-bot";
import type { Plugin } from "../plugins";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

const apiKey = process.env.ISITWATER_API_KEY;

if (!apiKey) {
  throw new Error("$ISITWATER_API_KEY is not set");
}

export default {
  id: "isitwater",
  name: "Is It Water?",
  description: "A plugin to check if a given location is on water or not.",
  version: "0.0.1",

  commands: [
    {
      name: "isitwater",
      description: "Check if a location is on water or land",
      minLevel: PermissionLevel.TRUSTED,

      async handler({ message, client, logger, rest }) {
        let lat: number;
        let lng: number;

        if (message.type === "location") {
          ({ lat, lng } = message);
        } else if (message.quotedMsg?.type === "location") {
          ({ lat, lng } = message.quotedMsg);
        } else {
          const [, latArg, lngArg] = rest.match(/^\s*(.+?)[\s,]+(.+?)$/) ?? [];
          lat = parseFloat(latArg);
          lng = parseFloat(lngArg);
        }

        if (isNaN(lat) || isNaN(lng)) {
          throw new CommandError(
            "Invalid location. Please provide a valid location or reply to a message with a location.",
          );
        }

        const resp = await fetch(
          `https://isitwater-com.p.rapidapi.com/?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&rapidapi-key=${encodeURIComponent(apiKey)}`,
        );

        if (!resp.ok) {
          logger.error(
            "Failed to fetch IsItWater API:",
            resp.status,
            resp.statusText,
          );
          return;
        }

        const { water } = await resp.json();

        if (typeof water !== "boolean") {
          logger.error(
            "Invalid response from IsItWater API:",
            typeof water,
            water,
          );
          return;
        }

        await client.sendReactions(
          message.id,
          water ? "\u{1F30A}" : "\u26F0\uFE0F",
        );

        logger.debug("shit2", water);
      },
    },
  ],
} satisfies Plugin;
