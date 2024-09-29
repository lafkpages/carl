import type { Chat } from "whatsapp-web.js";

import { google } from "googleapis";

import { CommandError } from "../../error";
import { getGoogleClient } from "../../google";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

export default class extends Plugin<"gcal"> {
  readonly id = "gcal";
  readonly name = "Google Calendar";
  readonly description = "Google Calendar integration";
  readonly version = "0.0.1";

  constructor() {
    super();

    this.registerCommands([
      {
        name: "gcalendars",
        description: "List Google Calendars",
        minLevel: PermissionLevel.NONE,
        rateLimit: [
          {
            // Five times a minute
            duration: 60000,
            max: 5,
          },
          {
            // 10 times a day
            duration: 1000 * 60 * 60 * 24,
            max: 10,
          },
        ],

        async handler({ sender, chat }) {
          const calendar = await this.cal(sender, chat);
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
        rateLimit: [
          {
            // Five times a minute
            duration: 60000,
            max: 5,
          },
        ],

        async handler({ data, sender, chat }) {
          const calendar = await this.cal(sender, chat);

          if (!data) {
            throw new CommandError(
              "missing calendar ID. Use `/gcalendars` to get a list of calendars.",
            );
          }

          const events = await calendar.events.list({
            calendarId: data,
            maxResults: 5,
            timeMin: new Date().toISOString(),
          });

          if (!events.data.items) {
            return "No events found.";
          }

          let msg = "Events:";
          for (const event of events.data.items) {
            msg += `\n\n* ${event.summary}`;
            if (event.description) {
              msg += `\n> ${event.description}`;
            }
            msg += `\nStart: ${event.start?.dateTime || event.start?.date}`;
            msg += `\nEnd: ${event.end?.dateTime || event.end?.date}`;
          }

          return msg;
        },
      },
    ]);
  }

  async cal(sender: string, chat: Chat) {
    const client = await getGoogleClient(
      this.client,
      sender,
      chat,
      "https://www.googleapis.com/auth/calendar.readonly",
    );

    return google.calendar({ version: "v3", auth: client });
  }
}
