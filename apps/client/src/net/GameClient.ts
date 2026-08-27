/** Escape-hatch interface per techstack §7 — client transport behind GameClient. */

// Bonus branded id/name types (plain string at runtime)
export type SessionId = string;
export type DisplayName = string;
export type RoomCode = string;

// Unions are single-sourced in @grandhotel/shared; re-exported here for the
// transport surface (ColyseusGameClient imports them from this module).
import type {
  ChannelType,
  ElevatorShaft,
  ElevatorStatus,
  Phase,
  RoleType,
  RoomStateType,
} from "@grandhotel/shared";

export type {
  ChannelType,
  ElevatorShaft,
  ElevatorStatus,
  Phase,
  RoleType,
  RoomStateType,
} from "@grandhotel/shared";

export interface RoomStateView {
  players: Array<{
    id: SessionId;
    name: string;
    colorIndex: number;
    x: number;
    floor: number;
  }>;
  phase: Phase;
  mySessionId: SessionId;
  hostSessionId: SessionId;
  myRole: RoleType | null;
  myFloor: number;
  roomsView: Record<string, RoomStateType | null>;
  elevatorsView: Record<ElevatorShaft, { floor: number; state: ElevatorStatus }>;
  shiftEndsAt: number | null;
  winner: RoleType | null;
  traitorReveal: { sessionId: SessionId; name: string } | null;
}

export type ClientEvent =
  | { type: "rejected"; reason: string }
  | { type: "error"; message: string; reason?: string }
  | { type: "left"; code?: number };

export type Unsubscribe = () => void;

export type MoveMsg = { dx: number; dy: number; seq: number };

export interface GameClient {
  connect(name: DisplayName): Promise<void>;
  createRoom(): Promise<string>;
  joinByCode(code: RoomCode): Promise<void>;
  sendMove(msg: MoveMsg): void;
  startRound(): void;
  callElevator(shaft: ElevatorShaft): void;
  rideElevator(shaft: ElevatorShaft, destFloor: number): void;
  startChannel(type: ChannelType, roomId: string): void;
  cancelChannel(): void;
  /** @deprecated M0 advancePhase alias; prefer startRound() */
  advancePhase(): void;
  onState(cb: (s: RoomStateView) => void): Unsubscribe;
  onEvent(cb: (e: ClientEvent) => void): Unsubscribe;
  disconnect(): void;
}
