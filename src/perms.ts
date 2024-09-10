import type { Config } from "./config";

export enum PermissionLevel {
  NONE,
  TRUSTED,
  ADMIN,

  // cannot be given to users
  MAX,
}

export function getPermissionLevel(config: Config, userId: string) {
  if (config.whitelist.admin.includes(userId)) {
    return PermissionLevel.ADMIN;
  } else if (config.whitelist.trusted.includes(userId)) {
    return PermissionLevel.TRUSTED;
  }
  return PermissionLevel.NONE;
}
