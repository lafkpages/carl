import { parseDate } from "chrono-node";

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

const validFactTypes = new Set(["trivia", "math", "date", "year"] as const);
type ValidFactType = typeof validFactTypes extends Set<infer T> ? T : never;

export default class extends Plugin {
  id = "numberfacts";
  name = "Number facts";
  description = "Fun facts about numbers!";
  version = "0.0.1";

  constructor() {
    super();

    this.registerCommands([
      {
        name: "numberfact",
        description: "Get a random fact about a number",
        minLevel: PermissionLevel.NONE,
        rateLimit: [
          {
            duration: 2000,
            max: 1,
          },
        ],

        async handler({ data }) {
          const [, numberArg, typeArg] =
            data.match(/^\s*(\d+)(?:\s+(.+))?$/) ?? [];

          const number = parseInt(numberArg);

          if (isNaN(number)) {
            throw new CommandError("Invalid number");
          }

          const type = (typeArg || "trivia") as ValidFactType;
          if (!validFactTypes.has(type)) {
            let msg = `Invalid fact type.\n\nValid types:`;

            for (const validType of validFactTypes) {
              msg += `\n* \`${validType}\``;
            }

            throw new CommandError(msg);
          }

          if (type === "date") {
            throw new CommandError(
              "Use the `/datefact` command for date facts",
            );
          }

          return await this.apiCall([number], type);
        },
      },
      {
        name: "datefact",
        description: "Get a random fact about a date",
        minLevel: PermissionLevel.NONE,
        rateLimit: [
          {
            duration: 2000,
            max: 1,
          },
        ],

        async handler({ data }) {
          const date = parseDate(data);

          if (!date) {
            throw new CommandError("invalid date");
          }

          return await this.apiCall(
            [date.getMonth() + 1, date.getDate()],
            "date",
          );
        },
      },
      {
        name: "todayfact",
        description: "Get a random fact about today",
        minLevel: PermissionLevel.NONE,
        rateLimit: [
          {
            duration: 2000,
            max: 1,
          },
        ],

        async handler() {
          const now = new Date();
          return await this.apiCall(
            [now.getMonth() + 1, now.getDate()],
            "date",
          );
        },
      },
    ]);
  }

  async apiCall(numbers: number[], type: ValidFactType) {
    let url = `http://numbersapi.com/`;

    for (const number of numbers) {
      url += `${encodeURIComponent(number)}/`;
    }

    url += `${encodeURIComponent(type)}?default=NOTFOUND`;

    const resp = await fetch(url);

    if (resp.status !== 200) {
      throw new CommandError(`Failed to fetch fact: \`${resp.statusText}\``);
    }

    const fact = (await resp.text()).trim();

    if (fact === "NOTFOUND") {
      throw new CommandError("No fact found");
    }

    return fact;
  }
}
