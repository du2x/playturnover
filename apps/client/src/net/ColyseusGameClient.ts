import { Client } from "colyseus.js";
import type { Room } from "colyseus.js";
import type {
  ClientEvent,
  DisplayName,
  GameClient,
  MoveMsg,
  RoomCode,
  RoomStateView,
  Unsubscribe,
} from "./GameClient.js";

function getEndpoint(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    if (env?.VITE_GAME_URL) return env.VITE_GAME_URL;
  } catch {
    // ignore
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  // fallback for node/vitest
  const procEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  if (procEnv?.VITE_GAME_URL) return procEnv.VITE_GAME_URL;
  return "http://localhost:2567";
}

function toView(state: unknown, mySessionId: string): RoomStateView | null {
  if (!state || typeof state !== "object") return null;
  const s = state as {
    players?: unknown;
    phase?: unknown;
    hostSessionId?: unknown;
  };
  const players: RoomStateView["players"] = [];
  const rawPlayers = s.players as unknown;
  if (rawPlayers) {
    // MapSchema has forEach, Map has forEach, plain object fallback
    if (typeof (rawPlayers as { forEach?: unknown }).forEach === "function") {
      (rawPlayers as Map<string, { sessionId: string; name: string; colorIndex: number; x: number }>).forEach(
        (p: { sessionId: string; name: string; colorIndex: number; x: number }, id: string) => {
          players.push({
            id: p.sessionId ?? id,
            name: p.name,
            colorIndex: p.colorIndex,
            x: p.x,
          });
        },
      );
    } else if (typeof rawPlayers === "object") {
      for (const [id, p] of Object.entries(rawPlayers as Record<string, unknown>)) {
        const v = p as { sessionId?: string; name: string; colorIndex: number; x: number };
        players.push({
          id: v.sessionId ?? id,
          name: v.name,
          colorIndex: v.colorIndex,
          x: v.x,
        });
      }
    }
  }
  players.sort((a, b) => a.colorIndex - b.colorIndex);
  const phase = (s.phase as RoomStateView["phase"]) ?? "waiting";
  const hostSessionId = (s.hostSessionId as string) ?? "";
  return {
    players,
    phase,
    mySessionId,
    hostSessionId,
  };
}

function classifyJoinError(err: unknown): ClientEvent {
  const msg = (err as { message?: string })?.message ?? String(err);
  if (msg.includes("full")) return { type: "rejected", reason: "full" };
  if (msg.includes("bad-name")) return { type: "rejected", reason: "bad-name" };
  if (msg.includes("not-found") || msg.includes("room not found") || msg.includes("not found")) {
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

  private emitState(): void {
    if (!this.room) return;
    const view = toView((this.room as unknown as { state: unknown }).state, this.room.sessionId);
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
    (room.onStateChange as unknown as (cb: (state: unknown) => void) => void)(stateCb);

    const errorCb = (code: number, message?: string): void => {
      const msg = message ?? `error ${code}`;
      this.emitEvent({ type: "error", message: msg });
      if (msg.includes("full") || msg.includes("bad-name")) {
        const reason = msg.includes("full") ? "full" : "bad-name";
        this.emitEvent({ type: "rejected", reason });
      }
    };
    (room.onError as unknown as (cb: (code: number, message?: string) => void) => void)(errorCb);

    const leaveCb = (code: number): void => {
      this.emitEvent({ type: "left", code });
    };
    (room.onLeave as unknown as (cb: (code: number) => void) => void)(leaveCb);

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
    if (trimmed.length > 24) {
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
    if (!this.pendingName) throw new Error("not-connected: call connect() first");
    if (!this.client) this.client = new Client(getEndpoint());
    try {
      const room = await this.client.joinOrCreate<unknown>("hotel", { name: this.pendingName });
      this.wireRoom(room);
      // ensure initial emission after wire (state may arrive async, but also try now)
      const view = toView((room as unknown as { state: unknown }).state, room.sessionId);
      if (view) {
        this.lastView = view;
        for (const cb of this.stateCbs) cb(view);
      }
      const rid = (room as unknown as { roomId: string; id: string }).roomId ?? (room as unknown as { id: string }).id ?? "";
      return rid;
    } catch (err) {
      const ev = classifyJoinError(err);
      this.emitEvent(ev);
      throw err;
    }
  }

  async joinByCode(code: RoomCode): Promise<void> {
    if (!this.pendingName) throw new Error("not-connected: call connect() first");
    const filtered = code.trim().toUpperCase();
    if (!this.client) this.client = new Client(getEndpoint());
    try {
      const room = await this.client.joinById<unknown>(filtered, { name: this.pendingName });
      this.wireRoom(room);
      const view = toView((room as unknown as { state: unknown }).state, room.sessionId);
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
    if (!this.room) {
      this.emitEvent({ type: "error", message: "not in room" });
      return;
    }
    try {
      this.room.send("move", msg);
    } catch (e) {
      const m = (e as { message?: string })?.message ?? String(e);
      this.emitEvent({ type: "error", message: m });
    }
  }

  advancePhase(): void {
    if (!this.room) {
      this.emitEvent({ type: "error", message: "not in room" });
      return;
    }
    try {
      this.room.send("advancePhase", {});
    } catch (e) {
      const m = (e as { message?: string })?.message ?? String(e);
      this.emitEvent({ type: "error", message: m });
    }
  }

  onState(cb: (s: RoomStateView) => void): Unsubscribe {
    this.stateCbs.add(cb);
    if (this.lastView) cb(this.lastView);
    return () => {
      this.stateCbs.delete(cb);
    };
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
        (this.room as unknown as { removeAllListeners?: () => void }).removeAllListeners?.();
      } catch {
        // ignore
      }
      this.room = null;
    }
    this.lastView = null;
  }
}
