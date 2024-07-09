import type { Message } from "venom-bot";

import { create } from "venom-bot";

import * as commands from "./commands";
import { CommandError, CommandPermissionError } from "./error";
import { getPermissionLevel } from "./perms";

const client = await create({
  session: "session-name",
});

client.onMessage(async (message) => {
  const permissionLevel = getPermissionLevel(message.sender.id);

  console.log("Received:", permissionLevel, message);

  const [, command, rest] = message.body.match(/^\/(\w+)(?: (.+))?/is) || [];

  if (command) {
    if (command in commands) {
      const cmd = commands[command as keyof typeof commands];

      if (permissionLevel >= cmd.minLevel) {
        try {
          const result = await cmd.handler(
            message,
            client,
            rest || "",
            permissionLevel,
          );

          if (result) {
            await client.reply(message.from, result, message.id);
          }
        } catch (err) {
          await handleError(err, message);
        }
      } else {
        await handleError(
          new CommandPermissionError(command, cmd.minLevel),
          message,
        );
      }
    } else {
      await client.reply(
        message.from,
        `Unknown command \`${command}\``,
        message.id,
      );
    }
  } else if (message.chatId === message.sender.id) {
    await client.sendReactions(message.id, "\u2753");
  }

  await client.markMarkSeenMessage(message.from);
});

async function handleError(error: unknown, message: Message) {
  await client.sendReactions(message.id, "\u274C");

  if (error instanceof CommandError) {
    await client.reply(message.from, `Error: ${error.message}`, message.id);
  } else {
    await client.reply(
      message.from,
      `Error:\n${Bun.inspect(error, { colors: false })}`,
      message.id,
    );
  }
}
