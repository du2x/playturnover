import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "@grandhotel/shared";
import { HotelRoom } from "../src/rooms/HotelRoom.js";
import {
  RoomCodeRegistry,
  generateRoomCode,
  roomCodeRegistry,
} from "../src/rooms/roomCodes.js";

/** Deterministic LCG rand for seeded tests. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Rand that always draws the alphabet character at the given index. */
function fixedCharRand(index: number): () => number {
  return () => (index + 0.5) / ROOM_CODE_ALPHABET.length;
}

const alphabetPattern = new RegExp(
  `^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`,
);

describe("room code lifecycle (V-2)", () => {
  beforeEach(() => {
    roomCodeRegistry.clearAll();
  });

  afterEach(() => {
    roomCodeRegistry.clearAll();
  });

  it("generated codes are length-exact and alphabet-valid", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const code = generateRoomCode(lcg(seed));
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(code).toMatch(alphabetPattern);
    }
    // also codes assigned by real rooms are well-formed
    const room = new HotelRoom();
    room.onCreate({});
    expect(room.state.roomCode).toHaveLength(ROOM_CODE_LENGTH);
    expect(room.state.roomCode).toMatch(alphabetPattern);
    room.onDispose();
  });

  it("two concurrently created rooms never share a code", () => {
    const N = 12;
    const rooms: HotelRoom[] = [];
    for (let i = 0; i < N; i++) {
      const room = new HotelRoom();
      room.onCreate({});
      rooms.push(room);
    }
    const codes = rooms.map((r) => r.state.roomCode);
    expect(new Set(codes).size).toBe(N);
    expect(roomCodeRegistry.size).toBe(N);
    for (const room of rooms) room.onDispose();
  });

  it("onDispose releases the code back to the registry", () => {
    const roomA = new HotelRoom();
    roomA.onCreate({});
    const codeA = roomA.state.roomCode;
    expect(roomCodeRegistry.has(codeA)).toBe(true);

    const roomB = new HotelRoom();
    roomB.onCreate({});

    roomB.onDispose();
    expect(roomCodeRegistry.has(roomB.state.roomCode)).toBe(false);
    expect(roomCodeRegistry.size).toBe(1);

    // a subsequent acquire must not collide with still-live rooms
    const freshAcquire = roomCodeRegistry.acquire();
    expect(freshAcquire).not.toBe(codeA);

    roomA.onDispose();
    expect(roomCodeRegistry.has(codeA)).toBe(false);
    roomCodeRegistry.release(freshAcquire);
    expect(roomCodeRegistry.size).toBe(0);
  });

  it("acquire retries past collisions until unique, release is idempotent", () => {
    const registry = new RoomCodeRegistry();
    const aIdx = ROOM_CODE_ALPHABET.indexOf("A");
    const bIdx = ROOM_CODE_ALPHABET.indexOf("B");
    // calls 1..4 draw 'A' (→ "AAAA"), calls 5..8 draw 'A' again (a live
    // collision), calls 9+ draw 'B' (→ "BBBB")
    let calls = 0;
    const rand = (): number => {
      calls++;
      const idx = calls <= 2 * ROOM_CODE_LENGTH ? aIdx : bIdx;
      return (idx + 0.5) / ROOM_CODE_ALPHABET.length;
    };

    const first = registry.acquire(rand);
    expect(first).toBe("AAAA");
    expect(registry.has(first)).toBe(true);

    const second = registry.acquire(rand);
    expect(second).toBe("BBBB");
    expect(registry.size).toBe(2);

    // idempotent release
    registry.release(first);
    registry.release(first);
    expect(registry.has(first)).toBe(false);
    expect(registry.size).toBe(1);
  });

  it("acquire throws after its bounded attempts when no unique code exists", () => {
    const registry = new RoomCodeRegistry();
    registry.acquire(fixedCharRand(ROOM_CODE_ALPHABET.indexOf("Z")));
    const doomedRand = fixedCharRand(ROOM_CODE_ALPHABET.indexOf("Z"));
    expect(() => registry.acquire(doomedRand)).toThrowError(
      "room-code-exhausted",
    );
  });

  it("uniqueness holds across sequential create/dispose cycles", () => {
    const liveRooms: HotelRoom[] = [];
    for (let cycle = 0; cycle < 6; cycle++) {
      const room = new HotelRoom();
      room.onCreate({});
      liveRooms.push(room);

      // every currently-live room's code must be pairwise distinct
      const liveCodes = liveRooms.map((r) => r.state.roomCode);
      expect(new Set(liveCodes).size).toBe(liveCodes.length);
      expect(roomCodeRegistry.size).toBe(liveRooms.length);

      // dispose the oldest room each cycle
      const leaving = liveRooms.shift()!;
      leaving.onDispose();
      expect(roomCodeRegistry.has(leaving.state.roomCode)).toBe(false);
      expect(roomCodeRegistry.size).toBe(liveRooms.length);
    }
    for (const room of liveRooms) room.onDispose();
    expect(roomCodeRegistry.size).toBe(0);
  });

  it("generateRoomCode is deterministic for a seeded rand", () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(generateRoomCode(lcg(seed))).toBe(generateRoomCode(lcg(seed)));
    }
    // different seeds produce different streams in practice
    expect(generateRoomCode(lcg(1))).not.toBe(generateRoomCode(lcg(2)));
  });
});
