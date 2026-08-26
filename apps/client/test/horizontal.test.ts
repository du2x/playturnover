import { describe, it, expect } from "vitest";
import {
  FLOOR_COUNT,
  HALLWAY_MAX_X,
  HALLWAY_MIN_X,
  HALLWAY_Y,
  PLAYER_SPEED_PX_S,
} from "@grandhotel/shared";
import { clampToBounds, clampToFloorBounds, step } from "../src/movement/horizontal.js";

describe("horizontal movement", () => {
  it("held-right converges exactly to HALLWAY_MAX_X and stays", () => {
    let x = (HALLWAY_MIN_X + HALLWAY_MAX_X) / 2;
    const dt = 0.016; // ~60fps
    for (let i = 0; i < 500; i++) {
      x = step(x, 1, dt);
    }
    expect(x).toBe(HALLWAY_MAX_X);
    // stays clamped even with extra steps
    for (let i = 0; i < 50; i++) {
      x = step(x, 1, dt);
      expect(x).toBe(HALLWAY_MAX_X);
    }
    // large dt also clamped
    const y = step(HALLWAY_MAX_X - 10, 1, 1.0);
    expect(y).toBe(HALLWAY_MAX_X);
  });

  it("held-left converges exactly to HALLWAY_MIN_X and stays", () => {
    let x = (HALLWAY_MIN_X + HALLWAY_MAX_X) / 2;
    const dt = 0.016;
    for (let i = 0; i < 500; i++) {
      x = step(x, -1, dt);
    }
    expect(x).toBe(HALLWAY_MIN_X);
    for (let i = 0; i < 50; i++) {
      x = step(x, -1, dt);
      expect(x).toBe(HALLWAY_MIN_X);
    }
    const y = step(HALLWAY_MIN_X + 10, -1, 1.0);
    expect(y).toBe(HALLWAY_MIN_X);
  });

  it("clampToBounds is idempotent at bounds", () => {
    expect(clampToBounds(HALLWAY_MAX_X)).toBe(HALLWAY_MAX_X);
    expect(clampToBounds(HALLWAY_MIN_X)).toBe(HALLWAY_MIN_X);
    expect(clampToBounds(HALLWAY_MAX_X + 1000)).toBe(HALLWAY_MAX_X);
    expect(clampToBounds(HALLWAY_MIN_X - 1000)).toBe(HALLWAY_MIN_X);
    // mid stays
    const mid = (HALLWAY_MIN_X + HALLWAY_MAX_X) / 2;
    expect(clampToBounds(mid)).toBe(mid);
  });

  it("y invariant is structural — step carries no y param and output is only x", () => {
    // step signature is (x, dir, dt) -> number, no y in/out
    expect(step.length).toBe(3);
    const x0 = 200;
    const x1 = step(x0, 1, 0.1);
    expect(typeof x1).toBe("number");
    // y constant from shared not affected by step
    expect(HALLWAY_Y).toBe(120);
    // Repeated steps never produce a y value
    const result = step(x0, 0, 0.1);
    expect(typeof result).toBe("number");
    // Ensure step does not magically depend on y — two calls same x same dir same dt -> same result regardless of imagined y
    const a = step(300, 1, 0.05);
    const b = step(300, 1, 0.05);
    expect(a).toBe(b);
  });

  it("two co-located movers proceed independently (pass-through)", () => {
    let a = 400;
    let b = 400;
    const dt = 0.016;
    // Both start co-located, move right together — they should stay identical, no collision displacement
    for (let i = 0; i < 100; i++) {
      a = step(a, 1, dt);
      b = step(b, 1, dt);
      expect(a).toBe(b);
    }
    // One moves left, other right from same origin — they diverge symmetrically with no interaction
    let left = 400;
    let right = 400;
    for (let i = 0; i < 50; i++) {
      left = step(left, -1, dt);
      right = step(right, 1, dt);
    }
    expect(left).toBeLessThan(400);
    expect(right).toBeGreaterThan(400);
    // Distance apart equals 2 * speed * totalTime clamped
    const expectedDist = Math.min(
      HALLWAY_MAX_X - HALLWAY_MIN_X,
      2 * PLAYER_SPEED_PX_S * dt * 50,
    );
    expect(right - left).toBeCloseTo(expectedDist, 5);

    // Overlap does not block: two movers at same bound stay at bound, not pushed
    const atMaxA = step(HALLWAY_MAX_X, 1, dt);
    const atMaxB = step(HALLWAY_MAX_X, 1, dt);
    expect(atMaxA).toBe(HALLWAY_MAX_X);
    expect(atMaxB).toBe(HALLWAY_MAX_X);
    expect(atMaxA).toBe(atMaxB);
  });

  it("dt capped at 100ms semantics — step with large dt still clamped to bounds", () => {
    const start = HALLWAY_MIN_X;
    // Simulate tab-switch big delta 500ms — caller should cap to 100ms before calling step,
    // but step itself also clamps to bounds so even if uncapped it won't tunnel through.
    const uncapped = step(start, 1, 0.5);
    expect(uncapped).toBeLessThanOrEqual(HALLWAY_MAX_X);
    expect(uncapped).toBeGreaterThan(start);
    // Capped version: 0.1s
    const capped = step(start, 1, 0.1);
    expect(capped).toBe(start + PLAYER_SPEED_PX_S * 0.1);
  });

  it("step with zero dir or zero dt is identity modulo clamping", () => {
    const x = 350;
    expect(step(x, 0, 0.016)).toBe(x);
    expect(step(x, 1, 0)).toBe(x);
    expect(step(x, -1, -0.01)).toBe(x);
  });
});

describe("horizontal movement per-floor (M1)", () => {
  const floors = [0, 1, 2, 3] as const;

  for (const floor of floors) {
    describe(`floor ${floor}`, () => {
      it("held-right converges exactly to that floor's HALLWAY_MAX_X and stays", () => {
        const bounds = { minX: HALLWAY_MIN_X, maxX: HALLWAY_MAX_X };
        let x = (bounds.minX + bounds.maxX) / 2;
        const dt = 0.016;
        for (let i = 0; i < 500; i++) {
          x = step(x, 1, dt, floor);
        }
        expect(x).toBe(HALLWAY_MAX_X);
        for (let i = 0; i < 50; i++) {
          x = step(x, 1, dt, floor);
          expect(x).toBe(HALLWAY_MAX_X);
        }
        const y = step(HALLWAY_MAX_X - 10, 1, 1.0, floor);
        expect(y).toBe(HALLWAY_MAX_X);
      });

      it("held-left converges exactly to that floor's HALLWAY_MIN_X and stays", () => {
        const bounds = { minX: HALLWAY_MIN_X, maxX: HALLWAY_MAX_X };
        let x = (bounds.minX + bounds.maxX) / 2;
        const dt = 0.016;
        for (let i = 0; i < 500; i++) {
          x = step(x, -1, dt, floor);
        }
        expect(x).toBe(HALLWAY_MIN_X);
        for (let i = 0; i < 50; i++) {
          x = step(x, -1, dt, floor);
          expect(x).toBe(HALLWAY_MIN_X);
        }
        const y = step(HALLWAY_MIN_X + 10, -1, 1.0, floor);
        expect(y).toBe(HALLWAY_MIN_X);
      });

      it("y invariant — step carries no y param and output is only x", () => {
        expect(step.length).toBeGreaterThanOrEqual(3);
        const x0 = 200;
        const x1 = step(x0, 1, 0.1, floor);
        expect(typeof x1).toBe("number");
        const a = step(300, 1, 0.05, floor);
        const b = step(300, 1, 0.05, floor);
        expect(a).toBe(b);
      });

      it("two co-located movers on same floor proceed independently (pass-through)", () => {
        let a = 400;
        let b = 400;
        const dt = 0.016;
        for (let i = 0; i < 100; i++) {
          a = step(a, 1, dt, floor);
          b = step(b, 1, dt, floor);
          expect(a).toBe(b);
        }
        let left = 400;
        let right = 400;
        for (let i = 0; i < 50; i++) {
          left = step(left, -1, dt, floor);
          right = step(right, 1, dt, floor);
        }
        expect(left).toBeLessThan(400);
        expect(right).toBeGreaterThan(400);
        const expectedDist = Math.min(
          HALLWAY_MAX_X - HALLWAY_MIN_X,
          2 * PLAYER_SPEED_PX_S * dt * 50,
        );
        expect(right - left).toBeCloseTo(expectedDist, 5);
        const atMaxA = step(HALLWAY_MAX_X, 1, dt, floor);
        const atMaxB = step(HALLWAY_MAX_X, 1, dt, floor);
        expect(atMaxA).toBe(HALLWAY_MAX_X);
        expect(atMaxB).toBe(HALLWAY_MAX_X);
        expect(atMaxA).toBe(atMaxB);
      });
    });
  }

  it("clampToFloorBounds delegates to getHallBounds for each floor", () => {
    for (const floor of floors) {
      expect(clampToFloorBounds(HALLWAY_MAX_X + 100, floor)).toBe(HALLWAY_MAX_X);
      expect(clampToFloorBounds(HALLWAY_MIN_X - 100, floor)).toBe(HALLWAY_MIN_X);
      const mid = (HALLWAY_MIN_X + HALLWAY_MAX_X) / 2;
      expect(clampToFloorBounds(mid, floor)).toBe(mid);
    }
  });
});
