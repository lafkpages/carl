import type { InferOutput } from "valibot";

import { number, object } from "valibot";

export interface RateLimitEvent {
  timestamp: number;
  points: number;
  plugin?: string;
  command?: string;
}

export type RateLimit = InferOutput<typeof rateLimitSchema>;

export const rateLimitSchema = object({
  duration: number(),
  max: number(),
});

const userEvents = new Map<string, RateLimitEvent[]>();
// export { userEvents as _userEvents };

export function rateLimit(
  userId: string,
  event: Omit<RateLimitEvent, "timestamp">,
) {
  const now = Date.now();

  let events = userEvents.get(userId);
  if (!events) {
    events = [];
    userEvents.set(userId, events);
  }

  const fullEvent: RateLimitEvent = { ...event, timestamp: now };

  events.push(fullEvent);

  return fullEvent;
}

export function checkRateLimit(
  userId: string,
  rateLimits: RateLimit[],
  plugin?: string,
  command?: string,
) {
  const now = Date.now();

  const events = userEvents.get(userId);

  if (!events) {
    return false;
  }

  const shouldFilterEvents = plugin || command;
  const filteredEvents: RateLimitEvent[] = shouldFilterEvents ? [] : events;
  if (shouldFilterEvents) {
    for (const event of events) {
      if (
        (plugin && event.plugin !== plugin) ||
        (command && event.command !== command)
      ) {
        continue;
      }

      filteredEvents.push(event);
    }
  }

  for (const limit of rateLimits) {
    let pointsUsed = 0;

    for (const event of filteredEvents) {
      if (now - event.timestamp > limit.duration) {
        continue;
      }

      pointsUsed += event.points;
    }

    if (pointsUsed > limit.max) {
      return true;
    }
  }

  return false;
}
