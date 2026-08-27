import { PREP_TIME_MS, UNPREP_TIME_MS } from "@grandhotel/shared";
import type { ChannelType, RoomStateType } from "@grandhotel/shared";

/**
 * A single active channel for one player.
 * Server-only runtime state — not replicated to clients except as a progress projection.
 */
export interface Channel {
  type: ChannelType;
  roomId: string;
  startedAt: number;
  endsAt: number;
}

/**
 * Error reasons returned by startChannel validation.
 */
export type ChannelStartError =
  | "not-playing"
  | "not-inside-room"
  | "wrong-state"
  | "not-saboteur"
  | "already-channeling";

/**
 * Validation result for attempting to start a channel.
 */
export type ChannelOk = {
  ok: true;
  channel: Channel;
};
export type ChannelFail = {
  ok: false;
  reason: ChannelStartError;
};
export type ChannelStartResult = ChannelOk | ChannelFail;

/**
 * Pure helper: decide whether a channel may start.
 *
 * Preconditions checked:
 * - phase === "playing"
 * - player is inside the requested room
 * - prep: room state must be clean
 * - unprep: caller is saboteur and room state is prepped or trashed
 * - fake: caller is saboteur (any room state)
 *
 * `now` is the current wall time supplied by the caller, so this function is
 * fully pure (no time reads inside).
 */
export function canStartChannel(
  type: ChannelType,
  roomId: string,
  sessionId: string,
  isInsideRoom: boolean,
  phase: "waiting" | "playing" | "results",
  roomState: RoomStateType,
  isSaboteur: boolean,
  alreadyChanneling: boolean,
  now: number,
): ChannelStartResult {
  if (phase !== "playing") {
    return { ok: false, reason: "not-playing" };
  }

  if (alreadyChanneling) {
    return { ok: false, reason: "already-channeling" };
  }

  if (!isInsideRoom) {
    return { ok: false, reason: "not-inside-room" };
  }

  if (type === "prep") {
    if (roomState !== "clean") {
      return { ok: false, reason: "wrong-state" };
    }
  } else if (type === "unprep") {
    if (!isSaboteur) {
      return { ok: false, reason: "not-saboteur" };
    }
    if (roomState !== "prepped" && roomState !== "trashed") {
      return { ok: false, reason: "wrong-state" };
    }
  } else if (type === "fake") {
    if (!isSaboteur) {
      return { ok: false, reason: "not-saboteur" };
    }
  }

  const duration = type === "unprep" ? UNPREP_TIME_MS : PREP_TIME_MS;
  return {
    ok: true,
    channel: {
      type,
      roomId,
      startedAt: now,
      endsAt: now + duration,
    },
  };
}

/**
 * Pure helper: compute the new room state after a channel completes.
 * Returns the original state for fake-prep and unchanged cases.
 *
 * Caller must verify completion preconditions (still inside, same floor,
 * channel still active) before invoking this.
 */
export function applyChannelCompletion(
  type: ChannelType,
  roomState: RoomStateType,
): RoomStateType {
  if (type === "prep" && roomState === "clean") {
    return "prepped";
  }
  if (type === "unprep" && (roomState === "prepped" || roomState === "trashed")) {
    return "trashed";
  }
  // fake-prep leaves the room state unchanged
  return roomState;
}
