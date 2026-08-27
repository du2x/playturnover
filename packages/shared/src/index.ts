export * from "./constants.js";
export * from "./state.js";
export * from "./messages.js";
export * from "./topology.js";

// Legacy placeholder — kept for M0.1.1 skeleton compatibility.
export const PLACEHOLDER = "shared-placeholder";
export function placeholder(): string {
  return PLACEHOLDER;
}
