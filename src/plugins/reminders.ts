import type { Database } from "bun:sqlite";
import type { Client } from "whatsapp-web.js";
import type { Plugin } from "../plugins";

import { parse } from "chrono-node";

import { CommandError } from "../error";
import { PermissionLevel } from "../perms";

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

async function loadReminder(
  reminder: Reminder,
  client: Client,
  database: Database,
  insert = true,
) {
  const now = Date.now();

  if (reminder.time < now) {
    await sendReminder(reminder, client, database);
    return;
  }

  if (insert) {
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
    await sendReminder(reminder, client, database);

    reminders.delete(reminder.id!);
  }, reminder.time - now);

  reminders.set(reminder.id, { ...reminder, _timeout: timeout });
}

async function sendReminder(
  reminder: InternalReminder,
  client: Client,
  database: Database,
) {
  if (!reminder.id) {
    throw new Error("reminder.id is not set");
  }

  const message = await client.sendMessage(
    reminder.channel || reminder.user,
    reminder.message,
    { linkPreview: false },
  );

  database.run<[number]>("DELETE FROM reminders WHERE id = ?", [reminder.id]);

  return message;
}

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

      async handler({ rest, sender, chat, client, database }) {
        const datetimes = parse(rest);

        if (datetimes.length < 1) {
          throw new CommandError("invalid date/time format.");
        }

        if (datetimes.length > 1) {
          throw new CommandError(
            "multiple date/time formats detected. Please specify only one.",
          );
        }

        const [datetime] = datetimes;

        await loadReminder(
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
  ],

  async onLoad({ client, database }) {
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
      await loadReminder(row, client, database!, false);
    }
  },
} satisfies Plugin;
