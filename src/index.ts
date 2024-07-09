import type { Message } from "venom-bot";
import type { Command, Plugin } from "./plugins";

import { create } from "venom-bot";

import { plugins as pluginsToLoad } from "../config.json";
import { CommandError, CommandPermissionError } from "./error";
import { getPermissionLevel, PermissionLevel } from "./perms";

const commands: Record<string, Command & { plugin: Plugin }> = {};
const plugins: Plugin[] = [];

function loadPlugin(plugin: Plugin) {
  plugins.push(plugin);

  for (const cmd of plugin.commands) {
    if (cmd.name in commands) {
      throw new Error(
        `Command "${cmd.name}" is duplicated. Already loaded from plugin "${commands[cmd.name].plugin.name}", tried to load from plugin "${plugin.name}"`,
      );
    }

    commands[cmd.name] = {
      ...cmd,
      plugin,
    };
  }
}

loadPlugin({
  name: "Core",
  description: "Core commands",
  version: "0.0.1",

  commands: [
    {
      name: "help",
      description: "Shows this help message",
      minLevel: PermissionLevel.NONE,

      handler(message, client, rest) {
        const showHidden = rest === "all";

        let help = "Commands:";

        // TODO: group commands by plugin

        for (const [name, cmd] of Object.entries(commands)) {
          if ("hidden" in cmd && cmd.hidden && !showHidden) {
            continue;
          }

          help += `\n* \`/${name}\`: ${cmd.description}`;
        }

        return help;
      },
    },
    {
      name: "stop",
      description: "Stop the bot",
      minLevel: PermissionLevel.ADMIN,

      handler(message, client) {
        setTimeout(async () => {
          await client.close();

          setTimeout(() => {
            process.exit();
          }, 1000);
        }, 1000);
      },
    },
  ],
});

for (const pluginIdentifier of pluginsToLoad) {
  console.log("Loading plugin:", pluginIdentifier);

  let plugin: Plugin;
  if (pluginIdentifier.includes("/")) {
    plugin = (await import(pluginIdentifier)).default;
  } else {
    plugin = (await import(`./plugins/${pluginIdentifier}`)).default;
  }

  loadPlugin(plugin);
}

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
