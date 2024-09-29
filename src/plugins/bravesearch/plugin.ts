import { BraveSearch } from "brave-search";

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

const apiKey = process.env.BRAVE_SEARCH_API_KEY;

if (!apiKey) {
  throw new Error("$BRAVE_SEARCH_API_KEY is not set");
}

const braveSearch = new BraveSearch(apiKey);

export default class extends Plugin {
  id = "bravesearch";
  name = "Brave Search";
  description = "Search the web with Brave Search";
  version = "0.0.1";

  constructor() {
    super();

    this.registerCommands([
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

        async handler({ data }) {
          if (!data) {
            throw new CommandError("what do you want to search for?");
          }

          const results = await braveSearch.webSearch(data, {
            count: 3,
            text_decorations: false,
            result_filter: "web",
          });

          this.logger.debug("Got Brave results:", results);

          if (!results.web?.results?.length) {
            throw new CommandError("no results found");
          }

          const displayQuery =
            results.query.altered || results.query.original || data;
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
    ]);
  }
}
