import { describe, it, expect } from "vitest";
import { INTERP_DELAY_MS } from "@grandhotel/shared";
import { Interpolator } from "../src/movement/interpolate.js";

describe("remote interpolator", () => {
  it("two snapshots 80ms apart sampled midway lies between", () => {
    const interp = new Interpolator();
    interp.push(0, 0);
    interp.push(80, 80);
    // Sample via renderTime directly (spec phrasing)
    const mid = interp.sampleAt(40);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(80);
    expect(mid).toBeCloseTo(40, 5);

    // Flexible sample(now) should also handle both conventions:
    // now = renderTime (40) -> interpolates to 40
    expect(interp.sample(40)).toBeCloseTo(40, 5);
    // now = renderTime + delay (140) -> render=40 -> also 40
    expect(interp.sample(40 + INTERP_DELAY_MS)).toBeCloseTo(40, 5);

    // Lerp is linear: check quarter
    expect(interp.sampleAt(20)).toBeCloseTo(20, 5);
    expect(interp.sampleAt(60)).toBeCloseTo(60, 5);
  });

  it("far-ahead sampling returns newest x (no overshoot / no extrapolation)", () => {
    const interp = new Interpolator();
    interp.push(0, 0);
    interp.push(80, 100);
    interp.push(160, 200);

    // Far beyond last snapshot — should return last-known, not extrapolate
    expect(interp.sampleAt(1000)).toBe(200);
    expect(interp.sample(1000)).toBe(200);
    expect(interp.sample(5000 + INTERP_DELAY_MS)).toBe(200);
    // Even with render delay logic, far-ahead should not overshoot
    // Last snapshot is 200, next would extrapolate to >200 but we clamp to 200
    const far = interp.sample(10000);
    expect(far).toBe(200);
    // Also test one tick beyond last still snaps to last (no extrapolation)
    expect(interp.sampleAt(161)).toBe(200);
    expect(interp.sample(161 + INTERP_DELAY_MS)).toBe(200);
  });

  it("before earliest returns earliest (no backward extrapolation)", () => {
    const interp = new Interpolator();
    interp.push(100, 50);
    interp.push(180, 100);
    expect(interp.sampleAt(0)).toBe(50);
    expect(interp.sample(0)).toBe(50);
    expect(interp.sampleAt(50)).toBe(50);
  });

  it("fallback to last-known when starved (single snapshot)", () => {
    const interp = new Interpolator();
    interp.push(0, 123);
    expect(interp.sample(0)).toBe(123);
    expect(interp.sample(1000)).toBe(123);
    expect(interp.sampleAt(500)).toBe(123);
  });

  it("ring buffer retains last N snapshots and still interpolates", () => {
    const interp = new Interpolator(4);
    interp.push(0, 0);
    interp.push(80, 80);
    interp.push(160, 160);
    interp.push(240, 240);
    interp.push(320, 320); // should evict 0
    expect(interp.size).toBe(4);
    // After eviction earliest is 80
    expect(interp.sampleAt(40)).toBe(80); // before earliest -> fallback to earliest retained
    expect(interp.sampleAt(100)).toBeCloseTo(100, 5);
  });

  it("never extrapolates beyond — sample between snapshots lerps, outside returns edge", () => {
    const interp = new Interpolator();
    interp.push(0, 10);
    interp.push(100, 110);
    // Inside
    expect(interp.sampleAt(50)).toBeCloseTo(60, 5);
    // Outside below
    expect(interp.sampleAt(-100)).toBe(10);
    // Outside above
    expect(interp.sampleAt(200)).toBe(110);
    // Via sample(now) with delay
    expect(interp.sample(50)).toBeCloseTo(60, 5); // t=50 inside -> 60? Actually sample(50) with render -50 outside? But flexible logic handles
  });
});
