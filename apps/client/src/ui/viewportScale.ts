import {
  STAGE_HEIGHT_PX,
  STAGE_WIDTH_PX,
  VIEWPORT_MIN_WIDTH_PX,
} from "@grandhotel/shared";

/** Re-exports for consumers (M4.4.2 wiring); sourced from @grandhotel/shared. */
export const VIEW_DESIGN_WIDTH_PX = STAGE_WIDTH_PX;
export const VIEW_DESIGN_HEIGHT_PX = STAGE_HEIGHT_PX;

export interface ViewportScale {
  scale: number;
  belowFloor: boolean;
  fitWidthPx: number;
}

/**
 * Pure viewport scale computation — no Phaser, no DOM.
 * - >= STAGE_WIDTH_PX: scale 1
 * - between the floor (VIEWPORT_MIN_WIDTH_PX) and design width: proportional viewportWidthPx / STAGE_WIDTH_PX
 * - below the floor: belowFloor = true, scale clamped to the floor ratio
 */
export function computeViewportScale(viewportWidthPx: number): ViewportScale {
  const belowFloor = viewportWidthPx < VIEWPORT_MIN_WIDTH_PX;
  const rawScale =
    viewportWidthPx >= STAGE_WIDTH_PX
      ? 1
      : viewportWidthPx / STAGE_WIDTH_PX;
  const minScale = VIEWPORT_MIN_WIDTH_PX / STAGE_WIDTH_PX;
  const scale = Math.max(rawScale, minScale);
  return { scale, belowFloor, fitWidthPx: Math.round(scale * STAGE_WIDTH_PX) };
}
