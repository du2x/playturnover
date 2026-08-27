import { COVERAGE_TARGET } from "@grandhotel/shared";

/**
 * Server-side Shift roles, assigned once per round at lobby gather-up (FR-2).
 * Kept private to each player via per-client role messages.
 */
export type ShiftRole = "staff" | "saboteur";

/**
 * Begin a shift: pick exactly one saboteur uniformly at random (PRD §6.6 /
 * FR-2), assign every player a role, and compute the buzzer deadline.
 *
 * `rng` is the caller-supplied random source (an explicit seam so tests can be
 * deterministic); `now` is the caller's current wall time, so this function is
 * fully pure. Empty `playerIds` yields `saboteurSessionId === null` and an
 * empty role map.
 */
export function beginShift(
  playerIds: readonly string[],
  rng: () => number,
  now: number,
  shiftLengthMs: number,
): {
  saboteurSessionId: string | null;
  roleBySessionId: Map<string, ShiftRole>;
  endsAt: number;
} {
  const idx = Math.floor(rng() * playerIds.length);
  const saboteurSessionId = playerIds[idx] ?? null;
  const roleBySessionId = new Map<string, ShiftRole>();
  for (const id of playerIds) {
    roleBySessionId.set(id, id === saboteurSessionId ? "saboteur" : "staff");
  }
  return { saboteurSessionId, roleBySessionId, endsAt: now + shiftLengthMs };
}

/**
 * Coverage fraction of prepped rooms at the buzzer (PRD §6.6). Pure; guards
 * against a non-positive total room count.
 */
export function computeCoverage(preppedCount: number, totalRooms: number): number {
  if (totalRooms <= 0) return 0;
  return preppedCount / totalRooms;
}

/**
 * Buzzer win outcome (PRD §6.6): staff win at/above COVERAGE_TARGET, otherwise
 * the saboteur wins.
 */
export function coverageWinner(coverage: number): "staff" | "saboteur" {
  return coverage >= COVERAGE_TARGET ? "staff" : "saboteur";
}

/**
 * Attrition outcome (PRD §6.6): the saboteur wins when staff are reduced to one
 * player. `saboteurConnected` is 1 when the saboteur is still connected, else 0
 * (e.g. they left and the room cleared the id).
 */
export function attritionWinner(
  totalConnected: number,
  saboteurConnected: number,
): "saboteur" | null {
  return totalConnected - saboteurConnected <= 1 ? "saboteur" : null;
}