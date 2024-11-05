import type { InferOutput } from "valibot";

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

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

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

function parseCompetitionsList(data: string) {
  return data ? data.toUpperCase().split(/[,\s]+/) : null;
}

export default new Plugin(
  "football",
  "Football",
  "Commands related to football",
)
  .registerApi<{
    subscribedChatIds: Map<string, string[] | null>;
    checkInterval: Timer | null;
    latestMatches: InferOutput<typeof matchesSchema>["matches"];
  }>({
    subscribedChatIds: new Map(),
    checkInterval: null,
    latestMatches: [],
  })
  .registerApi({
    async fetchMatches(competitions?: string[] | null) {
      this.logger.debug("Fetching matches...");

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

      this.api.latestMatches = data.matches;

      return data;
    },

    startMatchUpdateInterval() {
      if (this.api.checkInterval) {
        return;
      }

      this.logger.debug("Starting match update interval...");

      this.api.checkInterval = setInterval(async () => {
        const oldMatches = this.api.latestMatches;
        const oldMatchesRecord: Record<
          number,
          InferOutput<typeof matchSchema>
        > = {};
        for (const match of oldMatches) {
          oldMatchesRecord[match.id] = match;
        }

        await this.api.fetchMatches();

        const latestMatchesRecord: Record<
          number,
          InferOutput<typeof matchSchema>
        > = {};
        for (const match of this.api.latestMatches) {
          latestMatchesRecord[match.id] = match;
        }

        if (this.api.latestMatches.length !== oldMatches.length) {
          // TODO: filter out matches that are not in the subscribed competitions
          for (const chatId in this.api.subscribedChatIds) {
            await this.client.sendMessage(
              chatId,
              "New football matches available! Use `/football` to see them.",
            );
          }
        }

        for (const match of this.api.latestMatches) {
          const oldMatch = oldMatchesRecord[match.id];

          if (!oldMatch) {
            continue;
          }

          if (oldMatch.status !== match.status) {
            for (const chatId in this.api.subscribedChatIds) {
              const chatSubscribedCompetitions =
                this.api.subscribedChatIds.get(chatId);

              if (
                chatSubscribedCompetitions &&
                !chatSubscribedCompetitions.includes(match.competition.code)
              ) {
                continue;
              }

              await this.client.sendMessage(
                chatId,
                `Match update\n\n*${match.homeTeam.shortName} vs ${match.awayTeam.shortName}*\n* Status: ${match.status}`,
              );
            }
          }

          if (
            oldMatch.score.fullTime.home !== match.score.fullTime.home ||
            oldMatch.score.fullTime.away !== match.score.fullTime.away
          ) {
            for (const chatId in this.api.subscribedChatIds) {
              const chatSubscribedCompetitions =
                this.api.subscribedChatIds.get(chatId);

              if (
                chatSubscribedCompetitions &&
                !chatSubscribedCompetitions.includes(match.competition.code)
              ) {
                continue;
              }

              await this.client.sendMessage(
                chatId,
                `Match update\n\n*${match.homeTeam.shortName} vs ${match.awayTeam.shortName}*\n* Full time scores: ${match.score.fullTime.home} - ${match.score.fullTime.away}`,
              );
            }
          }

          if (
            oldMatch.score.halfTime.home !== match.score.halfTime.home ||
            oldMatch.score.halfTime.away !== match.score.halfTime.away
          ) {
            for (const chatId in this.api.subscribedChatIds) {
              const chatSubscribedCompetitions =
                this.api.subscribedChatIds.get(chatId);

              // TODO: DRY
              if (
                chatSubscribedCompetitions &&
                !chatSubscribedCompetitions.includes(match.competition.code)
              ) {
                continue;
              }

              await this.client.sendMessage(
                chatId,
                `Match update\n\n*${match.homeTeam.shortName} vs ${match.awayTeam.shortName}*\n* Half time scores: ${match.score.halfTime.home} - ${match.score.halfTime.away}`,
              );
            }
          }
        }
      }, 60000).unref();
    },

    stopMatchUpdateInterval() {
      if (this.api.checkInterval) {
        this.logger.debug("Stopping match update interval...");
        clearInterval(this.api.checkInterval);
        this.api.checkInterval = null;
      }
    },
  })
  .registerCommand({
    name: "football",
    description: "Shows today's football matches",
    minLevel: PermissionLevel.NONE,
    rateLimit: [
      {
        duration: 10000,
        max: 1,
      },
      {
        duration: 1000 * 60 * 60,
        max: 10,
      },
    ],

    async *handler({ data }) {
      yield "Fetching matches...";

      const { matches } = await this.api.fetchMatches(
        parseCompetitionsList(data),
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
  })
  .registerCommand({
    name: "footballsubscribe",
    description: "Subscribe the current chat to football match updates",
    minLevel: PermissionLevel.TRUSTED,

    async handler({ data, chat }) {
      if (chat.id._serialized in this.api.subscribedChatIds) {
        throw new CommandError("This chat is already subscribed.");
      }

      this.api.subscribedChatIds.set(
        chat.id._serialized,
        parseCompetitionsList(data),
      );

      this.api.startMatchUpdateInterval();

      return true;
    },
  })
  .registerCommand({
    name: "footballunsubscribe",
    description: "Unsubscribe the current chat from football match updates",
    minLevel: PermissionLevel.TRUSTED,

    async handler({ chat }) {
      if (!(chat.id._serialized in this.api.subscribedChatIds)) {
        throw new CommandError("This chat is not subscribed.");
      }

      this.api.subscribedChatIds.delete(chat.id._serialized);

      if (this.api.subscribedChatIds.size === 0) {
        this.api.stopMatchUpdateInterval();
      }

      return true;
    },
  })
  .on({
    async load() {
      this.logger.debug("Fetching initial matches...");
      await this.api.fetchMatches();
    },
    unload() {
      this.api.stopMatchUpdateInterval();
    },
  });
