import { z } from "zod";

// ── Inbound RPCs (client → server) ──────────────────────────────────────────

/** Client movement message. M1 adds optional floor (ignored, y invariant). */
export const MoveMsgSchema = z
  .object({
    dx: z.number(),
    dy: z.number(),
    seq: z.number().int().nonnegative(),
    floor: z.number().int().min(0).max(3).optional(),
  })
  .strict();
export type MoveMsg = z.infer<typeof MoveMsgSchema>;

/** Host advances lifecycle phase (M0 legacy). */
export const AdvancePhaseMsgSchema = z.object({}).strict();
export type AdvancePhaseMsg = z.infer<typeof AdvancePhaseMsgSchema>;

/** M1 — host starts round when ≥4 players. */
export const StartRoundMsgSchema = z.object({}).strict();
export type StartRoundMsg = z.infer<typeof StartRoundMsgSchema>;

/** M1 — call elevator shaft. */
export const CallElevatorMsgSchema = z
  .object({
    shaft: z.enum(["A", "B"]),
  })
  .strict();
export type CallElevatorMsg = z.infer<typeof CallElevatorMsgSchema>;

/** M1 — ride elevator to destination floor. */
export const RideElevatorMsgSchema = z
  .object({
    shaft: z.enum(["A", "B"]),
    destFloor: z.number().int().min(0).max(3),
  })
  .strict();
export type RideElevatorMsg = z.infer<typeof RideElevatorMsgSchema>;

/** M1 — start channel (prep/unprep/fake) inside a room. */
export const ChannelStartMsgSchema = z
  .object({
    type: z.enum(["prep", "unprep", "fake"]),
    roomId: z.string().min(1),
  })
  .strict();
export type ChannelStartMsg = z.infer<typeof ChannelStartMsgSchema>;

/** M1 — explicit channel cancel. */
export const ChannelCancelMsgSchema = z.object({}).strict();
export type ChannelCancelMsg = z.infer<typeof ChannelCancelMsgSchema>;

// ── Outbound events (server → client) ───────────────────────────────────────

/** Broadcast when phase changes. */
export const PhaseChangedSchema = z.object({
  phase: z.enum(["waiting", "playing", "results"]),
});
export type PhaseChanged = z.infer<typeof PhaseChangedSchema>;

/** Join rejection reason. */
export const JoinRejectedSchema = z.object({
  reason: z.enum(["full", "bad-name"]),
});
export type JoinRejected = z.infer<typeof JoinRejectedSchema>;

/** M1 — private role assignment (server → owner only). */
export const RoleMsgSchema = z
  .object({
    role: z.enum(["staff", "saboteur"]),
  })
  .strict();
export type RoleMsg = z.infer<typeof RoleMsgSchema>;

/** M1 — results broadcast (winner + traitor reveal). */
export const ResultsMsgSchema = z
  .object({
    winner: z.enum(["staff", "saboteur"]),
    traitorReveal: z.object({
      sessionId: z.string(),
      name: z.string(),
    }),
    coverage: z.number().min(0).max(1),
  })
  .strict();
export type ResultsMsg = z.infer<typeof ResultsMsgSchema>;
