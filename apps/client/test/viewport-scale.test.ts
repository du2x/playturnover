import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  STAGE_WIDTH_PX,
  STAGE_HEIGHT_PX,
  VIEWPORT_MIN_WIDTH_PX,
} from "@grandhotel/shared";
import {
  computeViewportScale,
  VIEW_DESIGN_WIDTH_PX,
  VIEW_DESIGN_HEIGHT_PX,
} from "../src/ui/viewportScale.js";

describe("viewport scale (V-6)", () => {
  it("full size: scale 1 and fitWidth 960 at exactly 960", () => {
    const r = computeViewportScale(960);
    expect(r.scale).toBe(1);
    expect(r.belowFloor).toBe(false);
    expect(r.fitWidthPx).toBe(960);
  });

  it("full size: scale stays 1 above design width (no upscaling)", () => {
    for (const w of [1000, 1400, 3840]) {
      const r = computeViewportScale(w);
      expect(r.scale).toBe(1);
      expect(r.belowFloor).toBe(false);
      expect(r.fitWidthPx).toBe(STAGE_WIDTH_PX);
    }
  });

  it("mid band is proportional to the viewport width (840 → 840/960)", () => {
    const r = computeViewportScale(840);
    expect(r.belowFloor).toBe(false);
    expect(r.scale).toBeCloseTo(840 / STAGE_WIDTH_PX, 12);
    expect(r.fitWidthPx).toBe(840);
  });

  it("mid band proportionality holds across several widths", () => {
    for (const w of [720, 800, 901]) {
      const r = computeViewportScale(w);
      expect(r.belowFloor).toBe(false);
      expect(r.scale).toBeCloseTo(w / STAGE_WIDTH_PX, 12);
      expect(r.fitWidthPx).toBe(Math.round((w / STAGE_WIDTH_PX) * STAGE_WIDTH_PX));
    }
  });

  it("boundary: exactly at the floor (700) is not below-floor, proportional scale", () => {
    const r = computeViewportScale(VIEWPORT_MIN_WIDTH_PX);
    expect(r.belowFloor).toBe(false);
    expect(r.scale).toBeCloseTo(
      VIEWPORT_MIN_WIDTH_PX / STAGE_WIDTH_PX,
      12,
    );
    expect(r.fitWidthPx).toBe(VIEWPORT_MIN_WIDTH_PX);
  });

  it("boundary: 699 is below-floor with clamped scale", () => {
    const r = computeViewportScale(699);
    expect(r.belowFloor).toBe(true);
    expect(r.scale).toBeCloseTo(
      VIEWPORT_MIN_WIDTH_PX / STAGE_WIDTH_PX,
      12,
    );
    expect(r.fitWidthPx).toBe(Math.round((VIEWPORT_MIN_WIDTH_PX / STAGE_WIDTH_PX) * STAGE_WIDTH_PX));
  });

  it("below floor (640): belowFloor true, scale clamped at the floor ratio", () => {
    const r = computeViewportScale(640);
    expect(r.belowFloor).toBe(true);
    expect(r.scale).toBeCloseTo(
      VIEWPORT_MIN_WIDTH_PX / STAGE_WIDTH_PX,
      12,
    );
    // clamped — never smaller than the floor-derived minimum
    expect(computeViewportScale(0).scale).toBeCloseTo(
      VIEWPORT_MIN_WIDTH_PX / STAGE_WIDTH_PX,
      12,
    );
    expect(computeViewportScale(0).fitWidthPx).toBe(VIEWPORT_MIN_WIDTH_PX);
  });

  it("re-exported design constants mirror shared stage constants", () => {
    expect(VIEW_DESIGN_WIDTH_PX).toBe(STAGE_WIDTH_PX);
    expect(VIEW_DESIGN_HEIGHT_PX).toBe(STAGE_HEIGHT_PX);
  });

  it("imports constants from @grandhotel/shared rather than redefining them", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/ui/viewportScale.ts"),
      "utf8",
    );
    expect(source).toContain('from "@grandhotel/shared"');
  });
});
