import { Client } from "colyseus.js";
import type { Room } from "colyseus.js";
import {
  getAllRoomIds,
  getElevatorX,
  isInsideRoom,
  MAX_NAME_LENGTH,
} from "@grandhotel/shared";
import type {
  ElevatorShaft,
  RoleType,
  RoomStateType,
} from "@grandhotel/shared";
import type {
  ChannelType,
  ClientEvent,
  DisplayName,
  ElevatorStatus,
  GameClient,
  MoveMsg,
  RoomCode,
  RoomStateView,
  Unsubscribe,
} from "./GameClient.js";

function getEndpoint(): string {
  try {
    const env = (
      import.meta as unknown as { env?: Record<string, string | undefined> }
    ).env;
    if (env?.VITE_GAME_URL) return env.VITE_GAME_URL;
  } catch {
    // ignore
  }

  const procEnv = (
    globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  if (procEnv?.VITE_GAME_URL) return procEnv.VITE_GAME_URL;

  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin;
    try {
      const url = new URL(origin);
      const isLocalViteDevPort =
        (url.hostname === "localhost" ||
          url.hostname === "127.0.0.1" ||
          url.hostname === "0.0.0.0") &&
        ["5173", "5174", "4173"].includes(url.port);
      if (isLocalViteDevPort) return "http://localhost:2567";
    } catch {
      // ignore invalid origin strings
    }
    return origin;
  }

  return "http://localhost:2567";
}

function toView(
  state: unknown,
  mySessionId: string,
  myRole: RoleType | null,
): RoomStateView | null {
  if (!state || typeof state !== "object") return null;
  const s = state as {
    players?: unknown;
    phase?: unknown;
    hostSessionId?: unknown;
    rooms?: unknown;
    elevators?: unknown;
    shiftEndsAt?: unknown;
    winner?: unknown;
    traitorReveal?: unknown | null;
    coveragePercent?: unknown;
    recapEvents?: unknown;
    roomCode?: unknown;
  };

  const players: RoomStateView["players"] = [];
  let myFloor = 0;
  const rawPlayers = s.players as unknown;
  if (rawPlayers) {
    const mapper = (p: Record<string, unknown>, id: string): void => {
      const pid = (p.sessionId as string) ?? id;
      players.push({
        id: pid,
        name: (p.name as string) ?? "",
        colorIndex: (p.colorIndex as number) ?? 0,
        x: (p.x as number) ?? 0,
        floor: (p.floor as number) ?? 0,
        fired: p.fired === true,
        spectator: p.spectator === true,
      });
      if (pid === mySessionId) {
        myFloor = (p.floor as number) ?? 0;
      }
    };
    if (typeof (rawPlayers as { forEach?: unknown }).forEach === "function") {
      (rawPlayers as Map<string, Record<string, unknown>>).forEach(mapper);
    } else if (typeof rawPlayers === "object") {
      for (const [id, p] of Object.entries(
        rawPlayers as Record<string, unknown>,
      )) {
        mapper(p as Record<string, unknown>, id);
      }
    }
  }
  players.sort((a, b) => a.colorIndex - b.colorIndex);

  const me = players.find((p) => p.id === mySessionId);
  const mx = me?.x ?? 0;
  const mf = me?.floor ?? 0;
  const isSpectator = me?.spectator === true || me?.fired === true;

  const roomsView: RoomStateView["roomsView"] = {};
  const evidenceView: RoomStateView["evidenceView"] = {};
  for (const roomId of getAllRoomIds()) {
    const inside = isInsideRoom(mx, mf, roomId);
    roomsView[roomId] = inside || isSpectator ? readRoomState(s.rooms, roomId) : null;
    evidenceView[roomId] = readEvidence(s.rooms, roomId);
  }

  const elevatorsView: RoomStateView["elevatorsView"] = {
    A: readElevator(s.elevators, "A"),
    B: readElevator(s.elevators, "B"),
  };

  const phase = (s.phase as RoomStateView["phase"]) ?? "waiting";
  const hostSessionId = (s.hostSessionId as string) ?? "";
  const shiftEndsAt =
    typeof s.shiftEndsAt === "number" && s.shiftEndsAt > 0
      ? s.shiftEndsAt
      : null;
  const winner = normalizeWinner(s.winner);
  const traitorReveal = normalizeTraitorReveal(s.traitorReveal);
  const recapEvents = readRecapEvents(s.recapEvents);
  const roomCode =
    typeof s.roomCode === "string" && s.roomCode !== "" ? s.roomCode : null;

  return {
    players,
    roomCode,
    phase,
    mySessionId,
    hostSessionId,
    myRole,
    myFloor,
    roomsView,
    evidenceView,
    elevatorsView,
    coveragePercent:
      typeof s.coveragePercent === "number" ? s.coveragePercent : 0,
    shiftEndsAt,
    winner,
    traitorReveal,
    recapEvents,
  };
}

function readRecapEvents(value: unknown): RoomStateView["recapEvents"] {
  if (!value || typeof value !== "object") return [];
  const entries: unknown[] = [];
  if (typeof (value as { forEach?: unknown }).forEach === "function") {
    (value as { forEach: (cb: (entry: unknown) => void) => void }).forEach(
      (entry) => entries.push(entry),
    );
  } else if (Array.isArray(value)) {
    entries.push(...value);
  }
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const event = entry as Record<string, unknown>;
    if (typeof event.type !== "string" || typeof event.timestamp !== "number") {
      return [];
    }
    return [
      {
        type: event.type,
        actorSessionId:
          typeof event.actorSessionId === "string" ? event.actorSessionId : "",
        targetSessionId:
          typeof event.targetSessionId === "string"
            ? event.targetSessionId
            : "",
        roomId: typeof event.roomId === "string" ? event.roomId : "",
        shaft:
          typeof event.shaft === "string" && event.shaft
            ? event.shaft
            : undefined,
        timestamp: event.timestamp,
        valid: event.valid === true,
        wasTargetSaboteur: event.wasTargetSaboteur === true,
        crimeOccurred: event.crimeOccurred === true,
      },
    ];
  });
}

function readEvidence(
  rooms: unknown,
  roomId: string,
): NonNullable<RoomStateView["evidenceView"]>[string] {
  const entry = lookupMapLike(rooms ?? {}, roomId);
  if (!entry || typeof entry !== "object") {
    return {
      card: { present: false, text: "" },
      freshness: null,
      trashedAtTime: 0,
    };
  }
  const value = entry as {
    doorCard?: { present?: unknown; text?: unknown };
    freshness?: unknown;
    trashedAtTime?: unknown;
  };
  const freshness =
    value.freshness === "fresh" || value.freshness === "settled"
      ? value.freshness
      : null;
  return {
    card: {
      present: value.doorCard?.present === true,
      text: typeof value.doorCard?.text === "string" ? value.doorCard.text : "",
    },
    freshness,
    trashedAtTime:
      typeof value.trashedAtTime === "number" ? value.trashedAtTime : 0,
  };
}

function readRoomState(rooms: unknown, roomId: string): RoomStateType | null {
  if (!rooms || typeof rooms !== "object") return null;
  const entry = lookupMapLike(rooms, roomId);
  if (!entry || typeof entry !== "object") return null;
  const state = (entry as { state?: unknown }).state;
  const allowed = ["clean", "prepped", "trashed"] as const;
  return allowed.includes(state as RoomStateType)
    ? (state as RoomStateType)
    : null;
}

function readElevator(
  elevators: unknown,
  shaft: ElevatorShaft,
): { floor: number; state: ElevatorStatus } {
  if (!elevators || typeof elevators !== "object") {
    return { floor: 0, state: "idle" };
  }
  const e = lookupMapLike(elevators, shaft);
  if (!e || typeof e !== "object") {
    return { floor: 0, state: "idle" };
  }
  const state = (e as { state?: unknown }).state;
  const allowed = ["idle", "arriving", "boarding", "traveling"] as const;
  return {
    floor: (e as { floor?: number }).floor ?? 0,
    state: allowed.includes(state as ElevatorStatus)
      ? (state as ElevatorStatus)
      : "idle",
  };
}

function lookupMapLike(container: object, key: string): unknown {
  const c = container as Record<string, unknown> & {
    get?: (k: string) => unknown;
    has?: (k: string) => boolean;
  };
  if (typeof c.get === "function") {
    return c.get(key);
  }
  return c[key];
}

function normalizeWinner(value: unknown): RoleType | null {
  if (value === "staff" || value === "saboteur") return value as RoleType;
  return null;
}

function normalizeTraitorReveal(
  value: unknown,
): { sessionId: string; name: string } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { sessionId?: unknown; name?: unknown };
  if (typeof v.sessionId === "string" && typeof v.name === "string") {
    return { sessionId: v.sessionId, name: v.name };
  }
  return null;
}

const ROOM_CODE_POLL_INTERVAL_MS = 50;
const ROOM_CODE_POLL_TIMEOUT_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapServerError(reasonOrMessage: string): ClientEvent {
  const msg = reasonOrMessage ?? "";
  if (
    msg === "need-4-players" ||
    msg === "not-saboteur" ||
    msg === "wrong-state"
  ) {
    return { type: "rejected", reason: msg };
  }
  return { type: "error", message: msg, reason: msg };
}

function classifyJoinError(err: unknown): ClientEvent {
  const msg = (err as { message?: string })?.message ?? String(err);
  if (msg.includes("full")) return { type: "rejected", reason: "full" };
  if (msg.includes("bad-name")) return { type: "rejected", reason: "bad-name" };
  if (
    msg.includes("not-found") ||
    msg.includes("room not found") ||
    msg.includes("not found")
  ) {
    return { type: "rejected", reason: "not-found" };
  }
  // colyseus MatchMakeError may have code 421?
  return { type: "error", message: msg };
}

export class ColyseusGameClient implements GameClient {
  private client: Client | null = null;
  private room: Room<unknown> | null = null;
  private pendingName: DisplayName | null = null;
  private stateCbs = new Set<(s: RoomStateView) => void>();
  private eventCbs = new Set<(e: ClientEvent) => void>();
  private lastView: RoomStateView | null = null;
  private privateRole: RoleType | null = null;

  private emitState(): void {
    if (!this.room) return;
    const rawState = (this.room as unknown as { state: unknown }).state;
    const view = toView(rawState, this.room.sessionId, this.privateRole);
    if (!view) return;
    this.lastView = view;
    for (const cb of this.stateCbs) cb(view);
  }

  private emitEvent(ev: ClientEvent): void {
    for (const cb of this.eventCbs) cb(ev);
  }

  private wireRoom(room: Room<unknown>): void {
    this.room = room;
    // state changes
    const stateCb = (): void => {
      this.emitState();
    };
    // colyseus Room.onStateChange is callable + has .remove etc. Use any to stay decoupled.
    (room.onStateChange as unknown as (cb: (state: unknown) => void) => void)(
      stateCb,
    );

    const errorCb = (code: number, message?: string): void => {
      const msg = message ?? `error ${code}`;
      this.emitEvent({ type: "error", message: msg });
      if (msg.includes("full") || msg.includes("bad-name")) {
        const reason = msg.includes("full") ? "full" : "bad-name";
        this.emitEvent({ type: "rejected", reason });
      }
    };
    (
      room.onError as unknown as (
        cb: (code: number, message?: string) => void,
      ) => void
    )(errorCb);

    const leaveCb = (code: number): void => {
      this.emitEvent({ type: "left", code });
    };
    (room.onLeave as unknown as (cb: (code: number) => void) => void)(leaveCb);

    // private role message
    (
      room.onMessage as unknown as (
        type: string,
        cb: (payload: unknown) => void,
      ) => void
    )("role", (payload: unknown) => {
      const p = payload as { role?: string };
      if (p.role === "staff" || p.role === "saboteur") {
        this.privateRole = p.role as RoleType;
        this.emitState();
      }
    });

    // server error messages
    (
      room.onMessage as unknown as (
        type: string,
        cb: (payload: unknown) => void,
      ) => void
    )("error", (payload: unknown) => {
      const p = payload as { reason?: string; message?: string };
      const reason = p.reason ?? p.message ?? "server-error";
      this.emitEvent(mapServerError(reason));
    });

    (
      room.onMessage as unknown as (
        type: string,
        cb: (payload: unknown) => void,
      ) => void
    )("sabotageEvent", (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const event = payload as {
        roomId?: unknown;
        position?: { x?: unknown; y?: unknown };
        timestamp?: unknown;
      };
      if (
        typeof event.roomId === "string" &&
        typeof event.position?.x === "number" &&
        typeof event.position?.y === "number" &&
        typeof event.timestamp === "number"
      ) {
        this.emitEvent({
          type: "sabotage",
          roomId: event.roomId,
          x: event.position.x,
          y: event.position.y,
          timestamp: event.timestamp,
        });
      }
    });

    // emit initial state if already present
    try {
      this.emitState();
    } catch {
      // ignore
    }
  }

  async connect(name: DisplayName): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      const ev: ClientEvent = { type: "rejected", reason: "bad-name" };
      this.emitEvent(ev);
      throw new Error("bad-name");
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      const ev: ClientEvent = { type: "rejected", reason: "bad-name" };
      this.emitEvent(ev);
      throw new Error("bad-name");
    }
    this.pendingName = trimmed;
    if (!this.client) {
      this.client = new Client(getEndpoint());
    }
  }

  async createRoom(): Promise<string> {
    if (!this.pendingName)
      throw new Error("not-connected: call connect() first");
    if (!this.client) this.client = new Client(getEndpoint());
    try {
      const room = await this.client.joinOrCreate<unknown>("hotel", {
        name: this.pendingName,
      });
      this.wireRoom(room);
      // ensure initial emission after wire (state may arrive async, but also try now)
      const view = toView(
        (room as unknown as { state: unknown }).state,
        room.sessionId,
        this.privateRole,
      );
      if (view) {
        this.lastView = view;
        for (const cb of this.stateCbs) cb(view);
      }
      const rid =
        (room as unknown as { roomId: string; id: string }).roomId ??
        (room as unknown as { id: string }).id ??
        "";
      // Return the server-assigned short code, not the raw room id: poll the
      // projected view until state sync carries `roomCode` (~2s window).
      let shortCode = this.lastView?.roomCode ?? null;
      const deadline = Date.now() + ROOM_CODE_POLL_TIMEOUT_MS;
      while (!shortCode && Date.now() < deadline) {
        await sleep(ROOM_CODE_POLL_INTERVAL_MS);
        shortCode = this.lastView?.roomCode ?? null;
      }
      return shortCode ?? rid;
    } catch (err) {
      const ev = classifyJoinError(err);
      this.emitEvent(ev);
      throw err;
    }
  }

  async joinByCode(code: RoomCode): Promise<void> {
    if (!this.pendingName)
      throw new Error("not-connected: call connect() first");
    const filtered = code.trim().toUpperCase();
    if (!this.client) this.client = new Client(getEndpoint());
    // Resolve the short code against room listings (metadata.roomCode is
    // published by the server) — the display code is never a joinable id.
    let match: { roomId: string } | undefined;
    try {
      const listings = await this.client.getAvailableRooms<{
        roomCode?: string;
      }>("hotel");
      match = listings.find((l) => l.metadata?.roomCode === filtered);
    } catch (err) {
      const ev = classifyJoinError(err);
      this.emitEvent(ev);
      throw err;
    }
    if (!match) {
      // Classified rejection BEFORE any join attempt — never an unhandled
      // MatchMakeError from joining a code as if it were a room id.
      const ev: ClientEvent = { type: "rejected", reason: "not-found" };
      this.emitEvent(ev);
      throw new Error("not-found");
    }
    try {
      const room = await this.client.joinById<unknown>(match.roomId, {
        name: this.pendingName,
      });
      this.wireRoom(room);
      const view = toView(
        (room as unknown as { state: unknown }).state,
        room.sessionId,
        this.privateRole,
      );
      if (view) {
        this.lastView = view;
        for (const cb of this.stateCbs) cb(view);
      }
    } catch (err) {
      const ev = classifyJoinError(err);
      this.emitEvent(ev);
      throw err;
    }
  }

  sendMove(msg: MoveMsg): void {
    this.ensureRoomSend("move", msg);
  }

  startRound(): void {
    this.ensureRoomSend("startRound", {});
  }

  callElevator(shaft: ElevatorShaft): void {
    this.ensureRoomSend("callElevator", { shaft });
  }

  rideElevator(shaft: ElevatorShaft, destFloor: number): void {
    this.ensureRoomSend("rideElevator", { shaft, destFloor });
  }

  accuse(targetSessionId: string): void {
    this.ensureRoomSend("accusation", { targetSessionId });
  }

  startChannel(type: ChannelType, roomId: string): void {
    this.ensureRoomSend("channelStart", { type, roomId });
  }

  cancelChannel(): void {
    this.ensureRoomSend("channelCancel", {});
  }

  private ensureRoomSend(type: string, payload: unknown): void {
    if (!this.room) {
      this.emitEvent({ type: "error", message: "not in room" });
      return;
    }
    try {
      this.room.send(type, payload);
    } catch (e) {
      const m = (e as { message?: string })?.message ?? String(e);
      this.emitEvent({ type: "error", message: m, reason: m });
    }
  }

  onState(cb: (s: RoomStateView) => void): Unsubscribe {
    this.stateCbs.add(cb);
    if (this.lastView) cb(this.lastView);
    return () => {
      this.stateCbs.delete(cb);
    };
  }

  getLastView(): RoomStateView | null {
    return this.lastView;
  }

  getCachedRole(): RoleType | null {
    return this.privateRole;
  }

  onEvent(cb: (e: ClientEvent) => void): Unsubscribe {
    this.eventCbs.add(cb);
    return () => {
      this.eventCbs.delete(cb);
    };
  }

  disconnect(): void {
    if (this.room) {
      try {
        void this.room.leave();
      } catch {
        // ignore
      }
      try {
        (
          this.room as unknown as { removeAllListeners?: () => void }
        ).removeAllListeners?.();
      } catch {
        // ignore
      }
      this.room = null;
    }
    this.lastView = null;
  }
}
