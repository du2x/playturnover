import { describe, it, expect, afterEach } from "vitest";
import { ELEVATOR_A_X, ELEVATOR_B_X } from "@grandhotel/shared";
import {
  createRoomAndJoin,
  startRound,
  collectRoles,
  waitForPhase,
  waitForElevatorState,
  waitForPlayerFloor,
  waitForRoomState,
  moveToX,
  startChannel,
  callElevator,
  rideElevator,
  sendAccusation,
  getServerRoom,
  disconnect,
} from "../harness/helpers.js";
import type { HarnessClient } from "../harness/clients.js";
import {
  parseTelemetryJsonl,
  computeRoundKpis,
  computeAggregateKpis,
  computeDecoyCallUsage,
  computeTimeToFirstCrimeDiscovery,
  computeSaboteurWinRate,
  computeCorrectAccusationRate,
  computeCatchesPerHour,
  type TelemetryRecord,
} from "../kpi.js";

describe("m3 telemetry and KPI computation", () => {
  let result: {
    clients: HarnessClient[];
    roomId: string;
    url: string;
    close: () => Promise<void>;
  } | null = null;

  afterEach(async () => {
    if (result) {
      for (const c of result.clients) {
        try {
          disconnect(c);
        } catch {}
      }
      await result.close();
      result = null;
    }
  });

  it("m3 telemetry: full round produces JSONL records and validates KPI metrics", async () => {
    result = await createRoomAndJoin(4, ["Alex", "Blake", "Casey", "Drew"], {
      shiftLengthSOverride: 60,
    });
    const clients = result.clients;
    const roomId = result.roomId;

    const serverRoom = getServerRoom(roomId);
    expect(serverRoom).toBeDefined();

    const rolesPromise = collectRoles(clients);
    await startRound(clients[0]!);
    await waitForPhase(clients, "playing", 5000);
    const roles = await rolesPromise;

    const saboteur = clients.find((c) => roles.get(c.sessionId!) === "saboteur");
    const staffMembers = clients.filter((c) => roles.get(c.sessionId!) === "staff");
    expect(saboteur).toBeDefined();
    expect(staffMembers.length).toBe(3);

    const staff1 = staffMembers[0]!;
    const staff2 = staffMembers[1]!;
    const saboteurSessionId = saboteur!.sessionId!;

    // 1. Decoy elevator call: saboteur calls elevator B on floor 0, but never boards it
    await moveToX(saboteur!, ELEVATOR_B_X, { timeoutMs: 8000 });
    callElevator(saboteur!, "B");
    await new Promise<void>((r) => setTimeout(r, 200));

    // 2. Real elevator call & ride: staff1 calls elevator A and rides to floor 1
    await moveToX(staff1, ELEVATOR_A_X, { timeoutMs: 8000 });
    callElevator(staff1, "A");
    await waitForElevatorState(staff1, "A", "boarding", 6000);
    rideElevator(staff1, "A", 1);
    await waitForPlayerFloor(staff1, staff1.sessionId!, 1, 6000);

    // 3. staff1 preps room 1-0
    await moveToX(staff1, 140, { timeoutMs: 8000 });
    startChannel(staff1, "prep", "1-0");
    await waitForRoomState(staff1, "1-0", "prepped", 8000);

    // 4. Saboteur calls elevator A on floor 0 and rides to floor 1
    await moveToX(saboteur!, ELEVATOR_A_X, { timeoutMs: 8000 });
    callElevator(saboteur!, "A");
    await waitForElevatorState(saboteur!, "A", "boarding", 6000);
    rideElevator(saboteur!, "A", 1);
    await waitForPlayerFloor(saboteur!, saboteurSessionId, 1, 6000);

    // 5. Saboteur unpreps room 1-0 (sabotage)
    await moveToX(saboteur!, 140, { timeoutMs: 8000 });
    startChannel(saboteur!, "unprep", "1-0");
    await waitForRoomState(saboteur!, "1-0", "trashed", 8000);

    // 6. staff2 rides elevator A to floor 1 and steps into room 1-0 -> triggers discovery!
    await moveToX(staff2, ELEVATOR_A_X, { timeoutMs: 8000 });
    callElevator(staff2, "A");
    await waitForElevatorState(staff2, "A", "boarding", 6000);
    rideElevator(staff2, "A", 1);
    await waitForPlayerFloor(staff2, staff2.sessionId!, 1, 6000);

    // Move into room 1-0 where the crime took place
    await moveToX(staff2, 140, { timeoutMs: 8000 });

    // 7. staff2 makes a correct accusation against the saboteur -> round ends
    sendAccusation(staff2, saboteurSessionId);
    await waitForPhase(clients, "results", 10000);

    // 8. Capture server telemetry JSONL and records
    const jsonl = serverRoom!.getTelemetryJsonl();
    const records: TelemetryRecord[] = serverRoom!.getTelemetryRecords() as TelemetryRecord[];

    expect(typeof jsonl).toBe("string");
    expect(jsonl.length).toBeGreaterThan(0);
    expect(records.length).toBeGreaterThanOrEqual(7);

    // Parse JSONL and verify parity with getTelemetryRecords()
    const parsedFromJsonl = parseTelemetryJsonl(jsonl);
    expect(parsedFromJsonl.length).toBe(records.length);

    // Verify round_start record
    const startRecord = records.find((r) => r.type === "round_start");
    expect(startRecord).toBeDefined();
    expect(startRecord?.saboteurSessionId).toBe(saboteurSessionId);
    expect(startRecord?.playerCount).toBe(4);

    // Verify coverage_sample records
    const coverageSamples = records.filter((r) => r.type === "coverage_sample");
    expect(coverageSamples.length).toBeGreaterThanOrEqual(1);
    for (const sample of coverageSamples) {
      expect(typeof sample.timestamp).toBe("number");
      expect(typeof sample.coverage).toBe("number");
      expect(typeof sample.coveragePercent).toBe("number");
      expect(typeof sample.preppedCount).toBe("number");
      expect(typeof sample.trashedCount).toBe("number");
      expect(typeof sample.cleanCount).toBe("number");
    }

    // Verify discrete action records
    const prepRecord = records.find((r) => r.type === "prep");
    expect(prepRecord).toBeDefined();
    expect(prepRecord?.actorSessionId).toBe(staff1.sessionId);
    expect(prepRecord?.roomId).toBe("1-0");

    const sabotageRecord = records.find((r) => r.type === "sabotage");
    expect(sabotageRecord).toBeDefined();
    expect(sabotageRecord?.actorSessionId).toBe(saboteurSessionId);
    expect(sabotageRecord?.roomId).toBe("1-0");
    expect(sabotageRecord?.valid).toBe(true);

    const discoveryRecord = records.find((r) => r.type === "discovery");
    expect(discoveryRecord).toBeDefined();
    expect(discoveryRecord?.actorSessionId).toBe(staff2.sessionId);
    expect(discoveryRecord?.roomId).toBe("1-0");
    expect(typeof discoveryRecord?.timeSinceCrimeMs).toBe("number");
    expect((discoveryRecord?.timeSinceCrimeMs ?? -1)).toBeGreaterThanOrEqual(0);

    const accusationRecord = records.find((r) => r.type === "accusation");
    expect(accusationRecord).toBeDefined();
    expect(accusationRecord?.actorSessionId).toBe(staff2.sessionId);
    expect(accusationRecord?.targetSessionId).toBe(saboteurSessionId);
    expect(accusationRecord?.valid).toBe(true);

    const endRecord = records.find((r) => r.type === "round_end");
    expect(endRecord).toBeDefined();
    expect(endRecord?.winner).toBe("staff");
    expect(endRecord?.traitorSessionId).toBe(saboteurSessionId);

    // 9. Verify KPI computation functions
    const roundKpis = computeRoundKpis(jsonl);
    expect(roundKpis.winner).toBe("staff");
    expect(roundKpis.saboteurWon).toBe(false);
    expect(roundKpis.totalAccusations).toBe(1);
    expect(roundKpis.correctAccusations).toBe(1);
    expect(roundKpis.correctAccusationRate).toBe(1.0);
    expect(roundKpis.timeToFirstCrimeDiscoveryMs).not.toBeNull();
    expect(roundKpis.timeToFirstCrimeDiscoveryMs!).toBeGreaterThanOrEqual(0);
    expect(roundKpis.timeToFirstCrimeDiscoverySeconds).not.toBeNull();
    expect(roundKpis.totalCalls).toBeGreaterThanOrEqual(2);
    expect(roundKpis.decoyCalls).toBeGreaterThanOrEqual(1);
    expect(roundKpis.decoyCallRate).toBeGreaterThan(0);

    const decoyStats = computeDecoyCallUsage(records);
    expect(decoyStats.totalCalls).toBeGreaterThanOrEqual(2);
    expect(decoyStats.decoyCalls).toBeGreaterThanOrEqual(1);
    expect(decoyStats.decoyRate).toBeGreaterThan(0);

    const discoveryTimeMs = computeTimeToFirstCrimeDiscovery(records);
    expect(discoveryTimeMs).not.toBeNull();
    expect(discoveryTimeMs!).toBeGreaterThanOrEqual(0);

    const saboteurWinRate = computeSaboteurWinRate(records);
    expect(saboteurWinRate).toBe(0.0);

    const correctAccRate = computeCorrectAccusationRate(records);
    expect(correctAccRate).toBe(1.0);

    const catchesPerHour = computeCatchesPerHour(records);
    expect(typeof catchesPerHour).toBe("number");

    // Test Aggregate KPIs
    const aggregateKpis = computeAggregateKpis([jsonl]);
    expect(aggregateKpis.totalRounds).toBe(1);
    expect(aggregateKpis.staffWins).toBe(1);
    expect(aggregateKpis.saboteurWins).toBe(0);
    expect(aggregateKpis.saboteurWinRate).toBe(0.0);
    expect(aggregateKpis.correctAccusations).toBe(1);
    expect(aggregateKpis.correctAccusationRate).toBe(1.0);
    expect(aggregateKpis.totalCalls).toBeGreaterThanOrEqual(2);
    expect(aggregateKpis.totalDecoyCalls).toBeGreaterThanOrEqual(1);
    expect(aggregateKpis.decoyCallRate).toBeGreaterThan(0);
    expect(aggregateKpis.averageTimeToFirstCrimeDiscoveryMs).not.toBeNull();
  }, 45000);
});
