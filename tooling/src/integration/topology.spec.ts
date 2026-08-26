import { describe, it, expect, afterEach } from "vitest";
import {
  FLOOR_COUNT,
  HALLWAY_MAX_X,
  HALLWAY_MIN_X,
  ROOM_COUNT,
  ROOMS_PER_FLOOR,
  getRoomRect,
} from "@grandhotel/shared";
import { createRoomAndJoin, getRooms, disconnect } from "../harness/helpers.js";
import type { HarnessClient } from "../harness/clients.js";

describe("m1 building topology (V-1)", () => {
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

  it("server constructs ROOM_COUNT rooms: 3 floors x 8, each with floor/xMin/xMax", async () => {
    result = await createRoomAndJoin(1, ["Topo"]);
    const host = result.clients[0]!;

    // V-1: total count matches shared ROOM_COUNT (22–24 tolerance; plan fixes 24)
    const rooms = getRooms(host);
    expect(ROOM_COUNT).toBe(24);
    expect(rooms).toHaveLength(ROOM_COUNT);

    // V-1: 3 guest floors, 8 rooms each
    expect(FLOOR_COUNT).toBe(3);
    expect(ROOMS_PER_FLOOR).toEqual([8, 8, 8]);
    const perFloor = new Map<number, number>();
    for (const r of rooms) {
      perFloor.set(r.floor, (perFloor.get(r.floor) ?? 0) + 1);
    }
    for (let f = 1; f <= FLOOR_COUNT; f++) {
      expect(perFloor.get(f)).toBe(ROOMS_PER_FLOOR[f - 1]);
    }

    // V-1: every room carries floor + x-bounds and matches shared getRoomRect
    for (const r of rooms) {
      expect(r.floor).toBeGreaterThanOrEqual(1);
      expect(r.floor).toBeLessThanOrEqual(FLOOR_COUNT);
      expect(r.xMin).toBeGreaterThanOrEqual(HALLWAY_MIN_X);
      expect(r.xMax).toBeLessThanOrEqual(HALLWAY_MAX_X);
      expect(r.xMin).toBeLessThan(r.xMax);
      expect(r.state).toBe("clean");

      const rect = getRoomRect(r.id);
      expect(r.floor).toBe(rect.floor);
      expect(r.xMin).toBe(rect.xMin);
      expect(r.xMax).toBe(rect.xMax);
    }
  });
});
