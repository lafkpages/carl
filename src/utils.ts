import type { Client, Message } from "whatsapp-web.js";

import { getConfig } from "./config";

export const isInGithubCodespace = process.env.CODESPACES === "true";

export type ParametersButFirst<T extends (...args: any) => any> = T extends (
  first: any,
  ...rest: infer P
) => any
  ? P
  : never;

export async function sendMessageToUsers(
  client: Client,
  chatIds: string[],
  ...args: ParametersButFirst<typeof client.sendMessage>
) {
  const promises: Promise<Message>[] = [];

  for (const chatId of chatIds) {
    promises.push(client.sendMessage(chatId, ...args));
  }

  return await Promise.all(promises);
}

export async function sendMessageToAdmins(
  client: Client,
  ...args: ParametersButFirst<typeof client.sendMessage>
) {
  const { whitelist } = getConfig();

  return await sendMessageToUsers(client, whitelist.admin, ...args);
}
