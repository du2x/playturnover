/**
 * Tuning constants — single source of truth per PRD §7.
 * Each constant is documented as PRD §7 row or M0 free variable (see plan).
 */

// ── PRD §7 rows ──────────────────────────────────────────────────────────────

/** PRD §7 — Players 4–6, maximum players per room. */
export const MAX_PLAYERS = 6;

/** PRD §7 — Shift length 5:00 (300 seconds). */
export const SHIFT_LENGTH_S = 300;

/** PRD §7 — Prep channel duration 5s. */
export const PREP_TIME_MS = 5000;

/** PRD §7 — Un-prep (sabotage) channel duration 3s. */
export const UNPREP_TIME_MS = 3000;

/** Convenience map to avoid non-import literal references in consumer code. */
export const CHANNEL_DURATIONS = {
  prep: PREP_TIME_MS,
  unprep: UNPREP_TIME_MS,
  fake: PREP_TIME_MS,
} as const;

/** PRD §7 — Coverage target 80%. */
export const COVERAGE_TARGET = 0.8;

/** PRD §7 — Trash freshness window 75s. */
export const FRESHNESS_WINDOW_MS = 75_000;

/** PRD §7 — Elevator arrive time 3s. */
export const ELEVATOR_ARRIVE_MS = 3000;

/** PRD §7 — Elevator ride time 2s. */
export const ELEVATOR_RIDE_MS = 2000;

/** PRD §7 — Elevator capacity 2. */
export const ELEVATOR_CAPACITY = 2;

/** PRD §7 — Accusation range ~2 tiles, same floor. */
export const ACCUSATION_RANGE_TILES = 2;

/** PRD §7 — Sabotage rustle audible range ~3 tiles. */
export const RUSTLE_RANGE_TILES = 3;

// ── M0 free variables, see plan ────────────────────────────────────────────

/** M0 free variable, see plan — tile size in pixels. */
export const TILE_SIZE_PX = 32;

/** M0 free variable, see plan — hallway left bound x. */
export const HALLWAY_MIN_X = 96;

/** M0 free variable, see plan — hallway right bound x. */
export const HALLWAY_MAX_X = 864;

/** M0 free variable, see plan — hallway invariant y. */
export const HALLWAY_Y = 120;

/** M0 free variable, see plan — normal player speed px/s. */
export const PLAYER_SPEED_PX_S = 220;

/** M0 free variable, see plan — server max speed clamp px/s (1.5× normal). */
export const SERVER_MAX_SPEED_PX_S = 330;

/** M0 free variable, see plan — client input send rate Hz. */
export const CLIENT_INPUT_SEND_HZ = 20;

/** M0 free variable, see plan — server patch / rebroadcast cadence ms. */
export const SERVER_PATCH_RATE_MS = 80;

/** M0 free variable, see plan — remote interpolation delay ms. */
export const INTERP_DELAY_MS = 100;

/** M0 free variable, see plan — room code length. */
export const ROOM_CODE_LENGTH = 4;

/** M0 free variable, see plan — unambiguous room code alphabet (no I/L/O/0/1). */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** M0 free variable, see plan — seat-indexed avatar colors (6 distinct hex colors). */
export const AVATAR_COLORS = [
  "#E63946",
  "#457B9D",
  "#2A9D8F",
  "#F4A261",
  "#9D4EDD",
  "#FFB703",
] as const;

/** M0 free variable, see plan — results payload placeholder (no winner/reveal in M0). */
export const RESULTS_PLACEHOLDER = null;

// ── M1 free variables, see plan ────────────────────────────────────────────

/** M1 free variable, see plan — number of guest floors (lobby is floor 0). */
export const FLOOR_COUNT = 3;

/** M1 free variable, see plan — rooms per guest floor. */
export const ROOMS_PER_FLOOR: readonly number[] = [8, 8, 8] as const;

/** M1 free variable, see plan — total room count (3×8). */
export const ROOM_COUNT = 24;

/** M1 free variable, see plan — vertical step between floors in pixels. */
export const FLOOR_Y_STEP = 90;

/** M1 free variable, see plan — lobby center gather-up spawn. */
export const LOBBY_CENTER = { x: 480, y: 120 } as const;

/** M1 free variable, see plan — room width in pixels. */
export const ROOM_WIDTH = 88;

/** M1 free variable, see plan — gap between rooms in pixels. */
export const ROOM_GAP = 8;

/** M1 free variable, see plan — elevator A x position (west shaft). */
export const ELEVATOR_A_X = 118;

/** M1 free variable, see plan — elevator B x position (east shaft). */
export const ELEVATOR_B_X = 842;

/** M1 free variable, see plan — elevator interact radius in pixels. */
export const ELEVATOR_INTERACT_RADIUS = 18;
