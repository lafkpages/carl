import type { Command } from ".";

import { prettyDate } from "@based/pretty-date";

import { footballDataDotOrgApiKey } from "../../config.json";
import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

export default {
  minLevel: PermissionLevel.TRUSTED,

  description: "",
  async handler(message, client, rest) {
    const data = await fetch("https://api.football-data.org/v4/matches", {
      headers: {
        "x-auth-token": footballDataDotOrgApiKey,
      },
    }).then((r) => r.json());

    // todo: valibot

    if (!data.matches.length) {
      throw new CommandError("No matches today.");
    }

    let msg = "Matches:";

    for (const match of data.matches) {
      const date = new Date(match.utcDate).getTime();

      msg += `\n\n*${match.homeTeam.shortName} vs ${match.awayTeam.shortName}*`;
      msg += `\n* ${match.competition.name}`;
      msg += `\n* ${prettyDate(date, "date-time-human")}`;
      msg += `\n* Winner: ${match.score.winner || "_N/A_"}`;
    }

    return msg;
  },
} satisfies Command;
