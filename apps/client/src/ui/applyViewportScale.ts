import { VIEWPORT_MIN_WIDTH_PX } from "@grandhotel/shared";
import { computeViewportScale } from "./viewportScale.js";

const MESSAGE_ID = "viewport-floor-message";

export interface ViewportScaleApplied {
  scale: number;
  belowFloor: boolean;
}

/**
 * DOM-side half of V-6 (M4.2.3 owns the pure computation):
 * - sets the `--gh-scale` custom property on `root` (consumed by #app's CSS
 *   transform, and — being inside #app's coordinate space — by #overlay),
 * - toggles the `#viewport-floor-message` visibility flag when the viewport
 *   is below the floor (element is created under `root` if missing).
 */
export function applyViewportScale(
  root: HTMLElement,
  viewportWidthPx: number,
): ViewportScaleApplied {
  const { scale, belowFloor, fitWidthPx } =
    computeViewportScale(viewportWidthPx);
  root.style.setProperty("--gh-scale", String(scale));
  // Layout hint sized to fitWidthPx so the scaled stage leaves no dead zone.
  root.style.setProperty("--gh-fit-width", `${fitWidthPx}px`);

  let message = document.getElementById(MESSAGE_ID);
  if (!message) {
    message = document.createElement("div");
    message.id = MESSAGE_ID;
    root.append(message);
  }
  message.textContent = `Window too small — widen to at least ${VIEWPORT_MIN_WIDTH_PX}px`;
  message.hidden = !belowFloor;

  return { scale, belowFloor };
}
