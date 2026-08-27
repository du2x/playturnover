import { describe, it, expect, afterEach } from "vitest";
import { ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET } from "@grandhotel/shared";
import { spawnServer } from "../harness/spawn.js";
import type { SpawnedServer } from "../harness/spawn.js";
import {
  makeClient,
  createRoom,
  getRoomCode,
  joinByPublishedCode,
  waitForRoster,
  disconnect,
} from "../harness/clients.js";
import type { HarnessClient } from "../harness/clients.js";

/** Polls the replicated roomCode until non-null (server assigns it in onCreate). */
async function pollRoomCode(c: HarnessClient, timeoutMs = 5000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const code = getRoomCode(c);
    if (code !== null) return code;
    await new Promise<void>((r) => setTimeout(r, 60));
  }
  throw new Error(`pollRoomCode: timeout waiting for replicated roomCode (${c.name})`);
}

describe("integration join code (V-1)", () => {
  let srv: SpawnedServer | null = null;
  const clients: HarnessClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) {
      try {
        disconnect(c);
      } catch {}
    }
    if (srv) {
      await srv.close();
      srv = null;
    }
  });

  it("A creates → published code matches ROOM_CODE_LENGTH/alphabet and listing metadata; B joins by that code; rosters + same roomId", async () => {
    srv = await spawnServer();
    const a = makeClient("Alice", srv.url);
    const b = makeClient("Bob", srv.url);
    clients.push(a, b);

    // Client 1 creates a room; createRoom returns the raw roomId, the published
    // short code is read from the replicated state.
    const roomId = await createRoom(a);
    expect(typeof roomId).toBe("string");
    expect(roomId.length).toBeGreaterThan(0);

    const code = await pollRoomCode(a);
    // exactly ROOM_CODE_LENGTH characters drawn from ROOM_CODE_ALPHABET
    expect(code.length).toBe(ROOM_CODE_LENGTH);
    for (const ch of code) {
      expect(ROOM_CODE_ALPHABET).toContain(ch);
    }

    // cross-check: the matchmaking listing metadata carries the same code
    const listings = await a.client.getAvailableRooms("hotel");
    const ownListing = listings.find((l) => l.roomId === roomId);
    expect(ownListing).toBeDefined();
    expect((ownListing?.metadata as { roomCode?: string } | undefined)?.roomCode).toBe(code);

    // client 2 joins by exactly that code string
    await joinByPublishedCode(b, code);

    // rosters prove both present
    await waitForRoster([a, b], ["Alice", "Bob"], 5000);
    for (const cl of [a, b]) {
      const state = (cl.room as unknown as { state: { players: Map<string, { name: string }> } })
        .state;
      const names: string[] = [];
      const raw = state.players as unknown as { forEach: (cb: (v: { name: string }) => void) => void };
      if (raw && typeof raw.forEach === "function") {
        raw.forEach((p) => names.push(p.name));
      }
      expect(names).toEqual(expect.arrayContaining(["Alice", "Bob"]));
      expect(names).toHaveLength(2);
    }

    // both clients landed in the same underlying room
    const aRoomId = (a.room as unknown as { roomId: string }).roomId;
    const bRoomId = (b.room as unknown as { roomId: string }).roomId;
    expect(bRoomId).toBe(aRoomId);
  }, 15000);

  it("join by a well-formed but unassigned code rejects without placing the client in a room", async () => {
    srv = await spawnServer();
    const a = makeClient("Alice", srv.url);
    const b = makeClient("Bob", srv.url);
    clients.push(a, b);

    await createRoom(a);
    await pollRoomCode(a); // ensure assignment has settled

    // build a well-formed candidate verified absent from live listings
    const listings = await b.client.getAvailableRooms("hotel");
    const taken = new Set(
      listings
        .map((l) => (l.metadata as { roomCode?: string } | undefined)?.roomCode)
        .filter((c): c is string => typeof c === "string"),
    );
    let unassigned: string | null = null;
    for (const ch of ROOM_CODE_ALPHABET) {
      const candidate = ch.repeat(ROOM_CODE_LENGTH);
      if (!taken.has(candidate)) {
        unassigned = candidate;
        break;
      }
    }
    expect(unassigned).not.toBeNull();
    expect(unassigned!.length).toBe(ROOM_CODE_LENGTH);
    for (const ch of unassigned!) {
      expect(ROOM_CODE_ALPHABET).toContain(ch);
    }

    await expect(joinByPublishedCode(b, unassigned!)).rejects.toThrow(/no live room/i);
    expect(b.room).toBeNull();
  }, 15000);
});
