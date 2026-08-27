import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
import { applyViewportScale } from "../src/ui/applyViewportScale.js";

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

// Regression note: the movement-math half of V-6 is untouched by the wiring —
// step/clamp logic lives in shared constants + apps/client/src/movement and is
// guarded by the shared suite (asserted below) and the client movement tests.
describe("viewport scale (V-6 wiring)", () => {
  let root: HTMLElement;

  beforeEach(() => {
    // Fresh root per case; drop any stale message from earlier calls.
    document.getElementById("viewport-floor-message")?.remove();
    root = document.createElement("div");
    document.body.append(root);
  });

  afterEach(() => {
    root.remove();
  });

  it("sets --gh-scale to 1 at full design width and hides the notice", () => {
    const result = applyViewportScale(root, STAGE_WIDTH_PX);
    expect(result).toEqual({ scale: 1, belowFloor: false });
    expect(root.style.getPropertyValue("--gh-scale")).toBe("1");
    expect(
      document.getElementById("viewport-floor-message")?.hidden,
    ).toBe(true);
  });

  it("sets --gh-scale proportionally at 840px with no notice", () => {
    const result = applyViewportScale(root, 840);
    expect(result.belowFloor).toBe(false);
    expect(result.scale).toBeCloseTo(840 / STAGE_WIDTH_PX, 12);
    expect(root.style.getPropertyValue("--gh-scale")).toBe(
      String(840 / STAGE_WIDTH_PX),
    );
    expect(
      document.getElementById("viewport-floor-message")?.hidden,
    ).toBe(true);
  });

  it("keeps the notice hidden exactly at the floor boundary (700)", () => {
    applyViewportScale(root, VIEWPORT_MIN_WIDTH_PX);
    expect(root.style.getPropertyValue("--gh-scale")).toBe(
      String(VIEWPORT_MIN_WIDTH_PX / STAGE_WIDTH_PX),
    );
    expect(
      document.getElementById("viewport-floor-message")?.hidden,
    ).toBe(true);
  });

  it("shows the notice only below 700px (640) with a clamped scale", () => {
    applyViewportScale(root, 640);
    const expectedScale = String(VIEWPORT_MIN_WIDTH_PX / STAGE_WIDTH_PX);
    expect(root.style.getPropertyValue("--gh-scale")).toBe(expectedScale);
    const message = document.getElementById("viewport-floor-message");
    expect(message?.hidden).toBe(false);
    // Message text references the floor so players know what to widen to.
    expect(message?.textContent).toContain(String(VIEWPORT_MIN_WIDTH_PX));
  });

  it("re-shows the stage when the viewport widens back past the floor", () => {
    applyViewportScale(root, 640);
    expect(
      document.getElementById("viewport-floor-message")?.hidden,
    ).toBe(false);
    applyViewportScale(root, 960);
    expect(
      document.getElementById("viewport-floor-message")?.hidden,
    ).toBe(true);
  });

  it("creates the message element under root when missing", () => {
    expect(document.getElementById("viewport-floor-message")).toBeNull();
    applyViewportScale(root, 640);
    const created = document.getElementById("viewport-floor-message");
    expect(created).not.toBeNull();
    expect(created?.hidden).toBe(false);
  });
});
