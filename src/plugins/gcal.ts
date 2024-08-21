import type { Interaction, Plugin } from "../plugins";

import { google } from "googleapis";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

async function cal(
  getGoogleClient: Parameters<Interaction["handler"]>[0]["getGoogleClient"],
) {
  const client = await getGoogleClient(
    "https://www.googleapis.com/auth/calendar.readonly",
  );
  return google.calendar({ version: "v3", auth: client });
}

export default {
  id: "gcal",
  name: "Google Calendar",
  description: "Google Calendar integration",
  version: "0.0.1",

  commands: [
    {
      name: "gcalendars",
      description: "List Google Calendars",
      minLevel: PermissionLevel.NONE,
      rateLimit: 10000,

      async handler({ getGoogleClient }) {
        const calendar = await cal(getGoogleClient);
        const calendars = await calendar.calendarList.list();

        if (!calendars.data.items) {
          return "No calendars found.";
        }

        let msg = "Calendars:";
        for (const cal of calendars.data.items) {
          msg += `\n* \`${cal.id}\`: ${cal.summary}`;
        }

        return msg;
      },
    },
    {
      name: "gcalevents",
      description: "List Google Calendar events",
      minLevel: PermissionLevel.NONE,
      rateLimit: 10000,

      async handler({ rest, getGoogleClient }) {
        const calendar = await cal(getGoogleClient);

        if (!rest) {
          throw new CommandError(
            "missing calendar ID. Use `/gcalendars` to get a list of calendars.",
          );
        }

        const events = await calendar.events.list({ calendarId: rest });

        if (!events.data.items) {
          return "No events found.";
        }

        let msg = "Events:";
        for (const event of events.data.items) {
          msg += `\n* ${event.summary}`;
        }

        return msg;
      },
    },
  ],
} satisfies Plugin;
