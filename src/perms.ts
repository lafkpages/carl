import config from "../config.json";

export enum PermissionLevel {
  NONE,
  TRUSTED,
  ADMIN,

  // cannot be given to users
  MAX,
}

export function getPermissionLevel(userId: string) {
  if (config.whitelist.admin.includes(userId)) {
    return PermissionLevel.ADMIN;
  } else if (config.whitelist.trusted.includes(userId)) {
    return PermissionLevel.TRUSTED;
  }
  return PermissionLevel.NONE;
}
