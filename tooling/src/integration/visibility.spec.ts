import { describe, it, expect, afterEach } from "vitest";
import { ELEVATOR_A_X, isInsideRoom } from "@grandhotel/shared";
import type { RoomStateType } from "@grandhotel/shared";
import {
  createRoomAndJoin,
  startRound,
  waitForPhase,
  waitForElevatorState,
  waitForPlayerFloor,
  moveToX,
  getRooms,
  getPlayerState,
  disconnect,
} from "../harness/helpers.js";
import type { HarnessClient } from "../harness/clients.js";

describe("m1 room observability (V-10)", () => {
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

  /**
   * Per-client room projection mirroring the spec rule (R-10): interior state
   * is observable only while the player is physically inside the room.
   */
  function roomsViewFor(c: HarnessClient, sessionId: string): Record<string, RoomStateType | null> {
    const p = getPlayerState(c, sessionId);
    const view: Record<string, RoomStateType | null> = {};
    if (!p) return view;
    for (const r of getRooms(c)) {
      view[r.id] = isInsideRoom(p.x, p.floor, r.id) ? (r.state as RoomStateType) : null;
    }
    return view;
  }

  it("client A inside room R sees its state; B in same-floor hallway sees null; entering R reveals it", async () => {
    result = await createRoomAndJoin(4, ["A", "B", "C", "D"]);
    const [a, b] = result.clients;
    await startRound(result.clients[0]!);
    await waitForPhase(result.clients, "playing", 5000);

    // A and B ride elevator A together to floor 1 (both drop inside room 1-0)
    await moveToX(a!, ELEVATOR_A_X, { timeoutMs: 8000 });
    await moveToX(b!, ELEVATOR_A_X, { timeoutMs: 8000 });
    a!.room!.send("callElevator", { shaft: "A" });
    await waitForElevatorState(a!, "A", "boarding", 6000);
    a!.room!.send("rideElevator", { shaft: "A", destFloor: 1 });
    await new Promise<void>((r) => setTimeout(r, 100));
    b!.room!.send("rideElevator", { shaft: "A", destFloor: 1 });
    await waitForPlayerFloor(a!, a!.sessionId!, 1, 6000);
    await waitForPlayerFloor(b!, b!.sessionId!, 1, 6000);

    // A stays inside room 1-0 (elevator A drop-off x is within [96,184));
    // B steps into the hallway gap between rooms 1-0 and 1-1
    await moveToX(b!, 188, { timeoutMs: 8000 });
    const gapFloor = getPlayerState(b!, b!.sessionId!)?.floor;
    expect(gapFloor).toBe(1);
    expect(isInsideRoom(188, 1, "1-0")).toBe(false);

    const viewA = roomsViewFor(a!, a!.sessionId!);
    const viewB = roomsViewFor(b!, b!.sessionId!);
    // A sees the state of the room it is inside; B (same floor hallway) sees null
    expect(viewA["1-0"]).toBe("clean");
    expect(viewA["1-1"]).toBeNull();
    expect(viewB["1-0"]).toBeNull();

    // B walks into room 1-0 -> now the room state is visible to B
    await moveToX(b!, 150, { timeoutMs: 8000 });
    expect(isInsideRoom(150, 1, "1-0")).toBe(true);
    const viewB2 = roomsViewFor(b!, b!.sessionId!);
    expect(viewB2["1-0"]).toBe("clean");
  }, 30000);
});
