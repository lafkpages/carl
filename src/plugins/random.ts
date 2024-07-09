import type { Plugin } from "../plugins";

import { randomUUID } from "node:crypto";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

export default {
  name: "Random",
  description: "Utilities for generating random data",
  version: "1.0.0",

  commands: [
    {
      name: "random",
      description: "Generates random data",
      minLevel: PermissionLevel.NONE,

      async handler(message, client, rest) {
        const [, min, max] = rest.match(/^(\d+) (\d+)$/) || [];

        if (min && max) {
          const minNum = parseInt(min);
          const maxNum = parseInt(max);

          if (isNaN(minNum) || isNaN(maxNum)) {
            throw new CommandError(
              "Invalid minimum or maximum. Please provide two numbers. For example: `/random 1 5`",
            );
          }

          if (minNum > maxNum) {
            throw new CommandError(
              "The minimum number must be less than the maximum number",
            );
          } else if (minNum === maxNum) {
            throw new CommandError(
              "The minimum and maximum numbers must be different",
            );
          } else if (minNum % 1 !== 0 || maxNum % 1 !== 0) {
            throw new CommandError(
              "The minimum and maximum numbers must be integers",
            );
          } else {
            const randomNum =
              Math.floor(Math.random() * (maxNum - minNum + 1)) + minNum;

            if (randomNum >= 0 && randomNum <= 10) {
              const emoji =
                randomNum === 10
                  ? "\u{1F51F}"
                  : `${String.fromCharCode(48 + randomNum)}\uFE0F\u20E3`;

              await client.sendReactions(message.id, emoji);

              return;
            } else {
              return `Random number between ${minNum} and ${maxNum}: ${randomNum}`;
            }
          }
        }

        switch (rest.toLowerCase()) {
          case "uuid":
            return randomUUID();

          case "letter":
          case "alphabet":
          case "alpha":
          case "l":
            return String.fromCharCode(65 + Math.floor(Math.random() * 26));

          case "number":
          case "num":
          case "n":
            return `Random number between 0 and 1: ${Math.random()}`;

          case "boolean":
          case "bool":
          case "b":
            return Math.random() < 0.5;

          case "coinflip":
          case "coin":
          case "c":
          case "flip": {
            await client.sendReactions(
              message.id,
              Math.random() < 0.5 ? "🪙" : "👑",
            );
            return;
          }

          default:
            throw new CommandError(`\
Invalid arguments. Please either provide two numbers, or a data type. For example:
* \`/random 1 5\`
* \`/random uuid\`

Valid data types:
* \`uuid\`
* \`letter\`
* \`number\`
* \`boolean\`
* \`coinflip\`\
`);
        }
      },
    },
  ],
} satisfies Plugin;
