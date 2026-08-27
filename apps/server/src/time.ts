/**
 * Clock seam: one interface, two adapters.
 *
 * - `ColyseusClock` is the production adapter. It delegates scheduling to the
 *   Colyseus room clock (`this.clock`, an `@gamestdio/timer` `ClockTimer`) and
 *   reads wall time from `Date.now()`.
 * - `VirtualClock` is a deterministic adapter for tests. Time only moves when
 *   the test calls `advance(...)`; timers fire in deadline order.
 *
 * `HotelRoom` depends only on the `Clock` interface, so tests can inject a
 * `VirtualClock` while the default path keeps the behavior-identical
 * `ColyseusClock`.
 */

export type Cancel = () => void;

export interface Clock {
  now(): number;
  setTimeout(ms: number, fn: () => void): Cancel;
  setInterval(ms: number, fn: () => void): Cancel;
  clearAll(): void;
}

/** Shape of the `Room.clock` instance provided by Colyseus (`@gamestdio/timer`). */
interface ColyseusClockLike {
  setTimeout(cb: () => void, ms: number, ...args: unknown[]): unknown;
  setInterval(cb: () => void, ms: number, ...args: unknown[]): unknown;
  clear(): void;
}

interface DelayedLike {
  clear(): void;
}

/**
 * Production adapter: delegates scheduling to the Colyseus room clock and
 * tracks every returned `Delayed` so `clearAll()` can tear everything down.
 */
export class ColyseusClock implements Clock {
  private readonly wrapped: ColyseusClockLike;
  private readonly tracked = new Set<DelayedLike>();

  constructor(clock: ColyseusClockLike) {
    this.wrapped = clock;
  }

  now(): number {
    return Date.now();
  }

  setTimeout(ms: number, fn: () => void): Cancel {
    const delayed = this.wrapped.setTimeout(fn, ms) as DelayedLike;
    this.tracked.add(delayed);
    return () => {
      this.tracked.delete(delayed);
      delayed.clear();
    };
  }

  setInterval(ms: number, fn: () => void): Cancel {
    const delayed = this.wrapped.setInterval(fn, ms) as DelayedLike;
    this.tracked.add(delayed);
    return () => {
      this.tracked.delete(delayed);
      delayed.clear();
    };
  }

  clearAll(): void {
    for (const delayed of this.tracked) {
      delayed.clear();
    }
    this.tracked.clear();
    this.wrapped.clear();
  }
}

interface VirtualTask {
  id: number;
  dueAt: number;
  fn: () => void;
  interval: number | null;
  active: boolean;
}

/**
 * Deterministic test adapter. Time only advances when `advance()` is called;
 * timers fire in deadline order within the advanced window. A callback that
 * schedules another timer while the clock is advancing participates in the
 * same window (its deadline is relative to the virtual time at which it runs).
 */
export class VirtualClock implements Clock {
  private nowMs = 0;
  private tasks: VirtualTask[] = [];
  private nextId = 1;

  now(): number {
    return this.nowMs;
  }

  setNow(t: number): void {
    this.nowMs = t;
  }

  setTimeout(ms: number, fn: () => void): Cancel {
    return this.add(ms, fn, null);
  }

  setInterval(ms: number, fn: () => void): Cancel {
    return this.add(ms, fn, ms);
  }

  private add(ms: number, fn: () => void, interval: number | null): Cancel {
    const task: VirtualTask = {
      id: this.nextId++,
      dueAt: this.nowMs + ms,
      fn,
      interval,
      active: true,
    };
    this.tasks.push(task);
    return () => {
      task.active = false;
    };
  }

  advance(ms: number): void {
    const prev = this.nowMs;
    const target = prev + Math.max(0, ms);
    // Defensive cap: a zero-delay chain that re-schedules itself would loop
    // forever. Legitimate window work stays far below this bound.
    let iterations = 0;
    const maxIterations = 1_000_000;

    while (iterations < maxIterations) {
      let next: VirtualTask | null = null;
      for (const task of this.tasks) {
        if (!task.active) continue;
        if (task.dueAt < prev || task.dueAt > target) continue;
        if (!next || task.dueAt < next.dueAt || (task.dueAt === next.dueAt && task.id < next.id)) {
          next = task;
        }
      }
      if (!next) break;

      this.nowMs = next.dueAt;
      next.fn();
      if (next.interval !== null && next.interval > 0 && next.active) {
        // interval survives: re-arm at the next tick
        next.dueAt += next.interval;
      } else {
        next.active = false;
      }
      iterations++;
    }

    this.nowMs = target;
  }

  clearAll(): void {
    this.tasks = [];
  }
}