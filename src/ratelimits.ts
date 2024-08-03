const userRateLimitsPerPluginCommand: Map<
  string,
  Map<string, Map<string, number>>
> = new Map();
const userRateLimits: Map<string, number> = new Map();

export function isCommandRateLimited(
  userId: string,
  pluginId: string,
  command: string,
  rateLimit: number,
) {
  if (rateLimit <= 0) {
    return false;
  }

  if (!userRateLimitsPerPluginCommand.has(userId)) {
    userRateLimitsPerPluginCommand.set(userId, new Map());
  }

  const userRateLimits = userRateLimitsPerPluginCommand.get(userId)!;

  if (!userRateLimits.has(pluginId)) {
    userRateLimits.set(pluginId, new Map());
  }

  const pluginRateLimits = userRateLimits.get(pluginId)!;

  if (!pluginRateLimits.has(command)) {
    pluginRateLimits.set(command, Date.now());
    return false;
  }

  const lastRun = pluginRateLimits.get(command)!;
  const now = Date.now();

  if (now - lastRun < rateLimit) {
    return true;
  }

  pluginRateLimits.set(command, now);

  return false;
}

export function isUserRateLimited(userId: string, rateLimit: number) {
  if (rateLimit <= 0) {
    return false;
  }

  if (!userRateLimits.has(userId)) {
    userRateLimits.set(userId, Date.now());
    return false;
  }

  const lastRun = userRateLimits.get(userId)!;
  const now = Date.now();

  if (now - lastRun < rateLimit) {
    return true;
  }

  userRateLimits.set(userId, now);

  return false;
}
