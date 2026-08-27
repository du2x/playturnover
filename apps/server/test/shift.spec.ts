import { describe, it, expect } from "vitest";
import { COVERAGE_TARGET } from "@grandhotel/shared";
import {
  attritionWinner,
  beginShift,
  computeCoverage,
  coverageWinner,
} from "../src/shift.js";

describe("beginShift", () => {
  it("200 seeded runs over 4-6 ids yield exactly one saboteur and valid roles", () => {
    for (let seed = 0; seed < 200; seed++) {
      let s = seed * 9973 + 12345;
      const rng = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
      const count = 4 + (seed % 3); // 4..6 ids
      const ids = Array.from({ length: count }, (_, i) => `p${i}`);
      const { saboteurSessionId, roleBySessionId } = beginShift(ids, rng, 0, 300000);

      expect(saboteurSessionId).not.toBeNull();
      expect(ids).toContain(saboteurSessionId);
      expect(roleBySessionId.size).toBe(count);
      let saboteurs = 0;
      for (const id of ids) {
        const role = roleBySessionId.get(id);
        expect(role === "staff" || role === "saboteur").toBe(true);
        if (role === "saboteur") {
          saboteurs++;
          expect(id).toBe(saboteurSessionId);
        }
      }
      expect(saboteurs).toBe(1);
    }
  });

  it("deterministic rng: 0.0 picks the first id, 0.9999 picks the last", () => {
    const ids = ["a", "b", "c", "d"];
    const first = beginShift(ids, () => 0.0, 0, 300000);
    expect(first.saboteurSessionId).toBe("a");
    expect(first.roleBySessionId.get("a")).toBe("saboteur");
    expect(first.roleBySessionId.get("b")).toBe("staff");

    const last = beginShift(ids, () => 0.9999, 0, 300000);
    expect(last.saboteurSessionId).toBe("d");
    expect(last.roleBySessionId.get("d")).toBe("saboteur");
  });

  it("endsAt equals now + shiftLengthMs for arbitrary now", () => {
    const { endsAt } = beginShift(["a", "b"], () => 0.5, 123456, 300000);
    expect(endsAt).toBe(423456);
    const other = beginShift(["a"], () => 0.5, 0, 5000);
    expect(other.endsAt).toBe(5000);
  });

  it("empty ids: null saboteur and empty role map", () => {
    const { saboteurSessionId, roleBySessionId } = beginShift([], () => 0.5, 0, 300000);
    expect(saboteurSessionId).toBeNull();
    expect(roleBySessionId.size).toBe(0);
  });
});

describe("computeCoverage", () => {
  it("returns preppedCount / totalRooms, guarding non-positive totals", () => {
    expect(computeCoverage(0, 24)).toBe(0);
    expect(computeCoverage(20, 24)).toBeCloseTo(20 / 24, 10);
    expect(computeCoverage(24, 24)).toBe(1);
    expect(computeCoverage(10, 0)).toBe(0);
    expect(computeCoverage(10, -5)).toBe(0);
  });
});

describe("coverageWinner", () => {
  it("staff at/above COVERAGE_TARGET, saboteur below", () => {
    expect(coverageWinner(COVERAGE_TARGET - 0.01)).toBe("saboteur");
    expect(coverageWinner(0)).toBe("saboteur");
    expect(coverageWinner(COVERAGE_TARGET)).toBe("staff");
    expect(coverageWinner(COVERAGE_TARGET + 0.01)).toBe("staff");
    expect(coverageWinner(1)).toBe("staff");
  });
});

describe("attritionWinner", () => {
  it("saboteur wins only when staff count drops to 1 or below", () => {
    // 3 staff + saboteur connected
    expect(attritionWinner(4, 1)).toBeNull();
    // 1 staff + saboteur connected
    expect(attritionWinner(2, 1)).toBe("saboteur");
    // 0 staff (saboteur only)
    expect(attritionWinner(1, 1)).toBe("saboteur");
  });
});