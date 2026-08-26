import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

// ── Player ────────────────────────────────────────────────────────────────────

/**
 * Player presence state. Shared by server (authority) and client (decoder).
 * Extended in M1 with floor, role (private), channel.
 */
export class PlayerState extends Schema {
  @type("string")
  sessionId = "";

  @type("string")
  name = "";

  @type("number")
  colorIndex = 0;

  @type("number")
  x = 0;

  /** M1 — floor membership: 0=lobby, 1-3 guest floors */
  @type("number")
  floor = 0;

  /**
   * M1 — private role, never replicated in broadcast map (server filters).
   * Not decorated so it is not synced; server sends via private onMessage.
   */
  role?: string;

  /**
   * M1 — active channel type, null when idle. Null is omitted from JSON
   * until channelling, preserving M0 decode.
   */
  @type("string")
  activeChannel: string | null = null;

  /** M1 — channel timer placeholder (server uses Maps, not schema). */
  channelTimer?: number;
}

export type ChannelType = "prep" | "unprep" | "fake";
export type RoleType = "staff" | "saboteur";

// ── Room data ─────────────────────────────────────────────────────────────────

export type RoomStateType = "clean" | "prepped" | "trashed";

export class RoomData extends Schema {
  @type("string")
  id = "";

  @type("number")
  floor = 1;

  @type("number")
  xMin = 0;

  @type("number")
  xMax = 0;

  @type("string")
  state: RoomStateType = "clean";
}

// ── Elevator ──────────────────────────────────────────────────────────────────

export type ElevatorShaft = "A" | "B";
export type ElevatorStatus = "idle" | "arriving" | "boarding";

export class ElevatorCar extends Schema {
  @type("string")
  shaft: ElevatorShaft = "A";

  @type("number")
  floor = 0;

  @type("string")
  state: ElevatorStatus = "idle";

  @type(["string"])
  queue = new ArraySchema<string>();
}

// ── Winner / traitor ──────────────────────────────────────────────────────────

export type Winner = "staff" | "saboteur";

export class TraitorReveal extends Schema {
  @type("string")
  sessionId = "";

  @type("string")
  name = "";
}

// ── Phase ─────────────────────────────────────────────────────────────────────

/**
 * Room lifecycle phase.
 */
export type Phase = "waiting" | "playing" | "results";

// ── Room state ────────────────────────────────────────────────────────────────

/**
 * Authoritative room state — roster, lifecycle phase, host, and results placeholder.
 * Extended in M1 with building topology, timers, winner.
 * New fields default to clean/idle/null/0 so M0 clients decode.
 */
export class RoomState extends Schema {
  @type({ map: PlayerState })
  players = new MapSchema<PlayerState>();

  @type("string")
  phase: Phase = "waiting";

  @type("string")
  hostSessionId = "";

  /**
   * Results payload placeholder — must remain null in M0 (no winner/reveal).
   * Not decorated as schema type; plain property so it stays null and never
   * carries winner/traitor data via this field (M1 uses winner/traitorReveal).
   */
  resultsPayload: unknown = null;

  // ── M1 extensions ─────────────────────────────────────────────────────────

  /** M1 — room map: 24 RoomData entries, id -> RoomData */
  @type({ map: RoomData })
  rooms = new MapSchema<RoomData>();

  /** M1 — elevator cars keyed by shaft "A"|"B" */
  @type({ map: ElevatorCar })
  elevators = new MapSchema<ElevatorCar>();

  /** M1 — shift end timestamp ms since epoch, 0 means not started */
  @type("number")
  shiftEndsAt = 0;

  /**
   * M1 — winner, null means no winner yet; set to "staff"|"saboteur" on results.
   * Null is omitted from JSON until set, preserving M0 decoder compatibility.
   */
  @type("string")
  winner: string | null = null;

  /**
   * M1 — traitor reveal, null until results. Decorated schema object;
   * null value means no reveal yet.
   */
  @type(TraitorReveal)
  traitorReveal: TraitorReveal | null = null;

  /** M1 — coverage ratio prepped/total, 0 until computed */
  @type("number")
  coverage = 0;
}
