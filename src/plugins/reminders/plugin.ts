import type { Database } from "bun:sqlite";
import type { Client, Message } from "whatsapp-web.js";
import type { Plugin } from "./$types";

import { prettyDate } from "@based/pretty-date";
import { parse } from "chrono-node";

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";

interface Reminder {
  id?: number;

  user: string;
  channel: string | null;

  message: string;
  time: number;
}

interface InternalReminder extends Reminder {
  _timeout?: Timer;
}

const reminders = new Map<number, InternalReminder>();

export default {
  id: "reminders",
  name: "Reminders",
  description: "Set reminders for yourselfs.",
  version: "0.0.1",

  database: true,

  commands: [
    {
      name: "reminder",
      description: "Set a reminder.",
      minLevel: PermissionLevel.NONE,

      async handler({ rest, sender, chat, client, database, api }) {
        const datetimes = parse(rest, undefined, {
          forwardDate: true,
        });

        if (datetimes.length < 1) {
          throw new CommandError("invalid date/time format");
        }

        if (datetimes.length > 1) {
          throw new CommandError(
            "multiple date/time formats detected. Please specify only one",
          );
        }

        const [datetime] = datetimes;

        if (datetime.end) {
          throw new CommandError("date/time ranges are not supported");
        }

        await api.loadReminder(
          {
            user: sender,
            channel: chat.id._serialized,

            message: rest,
            time: datetime.date().getTime(),
          },
          client,
          database!,
        );

        return true;
      },
    },
    {
      name: "reminders",
      description: "List all reminders.",
      minLevel: PermissionLevel.NONE,

      handler({ sender }) {
        let reminderList = "*Reminders:*";

        for (const reminder of reminders.values()) {
          if (reminder.user === sender) {
            reminderList += `\n* ${prettyDate(reminder.time, "date-time-human")}: ${reminder.message}`;
          }
        }

        if (reminderList.length <= 12) {
          return "No reminders set.";
        }

        return reminderList;
      },
    },
  ],

  async onLoad({ client, logger, database, api }) {
    database!.run(`--sql
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT NOT NULL,
        channel TEXT,
        message TEXT NOT NULL,
        time INTEGER NOT NULL
      );
    `);

    const rows = database!.query<Reminder, []>("SELECT * FROM reminders").all();

    for (const row of rows) {
      await api.loadReminder(row, client, database!, false);
    }

    logger.info("Loaded", reminders.size, "reminders.");
  },

  api: {
    async loadReminder(
      reminder: Reminder,
      client: Client,
      database: Database,
      _new = true,
    ) {
      const now = Date.now();

      if (reminder.time <= now) {
        if (_new) {
          throw new CommandError("reminder time is in the past");
        }

        await this.sendReminder(reminder, client, database);
        return;
      }

      if (_new) {
        const { lastInsertRowid } = database.run<
          [string, string | null, string, number]
        >(
          "INSERT INTO reminders (user, channel, message, time) VALUES (?, ?, ?, ?)",
          [reminder.user, reminder.channel, reminder.message, reminder.time],
        );

        const { id } = database
          .query<
            { id: number },
            [number]
          >("SELECT id FROM reminders WHERE rowid = ?")
          .get(lastInsertRowid as number)!;

        reminder.id = id;
      } else if (reminder.id === undefined) {
        throw new Error("reminder.id is not set");
      }

      const timeout = setTimeout(async () => {
        await this.sendReminder(reminder, client, database);

        reminders.delete(reminder.id!);
      }, reminder.time - now);

      reminders.set(reminder.id, { ...reminder, _timeout: timeout });
    },
    async sendReminder(
      reminder: InternalReminder,
      client: Client,
      database: Database,
    ) {
      if (!reminder.id) {
        throw new Error("reminder.id is not set");
      }

      const message =
        reminder.channel && reminder.channel !== reminder.user
          ? await client.sendMessage(
              reminder.channel,
              `Reminder for @${reminder.user.slice(0, -5)}: ${reminder.message}`,
              { linkPreview: false, mentions: [reminder.user] },
            )
          : await client.sendMessage(
              reminder.channel || reminder.user,
              `Reminder: ${reminder.message}`,
              { linkPreview: false },
            );

      database.run<[number]>("DELETE FROM reminders WHERE id = ?", [
        reminder.id,
      ]);

      return message;
    },
  },
} satisfies Plugin;

declare module "../../plugins" {
  interface PluginApis {
    reminders: {
      loadReminder(
        reminder: Reminder,
        client: Client,
        database: Database,
        _new?: boolean,
      ): Promise<void>;
      sendReminder(
        reminder: InternalReminder,
        client: Client,
        database: Database,
      ): Promise<Message>;
    };
  }
}
