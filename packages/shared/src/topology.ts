import {
  ELEVATOR_A_X,
  ELEVATOR_B_X,
  FLOOR_COUNT,
  FLOOR_Y_STEP,
  HALLWAY_MAX_X,
  HALLWAY_MIN_X,
  HALLWAY_Y,
  ROOM_GAP,
  ROOM_WIDTH,
  ROOMS_PER_FLOOR,
} from "./constants.js";

/**
 * Hallway bounds for a logical floor.
 * Floor 0 is lobby, 1-3 are guest floors.
 */
export interface HallBounds {
  minX: number;
  maxX: number;
  y: number;
}

/**
 * Axis-aligned room rectangle.
 */
export interface RoomRect {
  floor: number;
  xMin: number;
  xMax: number;
  y: number;
}

/**
 * M1 free variable, see plan — lobby bounds (floor 0 hallway).
 */
export const lobbyBounds: HallBounds = {
  minX: HALLWAY_MIN_X,
  maxX: HALLWAY_MAX_X,
  y: HALLWAY_Y,
};

/**
 * Returns hallway bounds for the given floor.
 * Pure helper — deterministic, no side effects.
 */
export function getHallBounds(floor: number): HallBounds {
  return {
    minX: HALLWAY_MIN_X,
    maxX: HALLWAY_MAX_X,
    y: HALLWAY_Y + floor * FLOOR_Y_STEP,
  };
}

/**
 * Parse roomId of form "floor-index" e.g. "1-0" .. "3-7".
 * Returns floor and index or null if malformed.
 */
function parseRoomId(roomId: string): { floor: number; idx: number } | null {
  const sep = roomId.includes("-") ? "-" : roomId.includes("_") ? "_" : null;
  if (!sep) return null;
  const parts = roomId.split(sep);
  if (parts.length !== 2) return null;
  const floor = Number(parts[0]);
  const idx = Number(parts[1]);
  if (!Number.isInteger(floor) || !Number.isInteger(idx)) return null;
  if (floor < 1 || floor > FLOOR_COUNT) return null;
  const perFloor = ROOMS_PER_FLOOR[floor - 1] ?? 8;
  if (idx < 0 || idx >= perFloor) return null;
  return { floor, idx };
}

/**
 * Returns the axis-aligned rect for a given roomId.
 * Room x-ranges are deterministic intervals [96+i*96, 96+i*96+88) per floor.
 */
export function getRoomRect(roomId: string): RoomRect {
  const parsed = parseRoomId(roomId);
  if (!parsed) {
    throw new Error(`invalid roomId: ${roomId}`);
  }
  const { floor, idx } = parsed;
  const xMin = HALLWAY_MIN_X + idx * (ROOM_WIDTH + ROOM_GAP);
  const xMax = xMin + ROOM_WIDTH;
  const y = HALLWAY_Y + floor * FLOOR_Y_STEP;
  return { floor, xMin, xMax, y };
}

/**
 * Returns the roomId containing x on the given floor, or null if none.
 * Checks deterministic intervals; gaps between rooms return null.
 * Lobby floor (0) always returns null.
 */
export function getRoomAt(x: number, floor: number): string | null {
  if (floor === 0) return null;
  if (floor < 1 || floor > FLOOR_COUNT) return null;
  const perFloor = ROOMS_PER_FLOOR[floor - 1] ?? 8;
  for (let idx = 0; idx < perFloor; idx++) {
    const xMin = HALLWAY_MIN_X + idx * (ROOM_WIDTH + ROOM_GAP);
    const xMax = xMin + ROOM_WIDTH;
    if (x >= xMin && x < xMax) {
      return `${floor}-${idx}`;
    }
  }
  return null;
}

/**
 * Returns true iff (x,floor) is inside the room with the given roomId.
 * Floor must match the room's floor and x must be in [xMin,xMax).
 */
export function isInsideRoom(x: number, floor: number, roomId: string): boolean {
  const parsed = parseRoomId(roomId);
  if (!parsed) return false;
  if (parsed.floor !== floor) return false;
  const rect = getRoomRect(roomId);
  return x >= rect.xMin && x < rect.xMax;
}

/**
 * Returns all roomIds in deterministic order: floor-major then index.
 */
export function getAllRoomIds(): string[] {
  const ids: string[] = [];
  for (let floor = 1; floor <= FLOOR_COUNT; floor++) {
    const perFloor = ROOMS_PER_FLOOR[floor - 1] ?? 8;
    for (let idx = 0; idx < perFloor; idx++) {
      ids.push(`${floor}-${idx}`);
    }
  }
  return ids;
}

/**
 * Convenience: elevator X positions per shaft.
 */
export function getElevatorX(shaft: "A" | "B"): number {
  return shaft === "A" ? ELEVATOR_A_X : ELEVATOR_B_X;
}
