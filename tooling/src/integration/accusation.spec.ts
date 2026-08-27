import { describe, it, expect, afterEach } from "vitest";
import { ELEVATOR_A_X } from "@grandhotel/shared";
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
  waitForPlayerFired,
  waitForRecapEvents,
  disconnect,
} from "../harness/helpers.js";
import type { HarnessClient } from "../harness/clients.js";

describe("m3 accusation and grace period integration", () => {
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

  it("m3 grace period boundary: accusing saboteur before first crime fires accuser, and accusing after first crime fires saboteur", async () => {
    result = await createRoomAndJoin(4, ["Alex", "Blake", "Casey", "Dana"], {
      shiftLengthSOverride: 60,
    });
    const clients = result.clients;

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

    // 1. staff1 and saboteur ride elevator A to floor 1
    await moveToX(staff1, ELEVATOR_A_X, { timeoutMs: 8000 });
    await moveToX(saboteur!, ELEVATOR_A_X, { timeoutMs: 8000 });
    callElevator(staff1, "A");
    await waitForElevatorState(staff1, "A", "boarding", 6000);
    rideElevator(staff1, "A", 1);
    await new Promise<void>((r) => setTimeout(r, 80));
    rideElevator(saboteur!, "A", 1);
    await waitForPlayerFloor(staff1, staff1.sessionId!, 1, 6000);
    await waitForPlayerFloor(saboteur!, saboteurSessionId, 1, 6000);

    // 2. Both move into room 1-0 area
    await moveToX(staff1, 140, { timeoutMs: 8000 });
    await moveToX(saboteur!, 140, { timeoutMs: 8000 });

    // 3. Grace period check: staff1 accuses saboteur BEFORE any crime has occurred
    // Even though target is saboteur, crimeOccurred is false -> accusation is wrong -> staff1 is fired!
    sendAccusation(staff1, saboteurSessionId);
    await waitForPlayerFired(staff2, staff1.sessionId!, 6000);

    // 4. Saboteur preps room 1-0 and then unpreps it (first completed crime)
    startChannel(saboteur!, "prep", "1-0");
    await waitForRoomState(saboteur!, "1-0", "prepped", 8000);

    startChannel(saboteur!, "unprep", "1-0");
    await waitForRoomState(saboteur!, "1-0", "trashed", 8000);

    // 5. staff2 rides elevator A to floor 1
    await moveToX(staff2, ELEVATOR_A_X, { timeoutMs: 8000 });
    callElevator(staff2, "A");
    await waitForElevatorState(staff2, "A", "boarding", 6000);
    rideElevator(staff2, "A", 1);
    await waitForPlayerFloor(staff2, staff2.sessionId!, 1, 6000);

    // 6. staff2 moves near saboteur in room 1-0 and accuses saboteur
    await moveToX(staff2, 140, { timeoutMs: 8000 });
    sendAccusation(staff2, saboteurSessionId);

    // 7. Post-grace-period accusation against saboteur is correct -> saboteur is fired and staff wins
    await waitForPhase(clients, "results", 10000);

    for (const c of clients) {
      const state = (c.room as unknown as { state: { winner: string | null; phase: string } }).state;
      expect(state.phase).toBe("results");
      expect(state.winner).toBe("staff");

      const events = await waitForRecapEvents(c, 2, 5000);
      const accusations = events.filter((e) => e.type === "accusation");
      expect(accusations.length).toBe(2);

      // First accusation was pre-crime (wrong)
      const preCrimeAcc = accusations.find((e) => e.actorSessionId === staff1.sessionId);
      expect(preCrimeAcc).toBeDefined();
      expect(preCrimeAcc!.valid).toBe(false);
      expect(preCrimeAcc!.wasTargetSaboteur).toBe(true);
      expect(preCrimeAcc!.crimeOccurred).toBe(false);

      // Second accusation was post-crime (correct)
      const postCrimeAcc = accusations.find((e) => e.actorSessionId === staff2.sessionId);
      expect(postCrimeAcc).toBeDefined();
      expect(postCrimeAcc!.valid).toBe(true);
      expect(postCrimeAcc!.wasTargetSaboteur).toBe(true);
      expect(postCrimeAcc!.crimeOccurred).toBe(true);
    }
  }, 45000);
});
