import { describe, it, expect } from "vitest";
import {
  FLOOR_COUNT,
  FLOOR_Y_STEP,
  HALLWAY_MIN_X,
  HALLWAY_MAX_X,
  HALLWAY_Y,
  LOBBY_CENTER,
  ROOM_WIDTH,
  ROOM_GAP,
} from "@grandhotel/shared";
import { getAllRoomIds, getHallBounds, getRoomRect, isInsideRoom } from "@grandhotel/shared";

describe("HallScene topology (M1)", () => {
  it("lobby spawn position equals LOBBY_CENTER", () => {
    expect(LOBBY_CENTER.x).toBe((HALLWAY_MIN_X + HALLWAY_MAX_X) / 2);
    expect(LOBBY_CENTER.y).toBe(HALLWAY_Y);
  });

  it("hallway bounds exist for all floors (lobby 0 + 3 guest floors)", () => {
    for (let floor = 0; floor <= FLOOR_COUNT; floor++) {
      const bounds = getHallBounds(floor);
      expect(bounds.minX).toBe(HALLWAY_MIN_X);
      expect(bounds.maxX).toBe(HALLWAY_MAX_X);
      expect(bounds.y).toBe(HALLWAY_Y + floor * FLOOR_Y_STEP);
    }
  });

  it("room rects are non-overlapping on each guest floor", () => {
    for (let floor = 1; floor <= FLOOR_COUNT; floor++) {
      const perFloor = 8; // ROOMS_PER_FLOOR[floor - 1]
      const rects = [];
      for (let idx = 0; idx < perFloor; idx++) {
        const roomId = `${floor}-${idx}`;
        const rect = getRoomRect(roomId);
        expect(rect.floor).toBe(floor);
        expect(rect.xMax - rect.xMin).toBe(ROOM_WIDTH);
        rects.push(rect);
      }
      // Check non-overlapping: each room's xMax <= next room's xMin
      for (let i = 0; i < rects.length - 1; i++) {
        expect(rects[i].xMax).toBeLessThanOrEqual(rects[i + 1].xMin);
      }
      // Check gaps between rooms are ROOM_GAP
      for (let i = 0; i < rects.length - 1; i++) {
        expect(rects[i + 1].xMin - rects[i].xMax).toBe(ROOM_GAP);
      }
      // First room starts at HALLWAY_MIN_X
      expect(rects[0].xMin).toBe(HALLWAY_MIN_X);
      // Last room ends before HALLWAY_MAX_X
      expect(rects[rects.length - 1].xMax).toBeLessThanOrEqual(HALLWAY_MAX_X);
    }
  });

  it("room rects partition hallway deterministically per floor", () => {
    for (let floor = 1; floor <= FLOOR_COUNT; floor++) {
      for (let idx = 0; idx < 8; idx++) {
        const roomId = `${floor}-${idx}`;
        const rect = getRoomRect(roomId);
        const expectedXMin = HALLWAY_MIN_X + idx * (ROOM_WIDTH + ROOM_GAP);
        const expectedXMax = expectedXMin + ROOM_WIDTH;
        expect(rect.xMin).toBe(expectedXMin);
        expect(rect.xMax).toBe(expectedXMax);
        expect(rect.y).toBe(HALLWAY_Y + floor * FLOOR_Y_STEP);
      }
    }
  });

  it("isInsideRoom returns true only when x is within room bounds on correct floor", () => {
    const roomId = "1-0";
    const rect = getRoomRect(roomId);
    // Inside room on correct floor
    expect(isInsideRoom(rect.xMin, 1, roomId)).toBe(true);
    expect(isInsideRoom(rect.xMax - 1, 1, roomId)).toBe(true);
    expect(isInsideRoom((rect.xMin + rect.xMax) / 2, 1, roomId)).toBe(true);
    // Outside room on correct floor
    expect(isInsideRoom(rect.xMin - 1, 1, roomId)).toBe(false);
    expect(isInsideRoom(rect.xMax, 1, roomId)).toBe(false);
    // Wrong floor
    expect(isInsideRoom((rect.xMin + rect.xMax) / 2, 2, roomId)).toBe(false);
    expect(isInsideRoom((rect.xMin + rect.xMax) / 2, 0, roomId)).toBe(false);
    // Lobby floor always returns false for any room
    expect(isInsideRoom(500, 0, roomId)).toBe(false);
  });

  it("getAllRoomIds returns 24 rooms in deterministic order", () => {
    const ids = getAllRoomIds();
    expect(ids.length).toBe(24);
    // Floor-major order
    expect(ids[0]).toBe("1-0");
    expect(ids[7]).toBe("1-7");
    expect(ids[8]).toBe("2-0");
    expect(ids[15]).toBe("2-7");
    expect(ids[16]).toBe("3-0");
    expect(ids[23]).toBe("3-7");
  });
});