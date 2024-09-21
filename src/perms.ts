import { getConfig } from "./config";

export enum PermissionLevel {
  NONE,
  TRUSTED,
  ADMIN,

  // cannot be given to users
  MAX,
}

export function getPermissionLevel(userId: string) {
  const { whitelist } = getConfig();

  if (whitelist.admin.includes(userId)) {
    return PermissionLevel.ADMIN;
  } else if (whitelist.trusted.includes(userId)) {
    return PermissionLevel.TRUSTED;
  }
  return PermissionLevel.NONE;
}
