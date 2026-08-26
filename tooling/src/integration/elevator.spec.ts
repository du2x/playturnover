import { describe, it, expect, afterEach } from "vitest";
import { ELEVATOR_A_X, ELEVATOR_ARRIVE_MS, ELEVATOR_CAPACITY, ELEVATOR_RIDE_MS } from "@grandhotel/shared";
import {
  createRoomAndJoin,
  startRound,
  waitForPhase,
  waitForElevatorState,
  waitForPlayerFloor,
  moveToX,
  getElevatorCar,
  getPlayerFloor,
  disconnect,
} from "../harness/helpers.js";
import type { HarnessClient } from "../harness/clients.js";

describe("m1 elevator deterministic (V-3)", () => {
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

  it("call -> 3s arrive -> boarding; 2s ride to dest; third rider queued", async () => {
    // V-3: shared constants are the single source for elevator tuning
    expect(ELEVATOR_ARRIVE_MS).toBe(3000);
    expect(ELEVATOR_RIDE_MS).toBe(2000);
    expect(ELEVATOR_CAPACITY).toBe(2);

    result = await createRoomAndJoin(4, ["A", "B", "C", "D"]);
    const [r1, r2, r3] = result.clients;
    await startRound(result.clients[0]!);
    await waitForPhase(result.clients, "playing", 5000);

    // all three riders on floor 0 within interact radius of shaft A
    for (const r of [r1!, r2!, r3!]) {
      await moveToX(r, ELEVATOR_A_X, { timeoutMs: 8000 });
    }
    expect(getPlayerFloor(r1!, r1!.sessionId!)).toBe(0);

    // call shaft A
    const callTime = Date.now();
    r1!.room!.send("callElevator", { shaft: "A" });
    await new Promise<void>((r) => setTimeout(r, 150));
    expect(getElevatorCar(r1!, "A")?.state).toBe("arriving");
    expect(getElevatorCar(r1!, "A")?.floor).toBe(0);

    // car not yet available at ~2.8s
    await new Promise<void>((r) => setTimeout(r, 2650));
    expect(getElevatorCar(r1!, "A")?.state).toBe("arriving");

    // car becomes boarding at ~3s (V-3: available at t+3000 ±50ms)
    await waitForElevatorState(r1!, "A", "boarding", 4000);
    const arrivalMs = Date.now() - callTime;
    expect(arrivalMs).toBeGreaterThanOrEqual(2900);
    expect(arrivalMs).toBeLessThanOrEqual(3400);

    // first two riders board to floor 1; third is queued (cap 2)
    r1!.room!.send("rideElevator", { shaft: "A", destFloor: 1 });
    await new Promise<void>((r) => setTimeout(r, 100));
    r2!.room!.send("rideElevator", { shaft: "A", destFloor: 1 });
    await new Promise<void>((r) => setTimeout(r, 100));
    r3!.room!.send("rideElevator", { shaft: "A", destFloor: 1 });
    await new Promise<void>((r) => setTimeout(r, 150));

    const queue = getElevatorCar(r1!, "A")?.queue ?? [];
    expect(queue).toContain(r3!.sessionId);
    expect(queue).not.toContain(r1!.sessionId);
    expect(queue).not.toContain(r2!.sessionId);

    // ride takes 2s: first two teleport to floor 1, third stays on floor 0
    await waitForPlayerFloor(r1!, r1!.sessionId!, 1, 5000);
    await waitForPlayerFloor(r2!, r2!.sessionId!, 1, 5000);
    expect(getPlayerFloor(r3!, r3!.sessionId!)).toBe(0);
  }, 25000);
});
