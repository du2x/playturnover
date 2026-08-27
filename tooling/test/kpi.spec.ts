import { describe, it, expect } from "vitest";
import {
  parseTelemetryJsonl,
  computeSaboteurWinRate,
  computeCorrectAccusationRate,
  computeCatchesPerHour,
  computeTimeToFirstCrimeDiscovery,
  computeDecoyCallUsage,
  computeRoundKpis,
  computeAggregateKpis,
  type TelemetryRecord,
} from "../src/kpi.js";

describe("kpi telemetry analysis", () => {
  it("computes saboteur win rate from round telemetry", () => {
    const round1: TelemetryRecord[] = [
      { type: "round_start", timestamp: 1000, saboteurSessionId: "p0", playerCount: 4, players: ["p0", "p1", "p2", "p3"], shiftEndsAt: 301000 },
      { type: "round_end", timestamp: 15000, winner: "saboteur", traitorSessionId: "p0", traitorName: "P0", coverage: 0.2, coveragePercent: 20, durationMs: 14000 },
    ];
    const round2: TelemetryRecord[] = [
      { type: "round_start", timestamp: 1000, saboteurSessionId: "p1", playerCount: 4, players: ["p0", "p1", "p2", "p3"], shiftEndsAt: 301000 },
      { type: "round_end", timestamp: 20000, winner: "staff", traitorSessionId: "p1", traitorName: "P1", coverage: 0.9, coveragePercent: 90, durationMs: 19000 },
    ];
    const round3: TelemetryRecord[] = [
      { type: "round_start", timestamp: 1000, saboteurSessionId: "p2", playerCount: 4, players: ["p0", "p1", "p2", "p3"], shiftEndsAt: 301000 },
      { type: "round_end", timestamp: 10000, winner: "saboteur", traitorSessionId: "p2", traitorName: "P2", coverage: 0.4, coveragePercent: 40, durationMs: 9000 },
    ];

    expect(computeSaboteurWinRate(round1)).toBe(1.0);
    expect(computeSaboteurWinRate(round2)).toBe(0.0);
    expect(computeSaboteurWinRate([round1, round2, round3])).toBeCloseTo(2 / 3, 4);
  });

  it("computes correct accusation rate from accusation events", () => {
    const events: TelemetryRecord[] = [
      { type: "accusation", timestamp: 5000, actorSessionId: "p1", targetSessionId: "p2", valid: false, wasTargetSaboteur: false, crimeOccurred: true },
      { type: "accusation", timestamp: 8000, actorSessionId: "p3", targetSessionId: "p0", valid: true, wasTargetSaboteur: true, crimeOccurred: true },
      { type: "accusation", timestamp: 9000, actorSessionId: "p2", targetSessionId: "p1", valid: false, wasTargetSaboteur: false, crimeOccurred: true },
    ];

    expect(computeCorrectAccusationRate(events)).toBeCloseTo(1 / 3, 4);
    expect(computeCorrectAccusationRate([])).toBe(0);
  });

  it("computes catches per hour normalized to round duration", () => {
    // 1 catch in 5 minutes (300 seconds = 1/12 hour) -> 12 catches/hour
    const events: TelemetryRecord[] = [
      { type: "round_start", timestamp: 0, saboteurSessionId: "p0", playerCount: 4, players: ["p0", "p1", "p2", "p3"], shiftEndsAt: 300000 },
      { type: "catch", timestamp: 150000, actorSessionId: "p1", targetSessionId: "p0", roomId: "1-1", valid: true, wasTargetSaboteur: true, crimeOccurred: true },
      { type: "round_end", timestamp: 300000, winner: "staff", traitorSessionId: "p0", traitorName: "P0", coverage: 0.5, coveragePercent: 50, durationMs: 300000 },
    ];

    expect(computeCatchesPerHour(events)).toBe(12);
  });

  it("computes time to first crime discovery accurately", () => {
    const eventsWithDiscovery: TelemetryRecord[] = [
      { type: "prep", timestamp: 2000, actorSessionId: "p1", roomId: "1-0", valid: true, wasTargetSaboteur: false, crimeOccurred: false },
      { type: "sabotage", timestamp: 6000, actorSessionId: "p0", roomId: "1-1", valid: true, wasTargetSaboteur: true, crimeOccurred: true },
      { type: "discovery", timestamp: 10500, actorSessionId: "p2", roomId: "1-1", timeSinceCrimeMs: 4500, crimeTimestamp: 6000 },
    ];

    expect(computeTimeToFirstCrimeDiscovery(eventsWithDiscovery)).toBe(4500);

    const eventsNoCrime: TelemetryRecord[] = [
      { type: "prep", timestamp: 2000, actorSessionId: "p1", roomId: "1-0", valid: true, wasTargetSaboteur: false, crimeOccurred: false },
    ];

    expect(computeTimeToFirstCrimeDiscovery(eventsNoCrime)).toBeNull();

    const eventsUndiscovered: TelemetryRecord[] = [
      { type: "sabotage", timestamp: 6000, actorSessionId: "p0", roomId: "1-1", valid: true, wasTargetSaboteur: true, crimeOccurred: true },
    ];

    expect(computeTimeToFirstCrimeDiscovery(eventsUndiscovered)).toBeNull();
  });

  it("computes decoy call usage based on caller boarding", () => {
    const events: TelemetryRecord[] = [
      // Call 1: p1 calls shaft A at t=1000, and p1 rides shaft A at t=4000 (NOT a decoy)
      { type: "call", timestamp: 1000, actorSessionId: "p1", shaft: "A", floor: 0, valid: true, wasTargetSaboteur: false, crimeOccurred: false },
      { type: "ride", timestamp: 4000, actorSessionId: "p1", shaft: "A", fromFloor: 0, destFloor: 2, valid: true, wasTargetSaboteur: false, crimeOccurred: false },

      // Call 2: p0 (saboteur) calls shaft B at t=5000, but never boards shaft B (DECOY)
      { type: "call", timestamp: 5000, actorSessionId: "p0", shaft: "B", floor: 1, valid: true, wasTargetSaboteur: true, crimeOccurred: false },

      // Call 3: p2 calls shaft A at t=7000, but p3 rides instead, p2 does not board (DECOY for p2)
      { type: "call", timestamp: 7000, actorSessionId: "p2", shaft: "A", floor: 0, valid: true, wasTargetSaboteur: false, crimeOccurred: false },
      { type: "ride", timestamp: 10000, actorSessionId: "p3", shaft: "A", fromFloor: 0, destFloor: 1, valid: true, wasTargetSaboteur: false, crimeOccurred: false },
    ];

    const stats = computeDecoyCallUsage(events);
    expect(stats.totalCalls).toBe(3);
    expect(stats.decoyCalls).toBe(2);
    expect(stats.decoyRate).toBeCloseTo(2 / 3, 4);
  });

  it("computes full round and aggregate KPIs from JSONL", () => {
    const jsonl1 = [
      JSON.stringify({ type: "round_start", timestamp: 1000, saboteurSessionId: "p0", playerCount: 4, players: ["p0", "p1", "p2", "p3"], shiftEndsAt: 301000 }),
      JSON.stringify({ type: "coverage_sample", timestamp: 2000, coverage: 0.1, coveragePercent: 10, preppedCount: 2, trashedCount: 0, cleanCount: 22 }),
      JSON.stringify({ type: "call", timestamp: 3000, actorSessionId: "p0", shaft: "A", floor: 0, valid: true, wasTargetSaboteur: true, crimeOccurred: false }),
      JSON.stringify({ type: "sabotage", timestamp: 5000, actorSessionId: "p0", roomId: "1-1", valid: true, wasTargetSaboteur: true, crimeOccurred: true }),
      JSON.stringify({ type: "discovery", timestamp: 8000, actorSessionId: "p1", roomId: "1-1", timeSinceCrimeMs: 3000, crimeTimestamp: 5000 }),
      JSON.stringify({ type: "accusation", timestamp: 10000, actorSessionId: "p1", targetSessionId: "p0", valid: true, wasTargetSaboteur: true, crimeOccurred: true }),
      JSON.stringify({ type: "round_end", timestamp: 10000, winner: "staff", traitorSessionId: "p0", traitorName: "P0", coverage: 0.1, coveragePercent: 10, durationMs: 9000 }),
    ].join("\n");

    const parsed = parseTelemetryJsonl(jsonl1);
    expect(parsed.length).toBe(7);

    const roundKpi = computeRoundKpis(jsonl1);
    expect(roundKpi.winner).toBe("staff");
    expect(roundKpi.saboteurWon).toBe(false);
    expect(roundKpi.totalAccusations).toBe(1);
    expect(roundKpi.correctAccusations).toBe(1);
    expect(roundKpi.correctAccusationRate).toBe(1.0);
    expect(roundKpi.timeToFirstCrimeDiscoveryMs).toBe(3000);
    expect(roundKpi.timeToFirstCrimeDiscoverySeconds).toBe(3.0);
    expect(roundKpi.totalCalls).toBe(1);
    expect(roundKpi.decoyCalls).toBe(1);
    expect(roundKpi.decoyCallRate).toBe(1.0);
    expect(roundKpi.coverageSamplesCount).toBe(1);

    const aggregate = computeAggregateKpis([jsonl1]);
    expect(aggregate.totalRounds).toBe(1);
    expect(aggregate.staffWins).toBe(1);
    expect(aggregate.saboteurWins).toBe(0);
    expect(aggregate.saboteurWinRate).toBe(0.0);
    expect(aggregate.correctAccusationRate).toBe(1.0);
    expect(aggregate.averageTimeToFirstCrimeDiscoverySeconds).toBe(3.0);
  });
});
