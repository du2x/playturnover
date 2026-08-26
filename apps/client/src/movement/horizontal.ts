import { getHallBounds, PLAYER_SPEED_PX_S } from "@grandhotel/shared";

/**
 * Clamp x to hallway bounds for a given floor.
 * Delegates to shared getHallBounds(floor).
 */
export function clampToFloorBounds(x: number, floor: number): number {
  const b = getHallBounds(floor);
  if (x < b.minX) return b.minX;
  if (x > b.maxX) return b.maxX;
  return x;
}

/**
 * Legacy clamp to bounds (floor 0) — kept for backward compat.
 */
export function clampToBounds(x: number): number {
  return clampToFloorBounds(x, 0);
}

/**
 * Integrate horizontal movement.
 * @param x - current x position
 * @param dir - direction: -1 (left), 0 (idle), 1 (right). Values are normalized to -1|0|1.
 * @param dtSec - delta time in seconds (e.g. 0.016 for 16ms). Must be >=0; capped by caller at 0.1s.
 * @param floor - logical floor index, default 0 (lobby). Used for per-floor clamp.
 * @returns next x clamped to that floor's hallway bounds. y is untouched by construction (no y param).
 */
export function step(x: number, dir: number, dtSec: number, floor = 0): number {
  const ndir = dir > 0 ? 1 : dir < 0 ? -1 : 0;
  if (ndir === 0 || dtSec <= 0) return clampToFloorBounds(x, floor);
  const next = x + ndir * PLAYER_SPEED_PX_S * dtSec;
  return clampToFloorBounds(next, floor);
}
