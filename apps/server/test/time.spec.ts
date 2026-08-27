import { describe, it, expect, vi } from "vitest";
import { ColyseusClock, VirtualClock } from "../src/time.js";

describe("VirtualClock", () => {
  it("now starts at 0 and setNow moves it", () => {
    const clock = new VirtualClock();
    expect(clock.now()).toBe(0);
    clock.setNow(500);
    expect(clock.now()).toBe(500);
  });

  it("setTimeout fires when advance reaches its deadline", () => {
    const clock = new VirtualClock();
    const fired: number[] = [];
    clock.setTimeout(100, () => fired.push(1));
    clock.advance(50);
    expect(fired).toEqual([]);
    clock.advance(50);
    expect(fired).toEqual([1]);
  });

  it("fires timers in deadline order", () => {
    const clock = new VirtualClock();
    const order: string[] = [];
    clock.setTimeout(30, () => order.push("a"));
    clock.setTimeout(10, () => order.push("b"));
    clock.setTimeout(20, () => order.push("c"));
    clock.advance(100);
    expect(order).toEqual(["b", "c", "a"]);
  });

  it("a callback scheduling another timer within the window fires too", () => {
    const clock = new VirtualClock();
    const order: string[] = [];
    clock.setTimeout(10, () => {
      order.push("first");
      clock.setTimeout(10, () => order.push("second"));
    });
    clock.advance(20);
    expect(order).toEqual(["first", "second"]);
  });

  it("setInterval fires repeatedly across advance calls and reschedules", () => {
    const clock = new VirtualClock();
    const fired: number[] = [];
    clock.setInterval(100, () => fired.push(clock.now()));
    clock.advance(250);
    // fires at t=100 and t=200 within the first window
    expect(fired).toEqual([100, 200]);
    clock.advance(50);
    // fires at t=300
    expect(fired).toEqual([100, 200, 300]);
    clock.advance(200);
    // fires at t=400 and t=500
    expect(fired).toEqual([100, 200, 300, 400, 500]);
  });

  it("Cancel stops a pending timer", () => {
    const clock = new VirtualClock();
    const fired: string[] = [];
    const cancelTimeout = clock.setTimeout(100, () => fired.push("t"));
    const cancelInterval = clock.setInterval(50, () => fired.push("i"));
    cancelTimeout();
    cancelInterval();
    clock.advance(1000);
    expect(fired).toEqual([]);
  });

  it("clearAll empties the queue", () => {
    const clock = new VirtualClock();
    const fired: string[] = [];
    clock.setTimeout(100, () => fired.push("a"));
    clock.setInterval(50, () => fired.push("b"));
    clock.clearAll();
    clock.advance(1000);
    expect(fired).toEqual([]);
  });

  it("advance never fires timers beyond the target", () => {
    const clock = new VirtualClock();
    const fired: string[] = [];
    clock.setTimeout(100, () => fired.push("t"));
    clock.setInterval(60, () => fired.push("i"));
    clock.advance(150);
    // timeout at t=100 fires; interval fires at t=60 and t=120, but its
    // third tick at t=180 is beyond the 150ms target and must not fire
    expect(fired).toEqual(["i", "t", "i"]);
  });
});

describe("ColyseusClock", () => {
  function makeStub(): {
    clock: {
      setTimeout(cb: () => void, ms: number, ...args: unknown[]): { clear: ReturnType<typeof vi.fn> };
      setInterval(cb: () => void, ms: number, ...args: unknown[]): { clear: ReturnType<typeof vi.fn> };
      clear: ReturnType<typeof vi.fn>;
    };
    calls: Array<{ type: "timeout" | "interval"; ms: number }>;
    delayed: Array<{ clear: ReturnType<typeof vi.fn> }>;
  } {
    const calls: Array<{ type: "timeout" | "interval"; ms: number }> = [];
    const delayed: Array<{ clear: ReturnType<typeof vi.fn> }> = [];
    const clock = {
      setTimeout: (_cb: () => void, ms: number) => {
        calls.push({ type: "timeout", ms });
        const d = { clear: vi.fn() };
        delayed.push(d);
        return d;
      },
      setInterval: (_cb: () => void, ms: number) => {
        calls.push({ type: "interval", ms });
        const d = { clear: vi.fn() };
        delayed.push(d);
        return d;
      },
      clear: vi.fn(),
    };
    return { clock, calls, delayed };
  }

  it("delegates now to Date.now", () => {
    const { clock } = makeStub();
    const adapter = new ColyseusClock(clock);
    expect(adapter.now()).toBe(Date.now());
  });

  it("delegates setTimeout with (fn, ms) argument order", () => {
    const { clock, calls } = makeStub();
    const adapter = new ColyseusClock(clock);
    adapter.setTimeout(500, () => undefined);
    expect(calls).toEqual([{ type: "timeout", ms: 500 }]);
  });

  it("delegates setInterval with (fn, ms) argument order", () => {
    const { clock, calls } = makeStub();
    const adapter = new ColyseusClock(clock);
    adapter.setInterval(1000, () => undefined);
    expect(calls).toEqual([{ type: "interval", ms: 1000 }]);
  });

  it("returned Cancel clears the Delayed and untracks it", () => {
    const { clock, delayed } = makeStub();
    const adapter = new ColyseusClock(clock);
    const cancel = adapter.setTimeout(100, () => undefined);
    cancel();
    expect(delayed[0]!.clear).toHaveBeenCalledTimes(1);
    // after cancel the timer is untracked, so clearAll does not clear it again
    adapter.clearAll();
    expect(delayed[0]!.clear).toHaveBeenCalledTimes(1);
  });

  it("clearAll clears every tracked timer and the wrapped clock", () => {
    const { clock, delayed } = makeStub();
    const adapter = new ColyseusClock(clock);
    const cancel = adapter.setTimeout(100, () => undefined);
    adapter.setInterval(1000, () => undefined);
    cancel();
    adapter.clearAll();
    expect(delayed[0]!.clear).toHaveBeenCalledTimes(1); // canceled: not re-cleared
    expect(delayed[1]!.clear).toHaveBeenCalledTimes(1); // still tracked
    expect(clock.clear).toHaveBeenCalledTimes(1);
  });
});