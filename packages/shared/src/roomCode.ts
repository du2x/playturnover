import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./constants.js";

/**
 * Pure room-code generator. Returns ROOM_CODE_LENGTH characters drawn from
 * ROOM_CODE_ALPHABET. Accepts an rng for deterministic testing.
 */
export function generateRoomCode(rng: () => number = Math.random): string {
  let code = "";
  const alphabet = ROOM_CODE_ALPHABET;
  const n = alphabet.length;
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const idx = Math.floor(rng() * n);
    code += alphabet[idx] ?? alphabet[0];
  }
  return code;
}
