import { describe, it, expect } from "vitest";
import {
  ELEVATOR_A_X,
  ELEVATOR_B_X,
  ELEVATOR_INTERACT_RADIUS,
  FLOOR_COUNT,
  FLOOR_Y_STEP,
  HALLWAY_MAX_X,
  HALLWAY_MIN_X,
  HALLWAY_Y,
  LOBBY_CENTER,
  ROOM_COUNT,
  ROOM_GAP,
  ROOM_WIDTH,
  ROOMS_PER_FLOOR,
} from "../src/constants.js";
import {
  getAllRoomIds,
  getElevatorX,
  getHallBounds,
  getRoomAt,
  getRoomRect,
  isInsideRoom,
  lobbyBounds,
} from "../src/topology.js";
import {
  COVERAGE_TARGET,
  ELEVATOR_ARRIVE_MS,
  ELEVATOR_CAPACITY,
  ELEVATOR_RIDE_MS,
  MAX_PLAYERS,
  PREP_TIME_MS,
  SHIFT_LENGTH_S,
  UNPREP_TIME_MS,
} from "../src/constants.js";

describe("topology", () => {
  it("lobby center is (480,120) = hallway midpoint", () => {
    expect(LOBBY_CENTER.x).toBe(480);
    expect(LOBBY_CENTER.y).toBe(120);
    expect(LOBBY_CENTER.x).toBe((HALLWAY_MIN_X + HALLWAY_MAX_X) / 2);
    expect(LOBBY_CENTER.y).toBe(HALLWAY_Y);
  });

  it("hall bounds per floor", () => {
    for (let floor = 0; floor <= FLOOR_COUNT; floor++) {
      const b = getHallBounds(floor);
      expect(b.minX).toBe(HALLWAY_MIN_X);
      expect(b.maxX).toBe(HALLWAY_MAX_X);
      expect(b.y).toBe(HALLWAY_Y + floor * FLOOR_Y_STEP);
    }
  });

  it("lobbyBounds equals floor 0 hall bounds", () => {
    expect(lobbyBounds).toEqual(getHallBounds(0));
    expect(lobbyBounds.minX).toBe(HALLWAY_MIN_X);
    expect(lobbyBounds.maxX).toBe(HALLWAY_MAX_X);
    expect(lobbyBounds.y).toBe(HALLWAY_Y);
  });

  it("room intervals are [96+i*96,96+i*96+88) per floor", () => {
    for (let floor = 1; floor <= 3; floor++) {
      for (let i = 0; i < 8; i++) {
        const roomId = `${floor}-${i}`;
        const r = getRoomRect(roomId);
        expect(r.floor).toBe(floor);
        expect(r.xMin).toBe(96 + i * 96);
        expect(r.xMax).toBe(96 + i * 96 + 88);
        expect(r.y).toBe(HALLWAY_Y + floor * FLOOR_Y_STEP);
        expect(r.xMax - r.xMin).toBe(ROOM_WIDTH);
      }
    }
  });

  it("rooms are non-overlapping and partition hall with gaps", () => {
    for (let floor = 1; floor <= 3; floor++) {
      const rects = Array.from({ length: 8 }, (_, i) => getRoomRect(`${floor}-${i}`));
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]!;
          const b = rects[j]!;
          // no overlap: a.xMax <= b.xMin or vice versa (with gap 8)
          expect(a.xMax <= b.xMin || b.xMax <= a.xMin).toBe(true);
        }
        // each rect inside hallway
        expect(rects[i]!.xMin).toBeGreaterThanOrEqual(HALLWAY_MIN_X);
        expect(rects[i]!.xMax).toBeLessThanOrEqual(HALLWAY_MAX_X);
      }
      // gap between consecutive rooms is ROOM_GAP
      for (let i = 0; i < 7; i++) {
        const a = getRoomRect(`${floor}-${i}`);
        const b = getRoomRect(`${floor}-${i + 1}`);
        expect(b.xMin - a.xMax).toBe(ROOM_GAP);
      }
    }
  });

  it("getRoomAt returns correct roomId or null", () => {
    // inside each room
    for (let floor = 1; floor <= 3; floor++) {
      for (let i = 0; i < 8; i++) {
        const xMin = 96 + i * 96;
        const xInside = xMin + 10;
        expect(getRoomAt(xInside, floor)).toBe(`${floor}-${i}`);
        // at xMax (exclusive) should be gap -> null or next room? exclusive so null for gap
        expect(getRoomAt(xMin + 88, floor)).toBeNull(); // gap start
        expect(getRoomAt(xMin + 88 + 4, floor)).toBeNull(); // middle of gap
      }
    }
    // lobby floor 0 always null
    expect(getRoomAt(LOBBY_CENTER.x, 0)).toBeNull();
    expect(getRoomAt(200, 0)).toBeNull();
    // hallway gap outside rooms
    expect(getRoomAt(96 + 88 + 2, 1)).toBeNull();
    // outside hallway
    expect(getRoomAt(HALLWAY_MIN_X - 10, 1)).toBeNull();
    expect(getRoomAt(HALLWAY_MAX_X + 10, 1)).toBeNull();
  });

  it("isInsideRoom is floor-aware and interval-correct", () => {
    // player on floor 0 not inside any floor-1 room
    const roomId = "1-0";
    const rect = getRoomRect(roomId);
    const xInside = rect.xMin + 5;
    expect(isInsideRoom(xInside, 0, roomId)).toBe(false);
    expect(isInsideRoom(xInside, 1, roomId)).toBe(true);
    expect(isInsideRoom(xInside, 2, roomId)).toBe(false); // wrong floor
    // wrong room
    expect(isInsideRoom(xInside, 1, "1-1")).toBe(false);
    // edge exclusive
    expect(isInsideRoom(rect.xMax, 1, roomId)).toBe(false);
    expect(isInsideRoom(rect.xMin, 1, roomId)).toBe(true);
  });

  it("getAllRoomIds returns 24 ids covering 8 per floor", () => {
    const ids = getAllRoomIds();
    expect(ids.length).toBe(ROOM_COUNT);
    expect(ids.length).toBe(24);
    const perFloor: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    for (const id of ids) {
      const r = getRoomRect(id);
      perFloor[r.floor] = (perFloor[r.floor] ?? 0) + 1;
    }
    expect(perFloor[1]).toBe(8);
    expect(perFloor[2]).toBe(8);
    expect(perFloor[3]).toBe(8);
  });

  it("elevator X constants match topology helper", () => {
    expect(getElevatorX("A")).toBe(ELEVATOR_A_X);
    expect(getElevatorX("B")).toBe(ELEVATOR_B_X);
    expect(ELEVATOR_A_X).toBe(HALLWAY_MIN_X + 22);
    expect(ELEVATOR_B_X).toBe(HALLWAY_MAX_X - 22);
    expect(ELEVATOR_INTERACT_RADIUS).toBe(18);
  });

  it("total ROOM_COUNT equals sum of ROOMS_PER_FLOOR and matches getAllRoomIds", () => {
    const sum = ROOMS_PER_FLOOR.reduce((a, b) => a + b, 0);
    expect(sum).toBe(ROOM_COUNT);
    expect(sum).toBe(24);
    expect(getAllRoomIds().length).toBe(sum);
  });
});

describe("tuning constants (M1)", () => {
  it("M1 constants equal plan values", () => {
    expect(FLOOR_COUNT).toBe(3);
    expect(ROOMS_PER_FLOOR).toEqual([8, 8, 8]);
    expect(ROOM_COUNT).toBe(24);
    expect(FLOOR_Y_STEP).toBe(90);
    expect(LOBBY_CENTER).toEqual({ x: 480, y: 120 });
    expect(ROOM_WIDTH).toBe(88);
    expect(ROOM_GAP).toBe(8);
    expect(ELEVATOR_A_X).toBe(118);
    expect(ELEVATOR_B_X).toBe(842);
    expect(ELEVATOR_INTERACT_RADIUS).toBe(18);
  });

  it("PRD §7 tuning constants remain single source", () => {
    expect(MAX_PLAYERS).toBe(6);
    expect(SHIFT_LENGTH_S).toBe(300);
    expect(PREP_TIME_MS).toBe(5000);
    expect(UNPREP_TIME_MS).toBe(3000);
    expect(COVERAGE_TARGET).toBe(0.8);
    expect(ELEVATOR_ARRIVE_MS).toBe(3000);
    expect(ELEVATOR_RIDE_MS).toBe(2000);
    expect(ELEVATOR_CAPACITY).toBe(2);
  });
});
