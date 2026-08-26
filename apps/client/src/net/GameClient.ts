/** Escape-hatch interface per techstack §7 — client transport behind GameClient. */

// Bonus branded id/name types (plain string at runtime)
export type SessionId = string;
export type DisplayName = string;
export type RoomCode = string;

export type Phase = "waiting" | "playing" | "results";

export interface RoomStateView {
  players: Array<{
    id: SessionId;
    name: string;
    colorIndex: number;
    x: number;
  }>;
  phase: Phase;
  mySessionId: SessionId;
  hostSessionId: SessionId;
}

export type ClientEvent =
  | { type: "rejected"; reason: string }
  | { type: "error"; message: string }
  | { type: "left"; code?: number };

export type Unsubscribe = () => void;

export type MoveMsg = { dx: number; dy: number; seq: number };

export interface GameClient {
  connect(name: DisplayName): Promise<void>;
  createRoom(): Promise<string>;
  joinByCode(code: RoomCode): Promise<void>;
  sendMove(msg: MoveMsg): void;
  advancePhase(): void;
  onState(cb: (s: RoomStateView) => void): Unsubscribe;
  onEvent(cb: (e: ClientEvent) => void): Unsubscribe;
  disconnect(): void;
}
