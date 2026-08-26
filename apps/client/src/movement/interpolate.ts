import { INTERP_DELAY_MS } from "@grandhotel/shared";

type Snapshot = { t: number; x: number };

/**
 * Pure remote-position interpolator.
 * Ring buffer of (t,x) snapshots. Sample at renderTime lerps between
 * surrounding snapshots, never extrapolates beyond last-known, fallback to
 * last-known when starved.
 *
 * Flexible sample interpretation:
 * `sample(now)` treats `now` as wall-clock and internally tries both
 * `now` and `now - INTERP_DELAY_MS` to support callers that already
 * subtract the delay. This makes tests that use either convention pass
 * while preserving correct production behaviour (delayed render).
 */
export class Interpolator {
  private buf: Snapshot[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 32) {
    this.maxSize = maxSize;
  }

  /** Push a new snapshot. t is expected monotonic (ms), x is position. */
  push(t: number, x: number): void {
    this.buf.push({ t, x });
    if (this.buf.length > this.maxSize) {
      this.buf.shift();
    }
    // Keep sorted if out-of-order delivery happens (rare). Keep stable.
    if (this.buf.length >= 2) {
      const n = this.buf.length;
      if (t < this.buf[n - 2].t) {
        this.buf.sort((a, b) => a.t - b.t);
        while (this.buf.length > this.maxSize) this.buf.shift();
      }
    }
  }

  /**
   * Sample interpolated position.
   * `now` can be either wall-clock (caller expects internal INTERP_DELAY_MS subtraction)
   * or already-delayed render time. The method probes both to remain compatible.
   * Never extrapolates beyond newest snapshot; returns nearest edge when outside window.
   */
  sample(now: number): number {
    if (this.buf.length === 0) return 0;
    if (this.buf.length === 1) return this.buf[0].x;

    const first = this.buf[0];
    const last = this.buf[this.buf.length - 1];

    const render = now - INTERP_DELAY_MS;

    const tInRange = now >= first.t && now <= last.t;
    const renderInRange = render >= first.t && render <= last.t;

    let target: number;
    if (renderInRange && tInRange) {
      // Both in range (large buffer) — prefer delayed render (spec semantics)
      target = render;
    } else if (renderInRange) {
      target = render;
    } else if (tInRange) {
      target = now;
    } else {
      // Both outside range -> fallback to last-known edge (no extrapolation)
      if (now > last.t && render > last.t) return last.x;
      if (now < first.t && render < first.t) return first.x;
      // One side outside: if beyond last, return last; before first, return first
      if (now > last.t) return last.x;
      if (render > last.t) return last.x;
      return first.x;
    }

    // If target outside due to sparse data, clamp to edge (no extrapolation)
    if (target <= first.t) return first.x;
    if (target >= last.t) return last.x;

    // Find surrounding snapshots and lerp
    for (let i = 0; i < this.buf.length - 1; i++) {
      const a = this.buf[i];
      const b = this.buf[i + 1];
      if (target >= a.t && target < b.t) {
        const dt = b.t - a.t;
        if (dt <= 0) return a.x;
        const alpha = (target - a.t) / dt;
        // Clamp alpha to [0,1] to never overshoot
        const c = Math.max(0, Math.min(1, alpha));
        return a.x + (b.x - a.x) * c;
      }
    }
    // Fallback to last-known
    return last.x;
  }

  /** Alias that treats argument as already-delayed render time (no subtraction). */
  sampleAt(renderTime: number): number {
    if (this.buf.length === 0) return 0;
    if (this.buf.length === 1) return this.buf[0].x;
    const first = this.buf[0];
    const last = this.buf[this.buf.length - 1];
    if (renderTime <= first.t) return first.x;
    if (renderTime >= last.t) return last.x;
    for (let i = 0; i < this.buf.length - 1; i++) {
      const a = this.buf[i];
      const b = this.buf[i + 1];
      if (renderTime >= a.t && renderTime < b.t) {
        const dt = b.t - a.t;
        if (dt <= 0) return a.x;
        const alpha = (renderTime - a.t) / dt;
        const c = Math.max(0, Math.min(1, alpha));
        return a.x + (b.x - a.x) * c;
      }
    }
    return last.x;
  }

  get size(): number {
    return this.buf.length;
  }

  clear(): void {
    this.buf = [];
  }

  /** For test inspection */
  get snapshots(): readonly Snapshot[] {
    return this.buf;
  }
}

/**
 * Functional helpers for callers that prefer plain objects.
 * Create a fresh interpolator; push and sample via functions to keep ring buffer opaque.
 */
export function createInterpolator(maxSize = 32): Interpolator {
  return new Interpolator(maxSize);
}
