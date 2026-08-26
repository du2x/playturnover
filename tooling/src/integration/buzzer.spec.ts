import { describe, it, expect, afterEach } from "vitest";
import { matchMaker } from "colyseus";
import { COVERAGE_TARGET, ROOM_COUNT } from "@grandhotel/shared";
import type { RoomState } from "@grandhotel/shared";
import {
  createRoomAndJoin,
  startRound,
  waitForPhase,
  getRooms,
  disconnect,
} from "../harness/helpers.js";
import type { HarnessClient } from "../harness/clients.js";

/**
 * V-11: accelerated-clock buzzer coverage win over real colyseus.js clients.
 * Rooms are pre-prepared directly on the authoritative schema (same technique
 * as the server unit suite) instead of running 20 real prep channels, which
 * would exceed the shortened shift; the client still observes every seeded
 * state through the normal patch stream and the winner comes from the real
 * buzzer computation at shift end.
 */
describe("m1 buzzer coverage win (V-11)", () => {
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

  function seedPrepped(roomId: string, count: number): void {
    const room = matchMaker.getRoomById(roomId);
    expect(room).toBeTruthy();
    const state = (room as unknown as { state: RoomState }).state;
    let left = count;
    const ids: string[] = [];
    state.rooms.forEach((_rd, id) => ids.push(id));
    for (const id of ids) {
      if (left <= 0) break;
      state.rooms.get(id)!.state = "prepped";
      left--;
    }
  }

  it("staff wins when >=80% of rooms are prepped at the buzzer (20/24)", async () => {
    result = await createRoomAndJoin(4, ["A", "B", "C", "D"], { shiftLengthSOverride: 8 });
    await startRound(result.clients[0]!);
    await waitForPhase(result.clients, "playing", 5000);

    seedPrepped(result.roomId, 20);

    // real clients observe the seeded prepped rooms through the patch stream
    await new Promise<void>((r) => setTimeout(r, 500));
    const observed = getRooms(result.clients[0]!).filter((r) => r.state === "prepped");
    expect(observed).toHaveLength(20);

    // buzzer fires at shift end (8s) -> staff win, coverage = 20/24
    await waitForPhase(result.clients, "results", 15000);
    const state = (result.clients[0]!.room as unknown as { state: { winner: string | null; coverage: number } }).state;
    expect(state.winner).toBe("staff");
    expect(state.coverage).toBeCloseTo(20 / ROOM_COUNT, 6);
    expect(state.coverage).toBeGreaterThanOrEqual(COVERAGE_TARGET);
  }, 30000);

  it("saboteur wins when coverage < 80% at the buzzer (12/24)", async () => {
    result = await createRoomAndJoin(4, ["A", "B", "C", "D"], { shiftLengthSOverride: 8 });
    await startRound(result.clients[0]!);
    await waitForPhase(result.clients, "playing", 5000);

    seedPrepped(result.roomId, 12);

    // mid-shift winner stays null while the round is still running
    await new Promise<void>((r) => setTimeout(r, 1500));
    const mid = result.clients[0]!.room as unknown as { state: { winner: string | null | undefined; phase: string } };
    expect(mid.state.phase).toBe("playing");
    // null string fields decode as undefined until set; both mean "no winner"
    expect(mid.state.winner ?? null).toBeNull();

    await waitForPhase(result.clients, "results", 15000);
    const state = (result.clients[0]!.room as unknown as { state: { winner: string | null; coverage: number } }).state;
    expect(state.winner).toBe("saboteur");
    expect(state.coverage).toBeCloseTo(12 / ROOM_COUNT, 6);
    expect(state.coverage).toBeLessThan(COVERAGE_TARGET);
  }, 30000);
});
