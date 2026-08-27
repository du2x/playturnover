import { describe, it, expect, afterEach } from "vitest";
import { ELEVATOR_A_X, ACCUSATION_RANGE_TILES, TILE_SIZE_PX } from "@grandhotel/shared";
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
  getRecapEvents,
  waitForRecapEvents,
  waitForPlayerFired,
  disconnect,
} from "../harness/helpers.js";
import type { HarnessClient } from "../harness/clients.js";

describe("m3 recap timeline projection", () => {
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

  it("m3 recap payload: real clients receive ordered recap events with valid fields after round completion", async () => {
    result = await createRoomAndJoin(4, ["Alice", "Bob", "Charlie", "Dana"], {
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

    // 1. staff1 calls elevator A on floor 0 and rides to floor 1
    await moveToX(staff1, ELEVATOR_A_X, { timeoutMs: 8000 });
    callElevator(staff1, "A");
    await waitForElevatorState(staff1, "A", "boarding", 6000);
    rideElevator(staff1, "A", 1);
    await waitForPlayerFloor(staff1, staff1.sessionId!, 1, 6000);

    // 2. staff1 preps room 1-0
    await moveToX(staff1, 140, { timeoutMs: 8000 });
    startChannel(staff1, "prep", "1-0");
    await waitForRoomState(staff1, "1-0", "prepped", 8000);

    // 3. saboteur calls elevator A on floor 0 and rides to floor 1
    await moveToX(saboteur!, ELEVATOR_A_X, { timeoutMs: 8000 });
    callElevator(saboteur!, "A");
    await waitForElevatorState(saboteur!, "A", "boarding", 6000);
    rideElevator(saboteur!, "A", 1);
    await waitForPlayerFloor(saboteur!, saboteurSessionId, 1, 6000);

    // 4. saboteur sabotages room 1-0 (unpreps it)
    await moveToX(saboteur!, 140, { timeoutMs: 8000 });
    startChannel(saboteur!, "unprep", "1-0");
    await waitForRoomState(saboteur!, "1-0", "trashed", 8000);

    // 5. staff2 calls elevator A and rides to floor 1
    await moveToX(staff2, ELEVATOR_A_X, { timeoutMs: 8000 });
    callElevator(staff2, "A");
    await waitForElevatorState(staff2, "A", "boarding", 6000);
    rideElevator(staff2, "A", 1);
    await waitForPlayerFloor(staff2, staff2.sessionId!, 1, 6000);

    // 6. staff2 moves near saboteur in room 1-0 and makes a correct accusation
    await moveToX(staff2, 140, { timeoutMs: 8000 });
    sendAccusation(staff2, saboteurSessionId);

    // 7. Accusation is correct (target is saboteur and crime occurred) -> saboteur is fired and staff wins
    await waitForPhase(clients, "results", 10000);

    for (const c of clients) {
      const state = (c.room as unknown as { state: { winner: string | null; phase: string } }).state;
      expect(state.phase).toBe("results");
      expect(state.winner).toBe("staff");

      const events = await waitForRecapEvents(c, 5, 5000);
      expect(events.length).toBeGreaterThanOrEqual(5);

      // Verify chronological ordering
      for (let i = 1; i < events.length; i++) {
        expect(events[i]!.timestamp).toBeGreaterThanOrEqual(events[i - 1]!.timestamp);
      }

      // Verify specific event structures
      const prepEvents = events.filter((e) => e.type === "prep");
      expect(prepEvents.length).toBeGreaterThanOrEqual(1);
      const prep = prepEvents[0]!;
      expect(prep.actorSessionId).toBe(staff1.sessionId);
      expect(prep.roomId).toBe("1-0");
      expect(prep.valid).toBe(true);
      expect(prep.wasTargetSaboteur).toBe(false);
      expect(prep.crimeOccurred).toBe(false);

      const sabotageEvents = events.filter((e) => e.type === "sabotage");
      expect(sabotageEvents.length).toBeGreaterThanOrEqual(1);
      const sabotage = sabotageEvents[0]!;
      expect(sabotage.actorSessionId).toBe(saboteurSessionId);
      expect(sabotage.roomId).toBe("1-0");
      expect(sabotage.valid).toBe(true);
      expect(sabotage.wasTargetSaboteur).toBe(true);
      expect(sabotage.crimeOccurred).toBe(true);

      const accusationEvents = events.filter((e) => e.type === "accusation");
      expect(accusationEvents.length).toBeGreaterThanOrEqual(1);
      const accusation = accusationEvents[0]!;
      expect(accusation.actorSessionId).toBe(staff2.sessionId);
      expect(accusation.targetSessionId).toBe(saboteurSessionId);
      expect(accusation.valid).toBe(true);
      expect(accusation.wasTargetSaboteur).toBe(true);
      expect(accusation.crimeOccurred).toBe(true);

      const callEvents = events.filter((e) => e.type === "call");
      expect(callEvents.length).toBeGreaterThanOrEqual(1);
      for (const call of callEvents) {
        expect(call.shaft).toBe("A");
        expect(call.valid).toBe(true);
      }

      const rideEvents = events.filter((e) => e.type === "ride");
      expect(rideEvents.length).toBeGreaterThanOrEqual(1);
      for (const ride of rideEvents) {
        expect(ride.shaft).toBe("A");
        expect(ride.valid).toBe(true);
      }
    }
  }, 40000);

  it("m3 recap: wrong accusation and walk-in catch emit correct recap records", async () => {
    result = await createRoomAndJoin(4, ["P1", "P2", "P3", "P4"], {
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
    const staff3 = staffMembers[2]!;

    // 1. staff1 and staff2 ride elevator A to floor 1
    await moveToX(staff1, ELEVATOR_A_X, { timeoutMs: 8000 });
    await moveToX(staff2, ELEVATOR_A_X, { timeoutMs: 8000 });
    callElevator(staff1, "A");
    await waitForElevatorState(staff1, "A", "boarding", 6000);
    rideElevator(staff1, "A", 1);
    await new Promise<void>((r) => setTimeout(r, 80));
    rideElevator(staff2, "A", 1);
    await waitForPlayerFloor(staff1, staff1.sessionId!, 1, 6000);
    await waitForPlayerFloor(staff2, staff2.sessionId!, 1, 6000);

    // 2. staff1 wrongly accuses staff2 on floor 1 -> staff1 is fired
    await moveToX(staff1, 140, { timeoutMs: 8000 });
    await moveToX(staff2, 140, { timeoutMs: 8000 });
    sendAccusation(staff1, staff2.sessionId!);
    await waitForPlayerFired(staff2, staff1.sessionId!, 6000);

    // 3. Saboteur rides elevator A to floor 1, preps room 1-1 first then starts un-prep
    await moveToX(saboteur!, ELEVATOR_A_X, { timeoutMs: 8000 });
    callElevator(saboteur!, "A");
    await waitForElevatorState(saboteur!, "A", "boarding", 6000);
    rideElevator(saboteur!, "A", 1);
    await waitForPlayerFloor(saboteur!, saboteur!.sessionId!, 1, 6000);

    await moveToX(saboteur!, 236, { timeoutMs: 8000 }); // room 1-1 center
    // Saboteur preps room 1-1 so it can be un-prepped
    startChannel(saboteur!, "prep", "1-1");
    await waitForRoomState(saboteur!, "1-1", "prepped", 8000);

    // 4. Saboteur starts un-prep in room 1-1
    startChannel(saboteur!, "unprep", "1-1");
    await new Promise<void>((r) => setTimeout(r, 400));

    // 5. staff2 walks into room 1-1 while saboteur is actively un-prepping -> triggers walk-in catch!
    await moveToX(staff2, 236, { timeoutMs: 8000 });

    // Round should immediately end in staff victory due to walk-in catch
    await waitForPhase(clients, "results", 10000);

    const client0 = clients[0]!;
    const events = await waitForRecapEvents(client0, 3, 5000);

    // Chronological order check
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.timestamp).toBeGreaterThanOrEqual(events[i - 1]!.timestamp);
    }

    // Wrong accusation event check
    const wrongAccusations = events.filter(
      (e) => e.type === "accusation" && e.actorSessionId === staff1.sessionId,
    );
    expect(wrongAccusations.length).toBe(1);
    expect(wrongAccusations[0]!.targetSessionId).toBe(staff2.sessionId);
    expect(wrongAccusations[0]!.valid).toBe(false);
    expect(wrongAccusations[0]!.wasTargetSaboteur).toBe(false);
    expect(wrongAccusations[0]!.crimeOccurred).toBe(false);

    // Walk-in catch event check
    const catchEvents = events.filter((e) => e.type === "catch");
    expect(catchEvents.length).toBe(1);
    expect(catchEvents[0]!.actorSessionId).toBe(staff2.sessionId);
    expect(catchEvents[0]!.targetSessionId).toBe(saboteur!.sessionId);
    expect(catchEvents[0]!.roomId).toBe("1-1");
    expect(catchEvents[0]!.valid).toBe(true);
    expect(catchEvents[0]!.wasTargetSaboteur).toBe(true);
    expect(catchEvents[0]!.crimeOccurred).toBe(true);
  }, 40000);
});
