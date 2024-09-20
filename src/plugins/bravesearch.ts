import { BraveSearch } from "brave-search";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";
import { type Plugin } from "../plugins";

const apiKey = process.env.BRAVE_SEARCH_API_KEY;

if (!apiKey) {
  throw new Error("$BRAVE_SEARCH_API_KEY is not set");
}

const braveSearch = new BraveSearch(apiKey);

export default {
  id: "bravesearch",
  name: "Brave Search",
  description: "Search the web with Brave Search",
  version: "0.0.1",

  commands: [
    {
      name: "bravesearch",
      description: "Search the web with Brave Search",
      minLevel: PermissionLevel.TRUSTED,
      rateLimit: [
        {
          // Once every 5 seconds
          duration: 5000,
          max: 1,
        },
        {
          // 10 times per hour
          duration: 1000 * 60 * 60,
          max: 10,
        },
      ],

      async handler({ rest, logger }) {
        if (!rest) {
          throw new CommandError("what do you want to search for?");
        }

        const results = await braveSearch.webSearch(rest, {
          count: 3,
          text_decorations: false,
          result_filter: "web",
        });

        logger.debug("Got Brave results:", results);

        if (!results.web?.results?.length) {
          throw new CommandError("no results found");
        }

        const displayQuery =
          results.query.altered || results.query.original || rest;
        let msg = `*Search results for \`${displayQuery}\`*`;

        for (const result of results.web.results) {
          msg += `

* ${result.title}
${result.url}
> ${result.description}`;
        }

        return msg;
      },
    },
  ],
} satisfies Plugin;
