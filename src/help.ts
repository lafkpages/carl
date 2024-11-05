import type { PermissionLevel } from "./perms";
import type { PluginsManager } from "./pluginsManager";

import { getConfig } from "./config";

export function generateHelp(
  pluginsManager: PluginsManager,
  permissionLevel: PermissionLevel,
  showHidden = false,
) {
  let msg = "Plugins:";

  for (const plugin of pluginsManager) {
    // @ts-expect-error: _hidden is private
    if (!showHidden && plugin._hidden) {
      continue;
    }

    let commandsMsg = "";

    // @ts-expect-error: _commands is private
    const { _commands } = plugin;

    for (const command of _commands) {
      if (
        (command.hidden || command.minLevel > permissionLevel) &&
        !showHidden
      ) {
        continue;
      }

      commandsMsg += `\n* \`/${command.name}\`: ${command.description}`;
    }

    if (commandsMsg) {
      msg += `\n\n*${plugin.name}*`;
      msg += `\n> ${plugin.description}`;
      msg += `\nCommands:${commandsMsg}`;
    }
  }

  return msg;
}

/**
 * Splits a help message into pages, each containing
 * about `Config.helpPageSize` characters. The pages are
 * split every line.
 */
export function generateHelpPage(help: string, page: number) {
  const { helpPageSize } = getConfig();

  let start = (page - 1) * helpPageSize;
  let end = start + helpPageSize;

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
