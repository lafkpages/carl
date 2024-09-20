import type { Config } from "./config";
import type { PermissionLevel } from "./perms";
import type { Plugin } from "./plugins";

export function generateHelp(
  plugins: Plugin[],
  permissionLevel: PermissionLevel,
  showHidden = false,
) {
  let msg = "Plugins:";

  for (const plugin of plugins) {
    if (!showHidden && plugin.hidden) {
      continue;
    }

    let commandsMsg = "";

    if (plugin.commands) {
      for (const command of plugin.commands) {
        if (
          (command.hidden || command.minLevel > permissionLevel) &&
          !showHidden
        ) {
          continue;
        }

        commandsMsg += `\n* \`/${command.name}\`: ${command.description}`;
      }
    }

    if (commandsMsg) {
      msg += `\n\n*${plugin.name}* (${plugin.version})`;
      msg += `\n> ${plugin.description}`;
      msg += `\nCommands:${commandsMsg}`;
    }
  }

  return msg;
}

/**
 * Splits a help message into pages, each containing
 * about {@link pageSize} characters. The pages are
 * split every line.
 */
export function generateHelpPage(config: Config, help: string, page: number) {
  const pageSize = config.helpPageSize;

  let start = (page - 1) * pageSize;
  let end = start + pageSize;

  if (page > 1) {
    // Move start to the end of the current line
    while (start < end && help[start] !== "\n") {
      start++;
    }
  }

  // Move end to the end of the current line
  while (end < help.length && help[end] !== "\n") {
    end++;
  }

  return help.slice(start, end).trim();
}
