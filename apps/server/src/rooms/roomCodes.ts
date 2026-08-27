import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "@grandhotel/shared";

/** Bounded retry budget when drawing a unique short code. */
const MAX_ACQUIRE_ATTEMPTS = 64;

/**
 * Pure: draws exactly ROOM_CODE_LENGTH characters from ROOM_CODE_ALPHABET
 * using the provided rand source (deterministic for a seeded rand).
 */
export function generateRoomCode(rand: () => number): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const index = Math.floor(rand() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[index];
  }
  return code;
}

/**
 * Tracks which short codes belong to live rooms. One instance per process is
 * the single source of uniqueness (module-scope `roomCodeRegistry` below).
 */
export class RoomCodeRegistry {
  private liveCodes = new Set<string>();

  /** Generate a code and retry against the live set until unique. */
  acquire(rand: () => number = Math.random): string {
    for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt++) {
      const code = generateRoomCode(rand);
      if (!this.liveCodes.has(code)) {
        this.liveCodes.add(code);
        return code;
      }
    }
    throw new Error("room-code-exhausted");
  }

  /** Idempotent — releasing an unknown or already-released code is a no-op. */
  release(code: string): void {
    this.liveCodes.delete(code);
  }

  has(code: string): boolean {
    return this.liveCodes.has(code);
  }

  get size(): number {
    return this.liveCodes.size;
  }

  /** For tests: reset the live set entirely. */
  clearAll(): void {
    this.liveCodes.clear();
  }
}

/** Single process = single source of uniqueness. */
export const roomCodeRegistry = new RoomCodeRegistry();
