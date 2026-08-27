import {
  AVATAR_COLORS,
  FLOOR_TINTS,
} from "@grandhotel/shared";

/**
 * Parses a hex color string ("#RRGGBB" or "RRGGBB") into a Phaser color number.
 * Moved here from HallScene.ts (M4.2.2) so this module is the single owner.
 */
export function parseHexColor(hex: string): number {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return Number.parseInt(h, 16);
}

/** Per-floor hallway strip tints parsed from shared FLOOR_TINTS (index 0 = lobby). */
export const FLOOR_TINT_HEXES: readonly number[] = FLOOR_TINTS.map(parseHexColor);

/**
 * Legacy room-state / evidence marker colors preserved from HallScene.ts
 * (M4.2.2 — readability pass must not change any state color).
 */
export const MARKER_COLORS = {
  /** Room state: prepped tint overlay green. */
  roomPrepped: 0x2a9d2a,
  /** Room state: trashed tint overlay red. */
  roomTrashed: 0xb00020,
  /** Trash freshness marker when fresh. */
  trashFresh: 0xff2020,
  /** Trash freshness marker when settled. */
  trashSettled: 0x666666,
  /** Door status card marker. */
  doorCard: 0xd9a03c,
  /** Elevator call button green. */
  elevatorButton: 0x448844,
} as const;

export interface AvatarVisuals {
  /** Avatar body fill color from shared AVATAR_COLORS (colorIndex is always in range). */
  colorHex: string;
  /** Uppercased first character of the trimmed name; "?" when the name is empty. */
  initial: string;
}

/**
 * Pure derivation of an avatar's visual identity from player name + color index.
 */
export function deriveAvatarVisuals(
  name: string,
  colorIndex: number,
): AvatarVisuals {
  const colorHex = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];
  const trimmed = name.trim();
  const initial =
    trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "?";
  return { colorHex, initial };
}
