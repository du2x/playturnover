import { describe, it, expect } from "vitest";
import { ROOM_COUNT, FLOOR_COUNT, ROOMS_PER_FLOOR, LOBBY_CENTER } from "@grandhotel/shared";
import { getAllRoomIds, getRoomRect, isInsideRoom } from "@grandhotel/shared";
import { HotelRoom } from "../src/rooms/HotelRoom.js";

function mockClient(sessionId: string, sendImpl?: (type: string, data: unknown) => void): any {
  const c: any = { sessionId };
  c.send = sendImpl ?? (() => {});
  return c as unknown as import("colyseus").Client;
}

describe("building topology", () => {
  it("server constructs building with ROOM_COUNT rooms via shared getRoomRect", async () => {
    const room = new HotelRoom();
    await room.onCreate({});
    expect(room.state.rooms.size).toBe(ROOM_COUNT);
    expect(ROOM_COUNT).toBe(24);
    // each floor has 8
    for (let floor = 1; floor <= FLOOR_COUNT; floor++) {
      let count = 0;
      for (const rd of room.state.rooms.values()) {
        if (rd.floor === floor) count++;
      }
      expect(count).toBe(ROOMS_PER_FLOOR[floor - 1]);
      expect(count).toBe(8);
    }
    // every room id matches getRoomRect deterministically
    const ids = getAllRoomIds();
    expect(ids).toHaveLength(ROOM_COUNT);
    for (const id of ids) {
      const rd = room.state.rooms.get(id);
      expect(rd).toBeDefined();
      const rect = getRoomRect(id);
      expect(rd!.floor).toBe(rect.floor);
      expect(rd!.xMin).toBe(rect.xMin);
      expect(rd!.xMax).toBe(rect.xMax);
      expect(rd!.state).toBe("clean");
    }
    // lobby gather spawn on join
    const c = mockClient("p1");
    await room.onJoin(c, { name: "Alice" });
    const p = room.state.players.get("p1");
    expect(p).toBeDefined();
    expect(p!.floor).toBe(0);
    expect(p!.x).toBe(LOBBY_CENTER.x);
  });

  it("elevators init idle at floor 0 stub", async () => {
    const room = new HotelRoom();
    await room.onCreate({});
    expect(room.state.elevators.size).toBe(2);
    const a = room.state.elevators.get("A");
    const b = room.state.elevators.get("B");
    expect(a?.shaft).toBe("A");
    expect(b?.shaft).toBe("B");
    expect(a?.floor).toBe(0);
    expect(b?.floor).toBe(0);
    expect(a?.state).toBe("idle");
    expect(b?.state).toBe("idle");
  });

  it("player on floor 0 not inside floor-1 room via isInsideRoom", async () => {
    const room = new HotelRoom();
    await room.onCreate({});
    const c = mockClient("p1");
    await room.onJoin(c, { name: "Alice" });
    const p = room.state.players.get("p1")!;
    expect(p.floor).toBe(0);
    // pick a floor-1 room
    const floor1Rooms = [...room.state.rooms.values()].filter((r) => r.floor === 1);
    expect(floor1Rooms.length).toBe(8);
    for (const r of floor1Rooms) {
      expect(isInsideRoom(p.x, p.floor, r.id)).toBe(false);
      // same x but on correct floor would be inside for first room
    }
    const firstFloor1 = floor1Rooms[0]!;
    // same x range but on floor 1 should be inside
    const centerX = (firstFloor1.xMin + firstFloor1.xMax) / 2;
    // simulate player moved to that floor via elevator (direct set for test)
    p.x = centerX;
    p.floor = 1;
    expect(isInsideRoom(p.x, p.floor, firstFloor1.id)).toBe(true);
    // floor 0 again not inside
    p.floor = 0;
    expect(isInsideRoom(p.x, p.floor, firstFloor1.id)).toBe(false);
  });
});
