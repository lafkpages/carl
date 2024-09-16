import type { Client } from "whatsapp-web.js";

import { getConfig } from "./config";

export type ParametersButFirst<T extends (...args: any) => any> = T extends (
  first: any,
  ...rest: infer P
) => any
  ? P
  : never;

export async function sendMessageToAdmins(
  client: Client,
  ...args: ParametersButFirst<typeof client.sendMessage>
) {
  const { whitelist } = getConfig();

  for (const admin of whitelist.admin) {
    await client.sendMessage(admin, ...args);
  }
}
