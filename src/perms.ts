import type { ChatId } from "whatsapp-web.js";

import { getConfig } from "./config";

export enum PermissionLevel {
  NONE,
  TRUSTED,
  ADMIN,

  // cannot be given to users
  MAX,
}

export function getPermissionLevel(...ids: (string | ChatId)[]) {
  const { whitelist } = getConfig();

  let permissionLevel = PermissionLevel.NONE;

  for (let id of ids) {
    if (typeof id !== "string") {
      id = id._serialized;
    }

    if (whitelist.admin.includes(id)) {
      permissionLevel = Math.max(permissionLevel, PermissionLevel.ADMIN);
    } else if (whitelist.trusted.includes(id)) {
      permissionLevel = Math.max(permissionLevel, PermissionLevel.TRUSTED);
    }
    permissionLevel = Math.max(permissionLevel, PermissionLevel.NONE);
  }

  return permissionLevel;
}
