import type { Message } from "venom-bot";
import type { Command, Plugin } from "./plugins";

import { create } from "venom-bot";

import { plugins as configPlugins } from "../config.json";
import { CommandError, CommandPermissionError } from "./error";
import { getPermissionLevel, PermissionLevel } from "./perms";

if (!process.isBun) {
  throw new Error("WhatsApp PA must be run with Bun");
}

const commands: Record<string, Command & { plugin: Plugin }> = {};
const plugins: Plugin[] = [];

function loadPlugin(plugin: Plugin) {
  console.log("Loading plugin:", plugin.name);

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

async function loadPluginsFromConfig(idsToLoad?: Set<string> | null) {
  const now = Date.now();

  for (const pluginIdentifier of configPlugins) {
    console.log("Importing plugin:", pluginIdentifier);

    // add a cache buster to the import path
    // so that plugins can be reloaded

    let plugin: Plugin;
    if (pluginIdentifier.includes("/")) {
      plugin = (await import(`${pluginIdentifier}?${now}`)).default;
    } else {
      plugin = (await import(`./plugins/${pluginIdentifier}?${now}`)).default;
    }

    if (idsToLoad && !idsToLoad.has(plugin.id)) {
      continue;
    }

    loadPlugin(plugin);
  }
}

const corePlugin: Plugin = {
  id: "core",
  name: "Core",
  description: "Core commands",
  version: "0.0.1",

  commands: [
    {
      name: "help",
      description:
        "Shows this help message (use `/help all` to show hidden commands)",
      minLevel: PermissionLevel.NONE,

      handler(message, client, rest) {
        const showHidden = rest === "all";

        let msg = "Plugins:";

        for (const plugin of plugins) {
          if (plugin.hidden && !showHidden) {
            continue;
          }

          msg += `\n\n*${plugin.name}* (${plugin.version})`;
          msg += `\n> ${plugin.description}`;
          msg += `\nCommands:`;

          for (const command of plugin.commands) {
            if (command.hidden && !showHidden) {
              continue;
            }

            msg += `\n* \`/${command.name}\`: ${command.description}`;
          }
        }

        return msg;
      },
    },
    {
      name: "stop",
      description: "Stop the bot gracefully",
      minLevel: PermissionLevel.ADMIN,

      async handler() {
        console.log("[core] Triggering graceful stop");

        await stopGracefully();

        return true;
      },
    },
    {
      name: "forcestop",
      description: "Stop the bot without unloading plugins",
      minLevel: PermissionLevel.ADMIN,

      async handler() {
        console.log("[core] Triggering force stop");

        await stop();

        return true;
      },
    },
    {
      name: "reload",
      description: "Reload plugins",
      minLevel: PermissionLevel.ADMIN,

      async handler(message, client, rest) {
        rest = rest.trim().toLowerCase();

        const pluginsToReload = rest ? new Set(rest.split(/[,\s]+/)) : null;

        if (pluginsToReload?.size === 0) {
          return false;
        }

        // Run plugin onUnload events
        for (const plugin of plugins) {
          if (pluginsToReload && !pluginsToReload.has(plugin.id)) {
            continue;
          }

          if (plugin.onUnload) {
            console.log("Unloading plugin on reload:", plugin.id);
            plugin.onUnload(client);
          }
        }

        if (pluginsToReload) {
          for (const plugin of plugins) {
            if (
              // only unload plugins that are in pluginsToReload
              pluginsToReload.has(plugin.id)
            ) {
              // delete plugin from plugins array
              plugins.splice(plugins.indexOf(plugin), 1);

              // delete the plugin's commands from the commands object
              for (const command in commands) {
                if (commands[command].plugin === plugin) {
                  delete commands[command];
                }
              }
            }
          }
        } else {
          // Clear all plugins and commands
          plugins.length = 0;
          for (const command in commands) {
            delete commands[command];
          }
        }

        // Reload plugins
        if (!pluginsToReload || pluginsToReload.has("core")) {
          loadPlugin(corePlugin);
        }
        await loadPluginsFromConfig(pluginsToReload);

        return true;
      },
    },
  ],
};

// Load plugins
loadPlugin(corePlugin);
await loadPluginsFromConfig();

const client = await create({
  session: "session-name",
});

// Fire plugin onLoad events
for (const plugin of plugins) {
  await plugin.onLoad?.(client);
}

client.onMessage(async (message) => {
  if (message.type !== "chat") {
    return;
  }

  const permissionLevel = Math.max(
    getPermissionLevel(message.sender.id),
    getPermissionLevel(message.chatId),
  );

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

          if (typeof result === "string") {
            await client.reply(message.from, result, message.id);
          } else if (result === true) {
            await client.sendReactions(message.id, "\u{1F44D}");
          } else if (result === false) {
            await client.sendReactions(message.id, "\u{1F44E}");
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
      `Error:\n\`\`\`\n${Bun.inspect(error, { colors: false })}\`\`\``,
      message.id,
    );
  }
}

async function stopGracefully() {
  for (const plugin of plugins) {
    if (plugin.onUnload) {
      console.log("Unloading plugin on graceful stop:", plugin.id);
      plugin.onUnload(client);
    }
  }

  console.log("Gracefully stopping");
  await stop();
}

async function stop() {
  console.log("Waiting a second before closing client on stop");
  await Bun.sleep(1000);

  console.log("Closing client on stop");
  await client.close();

  console.log("Waiting a second before exiting process on stop");
  await Bun.sleep(1000);

  console.log("Exiting process on stop");
  process.exit();
}
