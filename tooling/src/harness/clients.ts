import { Client } from "colyseus.js";
import type { Room } from "colyseus.js";
import { RoleMsgSchema } from "@grandhotel/shared";
import type { RoleMsg, RoomData } from "@grandhotel/shared";
import { spawnServer } from "./spawn.js";
import type { SpawnedServer } from "./spawn.js";

export type HarnessClient = {
  name: string;
  url: string;
  client: Client;
  room: Room<unknown> | null;
  get sessionId(): string | null;
};

function getRoomId(room: Room<unknown>): string {
  const r = room as unknown as { roomId: string; id: string; roomName?: string };
  return r.roomId ?? r.id ?? "";
}

function makeClientInternal(name: string, url: string): HarnessClient {
  const client = new Client(url);
  let room: Room<unknown> | null = null;
  return {
    name,
    url,
    client,
    get room(): Room<unknown> | null {
      return room;
    },
    set room(v: Room<unknown> | null) {
      room = v;
    },
    get sessionId(): string | null {
      return room?.sessionId ?? null;
    },
  } as HarnessClient;
}

export function makeClient(name: string, url?: string): HarnessClient {
  const effectiveUrl = url ?? process.env.SMOKE_URL ?? "http://localhost:2567";
  return makeClientInternal(name, effectiveUrl);
}

export async function createRoom(c: HarnessClient, opts?: { shiftLengthSOverride?: number }): Promise<string> {
  const options: Record<string, unknown> = { name: c.name };
  if (opts?.shiftLengthSOverride !== undefined) {
    options.shiftLengthSOverride = opts.shiftLengthSOverride;
  }
  const room = await c.client.joinOrCreate<unknown>("hotel", options);
  (c as unknown as { room: Room<unknown> | null }).room = room;
  // give a tick for initial state sync
  await new Promise<void>((r) => setTimeout(r, 120));
  return getRoomId(room);
}

export async function joinByCode(c: HarnessClient, code: string): Promise<void> {
  const filtered = code.trim();
  const room = await c.client.joinById<unknown>(filtered, { name: c.name });
  (c as unknown as { room: Room<unknown> | null }).room = room;
  await new Promise<void>((r) => setTimeout(r, 120));
}

export type StateRecord = {
  t: number;
  players: Map<string, { sessionId: string; name: string; colorIndex: number; x: number }>;
  phase: string;
  hostSessionId: string;
};

function extractState(state: unknown): StateRecord | null {
  if (!state || typeof state !== "object") return null;
  const s = state as {
    players?: unknown;
    phase?: unknown;
    hostSessionId?: unknown;
  };
  const players = new Map<string, { sessionId: string; name: string; colorIndex: number; x: number }>();
  const rawPlayers = s.players as unknown;
  if (rawPlayers) {
    if (typeof (rawPlayers as { forEach?: unknown }).forEach === "function") {
      (rawPlayers as Map<string, { sessionId: string; name: string; colorIndex: number; x: number }>).forEach(
        (p, id) => {
          players.set(id, {
            sessionId: (p as unknown as { sessionId?: string }).sessionId ?? id,
            name: (p as unknown as { name: string }).name,
            colorIndex: (p as unknown as { colorIndex: number }).colorIndex,
            x: (p as unknown as { x: number }).x,
          });
        },
      );
    } else if (typeof rawPlayers === "object") {
      for (const [id, p] of Object.entries(rawPlayers as Record<string, unknown>)) {
        const v = p as { sessionId?: string; name: string; colorIndex: number; x: number };
        players.set(id, {
          sessionId: v.sessionId ?? id,
          name: v.name,
          colorIndex: v.colorIndex,
          x: v.x,
        });
      }
    }
  }
  const phase = (s.phase as string) ?? "waiting";
  const hostSessionId = (s.hostSessionId as string) ?? "";
  return { t: Date.now(), players, phase, hostSessionId };
}

export type CollectedState = {
  records: StateRecord[];
  stop: () => void;
  latest: () => StateRecord | null;
};

export function collectState(c: HarnessClient): CollectedState {
  if (!c.room) throw new Error("collectState: client not in room");
  const records: StateRecord[] = [];
  const push = (state: unknown): void => {
    const rec = extractState(state);
    if (rec) records.push(rec);
  };
  // push initial
  try {
    const st = (c.room as unknown as { state: unknown }).state;
    if (st) push(st);
  } catch {
    // ignore
  }
  const handler = (state: unknown): void => {
    push(state);
  };
  // subscribe
  (c.room.onStateChange as unknown as (cb: (state: unknown) => void) => void)(handler);
  // Some colyseus versions use onStateChange event emitter; also try add listener via state change callback
  // Poll fallback: poll every 50ms to capture intermediate patches not firing onStateChange without schema?
  const poll = setInterval(() => {
    try {
      const st = (c.room as unknown as { state: unknown }).state;
      if (st) {
        const rec = extractState(st);
        if (rec) {
          const last = records[records.length - 1];
          // only push if changed
          if (!last || last.phase !== rec.phase || last.players.size !== rec.players.size) {
            // compare players x
            let changed = false;
            if (last) {
              for (const [k, v] of rec.players) {
                const prev = last.players.get(k);
                if (!prev || prev.x !== v.x || prev.name !== v.name) {
                  changed = true;
                  break;
                }
              }
            } else changed = true;
            if (changed) {
              rec.t = Date.now();
              records.push(rec);
            }
          } else {
            // check x changes
            let diff = false;
            for (const [k, v] of rec.players) {
              const prev = last?.players.get(k);
              if (!prev || prev.x !== v.x) {
                diff = true;
                break;
              }
            }
            if (diff) {
              rec.t = Date.now();
              records.push(rec);
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }, 60);

  const stop = (): void => {
    clearInterval(poll);
    // colyseus.js doesn't expose remove; we rely on poll cleanup and leave room
    try {
      const roomAny = c.room as unknown as { onStateChange?: { remove?: (cb: unknown) => void; clear?: () => void } };
      roomAny.onStateChange?.remove?.(handler);
    } catch {
      // ignore
    }
  };

  return {
    records,
    stop,
    latest: () => (records.length ? records[records.length - 1]! : null),
  };
}

export function sendMove(c: HarnessClient, msg: { dx: number; dy: number; seq: number }): void {
  if (!c.room) throw new Error("not in room");
  c.room.send("move", msg);
}

export async function waitForRoster(
  clients: HarnessClient[],
  expectedNames: string[],
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let ok = true;
    for (const cl of clients) {
      if (!cl.room) {
        ok = false;
        break;
      }
      const state = (cl.room as unknown as { state: unknown }).state as {
        players?: Map<string, { name: string }>;
      } | null;
      if (!state?.players) {
        ok = false;
        break;
      }
      const names: string[] = [];
      const raw = state.players as unknown as { forEach: (cb: (v: { name: string }) => void) => void };
      if (raw && typeof raw.forEach === "function") {
        raw.forEach((p) => names.push(p.name));
      } else if (typeof state.players === "object") {
        for (const v of Object.values(state.players as unknown as Record<string, { name: string }>)) {
          names.push(v.name);
        }
      }
      for (const n of expectedNames) {
        if (!names.includes(n)) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (ok) return;
    await new Promise<void>((r) => setTimeout(r, 80));
  }
  throw new Error(`waitForRoster timeout waiting for ${expectedNames.join(",")}`);
}

export function getXForPlayer(c: HarnessClient, sessionId: string): number | null {
  if (!c.room) return null;
  const state = (c.room as unknown as { state: unknown }).state as {
    players?: Map<string, { x: number }>;
  };
  if (!state?.players) return null;
  const raw = state.players as unknown as Map<string, { x: number }>;
  if (raw && typeof raw.get === "function") {
    const p = raw.get(sessionId);
    return p ? p.x : null;
  }
  const obj = state.players as unknown as Record<string, { x: number }>;
  const p = (obj as Record<string, { x: number }>)[sessionId];
  return p ? p.x : null;
}

export function disconnect(c: HarnessClient): void {
  try {
    void c.room?.leave();
  } catch {
    // ignore
  }
  // null out
  (c as unknown as { room: Room<unknown> | null }).room = null;
}

// ── M1 lifecycle helpers ──────────────────────────────────────────────────────

export async function createRoomAndJoin(
  n: number,
  names: string[],
  opts?: { shiftLengthSOverride?: number },
): Promise<{ clients: HarnessClient[]; roomId: string; url: string; close: () => Promise<void> }> {
  if (n < 1 || n > names.length) {
    throw new Error("createRoomAndJoin: n must be >= 1 and <= names.length");
  }
  const srv: SpawnedServer = await spawnServer({ shiftLengthSOverride: opts?.shiftLengthSOverride });
  const url = srv.url;
  const clients: HarnessClient[] = [];
  try {
    const host = makeClient(names[0] ?? "host", url);
    clients.push(host);
    const roomId = await createRoom(host, { shiftLengthSOverride: opts?.shiftLengthSOverride });
    for (let i = 1; i < n; i++) {
      const c = makeClient(names[i] ?? `p${i}`, url);
      clients.push(c);
      await joinByCode(c, roomId);
    }
    await waitForRoster(clients, names.slice(0, n), 5000);
    return { clients, roomId, url, close: srv.close };
  } catch (e) {
    for (const c of clients) {
      disconnect(c);
    }
    await srv.close();
    throw e;
  }
}

export async function startRound(host: HarnessClient): Promise<void> {
  if (!host.room) throw new Error("startRound: host not in room");
  const state = (host.room as unknown as { state: { hostSessionId: string } }).state;
  if (host.sessionId !== state.hostSessionId) {
    throw new Error("startRound: client is not the host");
  }
  host.room.send("startRound", {});
}

export async function collectRoles(clients: HarnessClient[]): Promise<Map<string, RoleMsg["role"]>> {
  const roles = new Map<string, RoleMsg["role"]>();
  const promises = clients.map((c) => {
    if (!c.room) throw new Error("collectRoles: client not in room");
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`collectRoles: timeout waiting for role for ${c.name}`));
      }, 5000);
      const handler = (data: unknown): void => {
        const parsed = RoleMsgSchema.safeParse(data);
        if (parsed.success) {
          clearTimeout(timer);
          const room = c.room as unknown as { onMessage?: { remove?: (type: string, cb: unknown) => void } };
          room.onMessage?.remove?.("role", handler);
          roles.set(c.sessionId!, parsed.data.role);
          resolve();
        }
      };
      const room = c.room as unknown as { onMessage: (type: string, cb: (data: unknown) => void) => void };
      room.onMessage("role", handler);
    });
  });
  await Promise.all(promises);
  return roles;
}

export async function waitForPhase(
  clients: HarnessClient[],
  phase: "waiting" | "playing" | "results",
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let ok = true;
    for (const c of clients) {
      if (!c.room) {
        ok = false;
        break;
      }
      const state = (c.room as unknown as { state: { phase: string } }).state;
      if (state.phase !== phase) {
        ok = false;
        break;
      }
    }
    if (ok) return;
    await new Promise<void>((r) => setTimeout(r, 80));
  }
  throw new Error(`waitForPhase timeout waiting for ${phase}`);
}

export function getPlayerFloor(c: HarnessClient, sessionId: string): number | null {
  if (!c.room) return null;
  const state = (c.room as unknown as { state: { players: Map<string, { floor: number }> } }).state;
  const raw = state.players as unknown as Map<string, { floor: number }>;
  if (raw && typeof raw.get === "function") {
    const p = raw.get(sessionId);
    return p ? p.floor : null;
  }
  const obj = state.players as unknown as Record<string, { floor: number }>;
  const p = obj[sessionId];
  return p ? p.floor : null;
}

export function getRoomState(c: HarnessClient, roomId: string): RoomData | null {
  if (!c.room) return null;
  const state = (c.room as unknown as { state: { rooms: Map<string, RoomData> } }).state;
  const raw = state.rooms as unknown as Map<string, RoomData>;
  if (raw && typeof raw.get === "function") {
    return raw.get(roomId) ?? null;
  }
  const obj = state.rooms as unknown as Record<string, RoomData>;
  return obj[roomId] ?? null;
}
