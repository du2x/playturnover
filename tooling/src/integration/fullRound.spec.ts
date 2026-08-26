import { describe, it, expect, afterEach } from "vitest";
import { ELEVATOR_A_X } from "@grandhotel/shared";
import {
  createRoomAndJoin,
  startRound,
  waitForPhase,
  collectRoles,
  waitForElevatorState,
  waitForPlayerFloor,
  waitForRoomState,
  moveToX,
  startChannel,
  disconnect,
} from "../harness/helpers.js";
import type { HarnessClient } from "../harness/clients.js";

/**
 * V-13 exit-criterion micro-round: 4 real clients complete
 * waiting -> playing -> (prep + saboteur unprep) -> buzzer -> results,
 * then assert the results v1 payload (winner + traitor reveal) matches the
 * role assignment and no FR-22 recap timeline fields are present.
 */
describe("m1 full round loop (V-13)", () => {
  let result: { clients: HarnessClient[]; roomId: string; url: string; close: () => Promise<void> } | null = null;

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

  it("4 clients start, staff preps one room, saboteur unpreps it, buzzer -> results v1 reveal", async () => {
    // shift 20s: 5s prep + 3s unprep + elevator rides must complete before the buzzer
    result = await createRoomAndJoin(4, ["A", "B", "C", "D"], { shiftLengthSOverride: 20 });
    const clients = result.clients;

    const rolesPromise = collectRoles(clients);
    await startRound(clients[0]!);
    await waitForPhase(clients, "playing", 5000);
    const roles = await rolesPromise;

    const saboteur = clients.find((c) => roles.get(c.sessionId!) === "saboteur");
    const staff = clients.find((c) => roles.get(c.sessionId!) === "staff");
    expect(saboteur).toBeDefined();
    expect(staff).toBeDefined();
    const saboteurSessionId = saboteur!.sessionId!;

    // staff + saboteur ride elevator A to floor 1 (drop inside room 1-0)
    await moveToX(staff!, ELEVATOR_A_X, { timeoutMs: 8000 });
    await moveToX(saboteur!, ELEVATOR_A_X, { timeoutMs: 8000 });
    staff!.room!.send("callElevator", { shaft: "A" });
    await waitForElevatorState(staff!, "A", "boarding", 6000);
    staff!.room!.send("rideElevator", { shaft: "A", destFloor: 1 });
    await new Promise<void>((r) => setTimeout(r, 100));
    saboteur!.room!.send("rideElevator", { shaft: "A", destFloor: 1 });
    await waitForPlayerFloor(staff!, staff!.sessionId!, 1, 6000);
    await waitForPlayerFloor(saboteur!, saboteur!.sessionId!, 1, 6000);

    // staff preps room 1-0 while the saboteur waits in the same-floor hallway
    await moveToX(staff!, 150, { timeoutMs: 8000 });
    await moveToX(saboteur!, 188, { timeoutMs: 8000 });
    startChannel(staff!, "prep", "1-0");
    await waitForRoomState(staff!, "1-0", "prepped", 8000);

    // saboteur unpreps the prepped room (prepped -> trashed)
    await moveToX(saboteur!, 150, { timeoutMs: 8000 });
    startChannel(saboteur!, "unprep", "1-0");
    await waitForRoomState(saboteur!, "1-0", "trashed", 8000);

    // buzzer fires at shift end; coverage 0/24 -> saboteur win
    await waitForPhase(clients, "results", 20000);
    const state = (clients[0]!.room as unknown as {
      state: {
        winner: string | null;
        phase: string;
        traitorReveal: { sessionId: string; name: string } | null;
        events?: unknown;
      };
    }).state;

    expect(state.phase).toBe("results");
    expect(state.winner).toBe("saboteur");

    // V-13: traitor reveal matches the earlier secret assignment
    expect(state.traitorReveal).toBeTruthy();
    expect(state.traitorReveal?.sessionId).toBe(saboteurSessionId);
    expect(state.traitorReveal?.name).toBe(saboteur!.name);

    // V-13: FR-22 recap timeline fields are absent from the results payload
    expect(state.events).toBeUndefined();
  }, 35000);
});
