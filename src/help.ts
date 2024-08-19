import type { Plugin } from "./plugins";

const pageSize = 300;

export function generateHelp(plugins: Plugin[], showHidden = false) {
  let msg = "Plugins:";

  for (const plugin of plugins) {
    if (plugin.hidden && !showHidden) {
      continue;
    }

    msg += `\n\n*${plugin.name}* (${plugin.version})`;
    msg += `\n> ${plugin.description}`;
    msg += `\nCommands:`;

    if (plugin.commands) {
      for (const command of plugin.commands) {
        if (command.hidden && !showHidden) {
          continue;
        }

        msg += `\n* \`/${command.name}\`: ${command.description}`;
      }
    }
  }

  return msg;
}

/**
 * Splits a help message into pages, each containing
 * about {@link pageSize} characters. The pages are
 * split every line.
 */
export function generateHelpPage(help: string, page: number) {
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
