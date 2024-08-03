import type { ConsolaInstance } from "consola";
import type { InferOutput } from "valibot";
import type { Whatsapp } from "venom-bot";
import type { Plugin } from "../plugins";

import { prettyDate } from "@based/pretty-date";
import {
  array,
  nullable,
  number,
  object,
  parse,
  picklist,
  string,
} from "valibot";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

const footballDataDotOrgApiKey = process.env.FOOTBALL_DATA_DOT_ORG_API_KEY;

if (!footballDataDotOrgApiKey) {
  throw new Error("$FOOTBALL_DATA_DOT_ORG_API_KEY is not set");
}

const teamSchema = object({
  shortName: string(),
});

const scoreSchema = object({
  home: nullable(number()),
  away: nullable(number()),
});

const matchSchema = object({
  id: number(),
  utcDate: string(),

  status: picklist([
    "TIMED",
    "SCHEDULED",
    "LIVE",
    "IN_PLAY",
    "PAUSED",
    "FINISHED",
    "POSTPONED",
    "SUSPENDED",
    "CANCELLED",
  ]),

  competition: object({
    name: string(),
    code: string(),
  }),

  homeTeam: teamSchema,
  awayTeam: teamSchema,

  score: object({
    winner: nullable(string()),

    fullTime: scoreSchema,
    halfTime: scoreSchema,
  }),
});

const matchesSchema = object({
  matches: array(matchSchema),
});

let latestMatches: InferOutput<typeof matchesSchema>["matches"] = [];

async function fetchMatches(
  logger: ConsolaInstance,
  competitions?: string[] | null,
) {
  logger.debug("Fetching matches...");

  const url = new URL("https://api.football-data.org/v4/matches");

  if (competitions) {
    url.searchParams.set("competitions", competitions.join(","));
  }

  const resp = await fetch(url, {
    headers: {
      "x-auth-token": footballDataDotOrgApiKey!,
    },
  });

  if (!resp.ok) {
    if (resp.status === 429) {
      throw new CommandError(
        "Woah, slow down! You're making too many requests.",
      );
    } else {
      throw new CommandError("Failed to fetch data from football-data.org");
    }
  }

  const data = parse(matchesSchema, await resp.json());

  latestMatches = data.matches;

  return data;
}

function parseCompetitionsList(rest: string) {
  return rest ? rest.toUpperCase().split(/[,\s]+/) : null;
}

function startMatchUpdateInterval(logger: ConsolaInstance, client: Whatsapp) {
  if (checkInterval) {
    return;
  }

  logger.debug("Starting match update interval...");

  checkInterval = setInterval(async () => {
    const oldMatches = latestMatches;
    const oldMatchesRecord: Record<
      number,
      InferOutput<typeof matchSchema>
    > = {};
    for (const match of oldMatches) {
      oldMatchesRecord[match.id] = match;
    }

    await fetchMatches(logger);

    const latestMatchesRecord: Record<
      number,
      InferOutput<typeof matchSchema>
    > = {};
    for (const match of latestMatches) {
      latestMatchesRecord[match.id] = match;
    }

    if (latestMatches.length !== oldMatches.length) {
      // TODO: filter out matches that are not in the subscribed competitions
      for (const chatId in subscribedChatIds) {
        await client.sendText(
          chatId,
          "New football matches available! Use `/football` to see them.",
        );
      }
    }

    for (const match of latestMatches) {
      const oldMatch = oldMatchesRecord[match.id];

      if (!oldMatch) {
        continue;
      }

      if (oldMatch.status !== match.status) {
        for (const chatId in subscribedChatIds) {
          const chatSubscribedCompetitions = subscribedChatIds.get(chatId);

          if (
            chatSubscribedCompetitions &&
            !chatSubscribedCompetitions.includes(match.competition.code)
          ) {
            continue;
          }

          await client.sendText(
            chatId,
            `Match update\n\n*${match.homeTeam.shortName} vs ${match.awayTeam.shortName}*\n* Status: ${match.status}`,
          );
        }
      }

      if (
        oldMatch.score.fullTime.home !== match.score.fullTime.home ||
        oldMatch.score.fullTime.away !== match.score.fullTime.away
      ) {
        for (const chatId in subscribedChatIds) {
          const chatSubscribedCompetitions = subscribedChatIds.get(chatId);

          if (
            chatSubscribedCompetitions &&
            !chatSubscribedCompetitions.includes(match.competition.code)
          ) {
            continue;
          }

          await client.sendText(
            chatId,
            `Match update\n\n*${match.homeTeam.shortName} vs ${match.awayTeam.shortName}*\n* Full time scores: ${match.score.fullTime.home} - ${match.score.fullTime.away}`,
          );
        }
      }

      if (
        oldMatch.score.halfTime.home !== match.score.halfTime.home ||
        oldMatch.score.halfTime.away !== match.score.halfTime.away
      ) {
        for (const chatId in subscribedChatIds) {
          const chatSubscribedCompetitions = subscribedChatIds.get(chatId);

          // TODO: DRY
          if (
            chatSubscribedCompetitions &&
            !chatSubscribedCompetitions.includes(match.competition.code)
          ) {
            continue;
          }

          await client.sendText(
            chatId,
            `Match update\n\n*${match.homeTeam.shortName} vs ${match.awayTeam.shortName}*\n* Half time scores: ${match.score.halfTime.home} - ${match.score.halfTime.away}`,
          );
        }
      }
    }
  }, 60000);

  checkInterval.unref();
}

function stopMatchUpdateInterval(logger: ConsolaInstance) {
  if (checkInterval) {
    logger.debug("Stopping match update interval...");
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

let subscribedChatIds = new Map<string, string[] | null>();
let checkInterval: Timer | null = null;

export default {
  id: "football",
  name: "Football",
  description: "Commands related to football",
  version: "0.0.1",

  commands: [
    {
      name: "football",
      description: "Shows today's football matches",
      minLevel: PermissionLevel.NONE,
      rateLimit: 10000,

      async handler({ rest, logger }) {
        const { matches } = await fetchMatches(
          logger,
          parseCompetitionsList(rest),
        );

        if (!matches.length) {
          throw new CommandError("No matches today.");
        }

        let msg = "Today's matches:";

        const now = Date.now();

        for (const match of matches) {
          const date = new Date(match.utcDate);
          const dateNumber = date.getTime();
          const formattedDate = prettyDate(dateNumber, "date-time-human");
          const localeDate = date.toLocaleString();

          const starts = now > dateNumber ? "Started" : "Starts";

          const shouldShowWinner = match.status === "FINISHED";
          const winner = shouldShowWinner
            ? {
                HOME_TEAM: match.homeTeam.shortName,
                AWAY_TEAM: match.awayTeam.shortName,
                DRAW: "Draw",
              }[match.score.winner || ""] || "_N/A_"
            : "";

          msg += `\n\n*${match.homeTeam.shortName} vs ${match.awayTeam.shortName}*`;
          msg += `\n* ${match.competition.name} (\`${match.competition.code}\`)`;
          msg += `\n* ${starts}: ${formattedDate} (${localeDate})`;
          msg += `\n* Status: ${match.status}`;

          if (shouldShowWinner) {
            msg += `\n* Winner: ${winner}`;
          }

          if (match.score.halfTime.home !== null) {
            msg += `\n* Half time scores: ${match.score.halfTime.home} - ${match.score.halfTime.away}`;
          }
          if (match.score.fullTime.home !== null) {
            msg += `\n* Full time scores: ${match.score.fullTime.home} - ${match.score.fullTime.away}`;
          }
        }

        return msg;
      },
    },
    {
      name: "footballsubscribe",
      description: "Subscribe the current chat to football match updates",
      minLevel: PermissionLevel.TRUSTED,

      async handler({ message, rest, logger, client }) {
        if (message.chatId in subscribedChatIds) {
          throw new CommandError("This chat is already subscribed.");
        }

        subscribedChatIds.set(message.chatId, parseCompetitionsList(rest));

        startMatchUpdateInterval(logger, client);

        return true;
      },
    },
    {
      name: "footballunsubscribe",
      description: "Unsubscribe the current chat from football match updates",
      minLevel: PermissionLevel.TRUSTED,

      async handler({ message, logger }) {
        if (!(message.chatId in subscribedChatIds)) {
          throw new CommandError("This chat is not subscribed.");
        }

        subscribedChatIds.delete(message.chatId);

        if (subscribedChatIds.size === 0) {
          stopMatchUpdateInterval(logger);
        }

        return true;
      },
    },
  ],

  async onLoad({ logger }) {
    logger.debug("Fetching initial matches...");
    await fetchMatches(logger);
  },

  onUnload({ logger }) {
    stopMatchUpdateInterval(logger);
  },
} satisfies Plugin;
