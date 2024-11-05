import { prettyDate } from "@based/pretty-date";
import { parse } from "chrono-node";

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

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

export default new Plugin(
  "reminders",
  "Reminders",
  "Set reminders for yourselfs.",
)
  .registerApi({
    async loadReminder(reminder: Reminder, _new = true) {
      const now = Date.now();

      if (reminder.time <= now) {
        if (_new) {
          throw new CommandError("reminder time is in the past");
        }

        await this.api.sendReminder(reminder);
        return;
      }

      if (_new) {
        const { lastInsertRowid } = this.db.run<
          [string, string | null, string, number]
        >(
          "INSERT INTO reminders (user, channel, message, time) VALUES (?, ?, ?, ?)",
          [reminder.user, reminder.channel, reminder.message, reminder.time],
        );

        const { id } = this.db
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
        await this.api.sendReminder(reminder);

        reminders.delete(reminder.id!);
      }, reminder.time - now).unref();

      reminders.set(reminder.id, { ...reminder, _timeout: timeout });
    },

    async sendReminder(reminder: InternalReminder) {
      if (!reminder.id) {
        throw new Error("reminder.id is not set");
      }

      const message =
        reminder.channel && reminder.channel !== reminder.user
          ? await this.client.sendMessage(
              reminder.channel,
              `Reminder for @${reminder.user.slice(0, -5)}: ${reminder.message}`,
              { linkPreview: false, mentions: [reminder.user] },
            )
          : await this.client.sendMessage(
              reminder.channel || reminder.user,
              `Reminder: ${reminder.message}`,
              { linkPreview: false },
            );

      this.db.run<[number]>("DELETE FROM reminders WHERE id = ?", [
        reminder.id,
      ]);

      return message;
    },
  })
  .registerCommand({
    name: "reminder",
    description: "Set a reminder.",
    minLevel: PermissionLevel.NONE,

    async handler({ data, sender, chat }) {
      const datetimes = parse(data, undefined, {
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

      const message = data.replace(datetime.text, "").trim();

      await this.api.loadReminder({
        user: sender,
        channel: chat.id._serialized,

        message,
        time: datetime.date().getTime(),
      });

      return true;
    },
  })
  .registerCommand({
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
  })
  .on({
    async load() {
      this.db.run(`--sql
        CREATE TABLE IF NOT EXISTS reminders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user TEXT NOT NULL,
          channel TEXT,
          message TEXT NOT NULL,
          time INTEGER NOT NULL
        );
      `);

      const rows = this.db.query<Reminder, []>("SELECT * FROM reminders").all();

      for (const row of rows) {
        await this.api.loadReminder(row, false);
      }

      this.logger.info("Loaded", reminders.size, "reminders.");
    },
  });
