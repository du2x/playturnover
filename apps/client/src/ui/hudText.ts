import { HUD_NAME_MAX_CHARS } from "@grandhotel/shared";

/**
 * Presentation-only name truncation for HUD surfaces (roster chips, results
 * reveal). Never used where names feed rule-bearing logic — identity runs on
 * session ids server-side.
 */
export function truncateName(
  name: string,
  maxChars: number = HUD_NAME_MAX_CHARS,
): string {
  if (name.length <= maxChars) return name;
  return `${name.slice(0, maxChars)}…`;
}
