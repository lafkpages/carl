import type { MaybePromise } from "elysia";

type EventMap<T> = Record<keyof T, unknown[]>;

export class AsyncEventEmitter<T extends EventMap<T>> {
  private _listeners = new Map<string, Set<Function>>();

  on<Event extends keyof T & string>(
    event: Event,
    listener: (...args: T[Event]) => MaybePromise<void>,
  ) {
    let listeners = this._listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this._listeners.set(event, listeners);
    }

    listeners.add(listener);
  }

  off<Event extends keyof T & string>(
    event: Event,
    listener: (...args: T[Event]) => MaybePromise<void>,
  ) {
    const listeners = this._listeners.get(event);

    if (!listeners) {
      return;
    }

    listeners.delete(listener);

    if (listeners.size === 0) {
      this._listeners.delete(event);
    }
  }

  hasListeners<Event extends keyof T & string>(event: Event) {
    return this._listeners.has(event);
  }

  async run<Event extends keyof T & string>(event: Event, ...args: T[Event]) {
    const listeners = this._listeners.get(event);

    if (!listeners) {
      return false;
    }

    const promises: Promise<void>[] = [];

    for (const listener of listeners) {
      promises.push(listener(...args));
    }

    await Promise.all(promises);

    return true;
  }
}
