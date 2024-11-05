import { randomUUID } from "node:crypto";

import { CommandError } from "../../error";
import geekJokes from "../../geek-jokes/data.json";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";
import { mimeTypes } from "./mime";

// Remove Chuck Norris jokes because they're overdone
// and not very funny anymore
// Let's be honest, they never were
// (I'm sorry, Chuck Norris, please don't hurt me)
// but seriously, they're not funny anymore
// Also, I'm sorry for the bad jokes in the geek-jokes data
// I didn't write them, I swear
// ---
// Lol GitHub Copilot is cooking with these comments
const geekJokesFiltered = geekJokes.filter(
  (joke) => !/chuck\s*norris/i.test(joke),
);

export default new Plugin(
  "random",
  "Random",
  "Utilities for generating random data",
).registerCommand({
  name: "random",
  description: "Generates random data",
  minLevel: PermissionLevel.NONE,

  async handler({ message, data }) {
    const [, min, max] = data.match(/^(\d+) (\d+)$/) || [];

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

          await message.react(emoji);

          return;
        } else {
          return `Random number between ${minNum} and ${maxNum}: ${randomNum}`;
        }
      }
    }

    switch (data.toLowerCase()) {
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
        await message.react(Math.random() < 0.5 ? "🪙" : "👑");
        return;
      }

      case "git-commit":
      case "gitcommit":
      case "commit":
      case "git":
      case "gc": {
        const resp = await fetch("https://whatthecommit.com/index.txt");

        if (!resp.ok) {
          throw new CommandError("Failed to fetch random commit message");
        }

        const commitMsg = (await resp.text()).trim();

        if (!commitMsg) {
          throw new CommandError("Failed to fetch random commit message");
        }

        return commitMsg;
      }

      case "metaphor":
      case "met":
      case "m": {
        const resp = await fetch("http://metaphorpsum.com/sentences/1");

        if (!resp.ok) {
          throw new CommandError("Failed to fetch random metaphor");
        }

        const metaphor = (await resp.text()).trim();

        if (!metaphor) {
          throw new CommandError("Failed to fetch random metaphor");
        }

        return metaphor;
      }

      case "geek-joke":
      case "geekjoke":
      case "nerd-joke":
      case "nerdjoke": {
        const joke =
          geekJokesFiltered[
            Math.floor(Math.random() * geekJokesFiltered.length)
          ];

        return joke;
      }

      case "mime":
      case "mimetype":
      case "mime-type": {
        return `\`${mimeTypes[Math.floor(Math.random() * mimeTypes.length)]}\``;
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
* \`coinflip\`
* \`git-commit\`
* \`metaphor\`
* \`geek-joke\`
* \"mime-type\`"
`);
    }
  },
});
