import type { Plugin } from "../plugins";

import { prettyDate } from "@based/pretty-date";
import { array, nullable, object, parse, string } from "valibot";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

const footballDataDotOrgApiKey = process.env.FOOTBALL_DATA_DOT_ORG_API_KEY;

if (!footballDataDotOrgApiKey) {
  throw new Error("$FOOTBALL_DATA_DOT_ORG_API_KEY is not set");
}

export default {
  name: "Football",
  description: "Commands related to football",
  version: "0.0.1",

  commands: [
    {
      name: "football",
      description: "Shows today's football matches",
      minLevel: PermissionLevel.TRUSTED,

      async handler() {
        const data = parse(
          object({
            matches: array(
              object({
                utcDate: string(),
                competition: object({
                  name: string(),
                }),
                homeTeam: object({
                  shortName: string(),
                }),
                awayTeam: object({
                  shortName: string(),
                }),
                score: object({
                  winner: nullable(string()),
                }),
              }),
            ),
          }),
          await fetch("https://api.football-data.org/v4/matches", {
            headers: {
              "x-auth-token": footballDataDotOrgApiKey,
            },
          }).then((r) => r.json()),
        );

        // todo: valibot

        if (!data.matches.length) {
          throw new CommandError("No matches today.");
        }

        let msg = "Today's matches:";

        for (const match of data.matches) {
          const date = new Date(match.utcDate);

          msg += `\n\n*${match.homeTeam.shortName} vs ${match.awayTeam.shortName}*`;
          msg += `\n* ${match.competition.name}`;
          msg += `\n* ${prettyDate(date.getTime(), "date-time-human")} (${date.toLocaleString()})`;
          msg += `\n* Winner: ${match.score.winner || "_N/A_"}`;
        }

        return msg;
      },
    },
  ],
} satisfies Plugin;
