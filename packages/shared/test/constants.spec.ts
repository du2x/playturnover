import { describe, it, expect } from "vitest";
import {
  MAX_PLAYERS,
  SHIFT_LENGTH_S,
  PREP_TIME_MS,
  UNPREP_TIME_MS,
  COVERAGE_TARGET,
  FRESHNESS_WINDOW_MS,
  ELEVATOR_ARRIVE_MS,
  ELEVATOR_RIDE_MS,
  ELEVATOR_CAPACITY,
  ACCUSATION_RANGE_TILES,
  RUSTLE_RANGE_TILES,
  ROOM_CODE_LENGTH,
  ROOM_CODE_ALPHABET,
  TILE_SIZE_PX,
  HALLWAY_MIN_X,
  HALLWAY_MAX_X,
  HALLWAY_Y,
  PLAYER_SPEED_PX_S,
  SERVER_MAX_SPEED_PX_S,
  CLIENT_INPUT_SEND_HZ,
  SERVER_PATCH_RATE_MS,
  INTERP_DELAY_MS,
  AVATAR_COLORS,
  RESULTS_PLACEHOLDER,
} from "../src/constants.js";

describe("PRD §7 tuning constants (V-2)", () => {
  it("MAX_PLAYERS = 6", () => {
    expect(MAX_PLAYERS).toBe(6);
  });

  it("shift length 5:00 = 300s", () => {
    expect(SHIFT_LENGTH_S).toBe(300);
  });

  it("prep 5s / un-prep 3s", () => {
    expect(PREP_TIME_MS).toBe(5000);
    expect(UNPREP_TIME_MS).toBe(3000);
  });

  it("coverage target 80%", () => {
    expect(COVERAGE_TARGET).toBe(0.8);
  });

  it("freshness window 75s", () => {
    expect(FRESHNESS_WINDOW_MS).toBe(75_000);
  });

  it("elevator arrive 3s / ride 2s / cap 2", () => {
    expect(ELEVATOR_ARRIVE_MS).toBe(3000);
    expect(ELEVATOR_RIDE_MS).toBe(2000);
    expect(ELEVATOR_CAPACITY).toBe(2);
  });

  it("accusation ~2 tiles", () => {
    expect(ACCUSATION_RANGE_TILES).toBe(2);
  });

  it("rustle ~3 tiles", () => {
    expect(RUSTLE_RANGE_TILES).toBe(3);
  });

  it("tile and hallway free variables exist with plan values", () => {
    expect(TILE_SIZE_PX).toBe(32);
    expect(HALLWAY_MIN_X).toBe(96);
    expect(HALLWAY_MAX_X).toBe(864);
    expect(HALLWAY_Y).toBe(120);
    expect(PLAYER_SPEED_PX_S).toBe(220);
    expect(SERVER_MAX_SPEED_PX_S).toBe(330);
    expect(CLIENT_INPUT_SEND_HZ).toBe(20);
    expect(SERVER_PATCH_RATE_MS).toBe(80);
    expect(INTERP_DELAY_MS).toBe(100);
  });

  it("room code alphabet and length free variables", () => {
    expect(ROOM_CODE_LENGTH).toBe(4);
    expect(ROOM_CODE_ALPHABET).toBe("ABCDEFGHJKMNPQRSTUVWXYZ23456789");
  });

  it("avatar colors — 6 distinct hex colors", () => {
    expect(AVATAR_COLORS.length).toBe(6);
    const set = new Set(AVATAR_COLORS);
    expect(set.size).toBe(6);
    for (const c of AVATAR_COLORS) {
      expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("results placeholder is null (no winner/traitor in M0)", () => {
    expect(RESULTS_PLACEHOLDER).toBeNull();
  });
});
