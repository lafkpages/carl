import type { Plugin } from "../plugins";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

const validFactTypes = new Set(["trivia", "math", "date", "year"] as const);
type ValidFactType = typeof validFactTypes extends Set<infer T> ? T : never;

async function apiCall(numbers: number[], type: ValidFactType) {
  let url = `http://numbersapi.com/`;

  for (const number of numbers) {
    url += `${encodeURIComponent(number)}/`;
  }

  url += `${encodeURIComponent(type)}?default=NOTFOUND`;

  const resp = await fetch(url);

  if (resp.status !== 200) {
    throw new CommandError(`Failed to fetch fact: \`${resp.statusText}\``);
  }

  const fact = await (await resp.text()).trim();

  if (fact === "NOTFOUND") {
    throw new CommandError("No fact found");
  }

  return fact;
}

export default {
  id: "numberfacts",
  name: "Number facts",
  description: "Fun facts about numbers!",
  version: "0.0.1",

  commands: [
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

      async handler({ rest }) {
        const [, numberArg, typeArg] =
          rest.match(/^\s*(\d+)(?:\s+(.+))?$/) ?? [];

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
          throw new CommandError("Use the `/datefact` command for date facts");
        }

        return await apiCall([number], type);
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

      async handler({ rest }) {
        const [, monthArg, dayArg] =
          rest.match(/^\s*(\d{1,2})\/(\d{1,2})$/) ?? [];

        const month = parseInt(monthArg);
        const day = parseInt(dayArg);

        if (isNaN(month) || isNaN(day)) {
          throw new CommandError("Invalid date");
        }

        return await apiCall([month, day], "date");
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
        return await apiCall([now.getMonth() + 1, now.getDate()], "date");
      },
    },
  ],
} satisfies Plugin;
