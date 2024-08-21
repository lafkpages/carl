import type { Plugin } from "../plugins";

import { google } from "googleapis";

import { PermissionLevel } from "../perms";

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
        const client = await getGoogleClient(
          "https://www.googleapis.com/auth/calendar.readonly",
        );
        const calendar = google.calendar({ version: "v3", auth: client });

        const calendars = await calendar.calendarList.list();

        if (!calendars.data.items) {
          return "No calendars found.";
        }

        let msg = "Calendars:";
        for (const cal of calendars.data.items) {
          msg += `\n* ${cal.summary}`;
        }

        return msg;
      },
    },
  ],
} satisfies Plugin;
