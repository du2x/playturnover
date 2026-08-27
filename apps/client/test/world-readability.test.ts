import { describe, it, expect } from "vitest";
import { AVATAR_COLORS, FLOOR_COUNT, FLOOR_TINTS } from "@grandhotel/shared";
import {
  deriveAvatarVisuals,
  FLOOR_TINT_HEXES,
  MARKER_COLORS,
  parseHexColor,
} from "../src/game/avatarIdentity.js";

describe("world readability (V-7)", () => {
  it("FLOOR_TINT_HEXES has FLOOR_COUNT + 1 distinct values matching shared FLOOR_TINTS", () => {
    expect(FLOOR_TINT_HEXES.length).toBe(FLOOR_COUNT + 1);
    expect(FLOOR_TINT_HEXES.length).toBe(FLOOR_TINTS.length);
    const distinct = new Set(FLOOR_TINT_HEXES);
    expect(distinct.size).toBe(FLOOR_TINT_HEXES.length);
    for (let i = 0; i < FLOOR_TINTS.length; i++) {
      expect(FLOOR_TINT_HEXES[i]).toBe(parseHexColor(FLOOR_TINTS[i]));
    }
  });

  it("MARKER_COLORS preserves the legacy state colors", () => {
    expect(MARKER_COLORS.roomPrepped).toBe(0x2a9d2a);
    expect(MARKER_COLORS.roomTrashed).toBe(0xb00020);
    expect(MARKER_COLORS.trashFresh).toBe(0xff2020);
    expect(MARKER_COLORS.trashSettled).toBe(0x666666);
    expect(MARKER_COLORS.doorCard).toBe(0xd9a03c);
    expect(MARKER_COLORS.elevatorButton).toBe(0x448844);
  });

  it("deriveAvatarVisuals returns the AVATAR_COLORS entry for the given colorIndex", () => {
    for (let idx = 0; idx < AVATAR_COLORS.length; idx++) {
      expect(deriveAvatarVisuals("alice", idx).colorHex).toBe(
        AVATAR_COLORS[idx],
      );
    }
    // Out-of-range indices wrap by modulo
    expect(deriveAvatarVisuals("alice", AVATAR_COLORS.length).colorHex).toBe(
      AVATAR_COLORS[0],
    );
    expect(deriveAvatarVisuals("alice", AVATAR_COLORS.length + 3).colorHex).toBe(
      AVATAR_COLORS[3],
    );
  });

  it("deriveAvatarVisuals returns the uppercased first character of the trimmed name", () => {
    expect(deriveAvatarVisuals("alice", 0).initial).toBe("A");
    expect(deriveAvatarVisuals(" bob ", 0).initial).toBe("B");
    expect(deriveAvatarVisuals("zoe", 0).initial).toBe("Z");
  });

  it("deriveAvatarVisuals falls back to ? when the name is empty", () => {
    expect(deriveAvatarVisuals("", 0).initial).toBe("?");
    expect(deriveAvatarVisuals("   ", 0).initial).toBe("?");
  });

  it("deriveAvatarVisuals distinguishes two players with different colorIndex/name", () => {
    const a = deriveAvatarVisuals("alice", 0);
    const b = deriveAvatarVisuals("bob", 1);
    expect(a.colorHex).not.toBe(b.colorHex);
    expect(a.initial).not.toBe(b.initial);
    // Same name, different seat → same initial, different color
    const c = deriveAvatarVisuals("bob", 4);
    expect(c.initial).toBe(b.initial);
    expect(c.colorHex).not.toBe(b.colorHex);
  });
});
