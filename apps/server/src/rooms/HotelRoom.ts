import { Room } from "../colyseus-compat.js";
import type { Client } from "colyseus";
import {
  ELEVATOR_ARRIVE_MS,
  ELEVATOR_INTERACT_RADIUS,
  ELEVATOR_RIDE_MS,
  HALLWAY_MAX_X,
  HALLWAY_MIN_X,
  LOBBY_CENTER,
  MAX_MOVE_DT_S,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROOM_CODE_LENGTH,
  ROOM_COUNT,
  SERVER_MAX_SPEED_PX_S,
  SERVER_PATCH_RATE_MS,
  SHIFT_LENGTH_S,
} from "@grandhotel/shared";
import {
  ElevatorCar,
  PlayerState,
  RoomData,
  RoomState,
  TraitorReveal,
} from "@grandhotel/shared";
import {
  CallElevatorMsgSchema,
  ChannelCancelMsgSchema,
  ChannelStartMsgSchema,
  MoveMsgSchema,
  RideElevatorMsgSchema,
  StartRoundMsgSchema,
} from "@grandhotel/shared";
import { getAllRoomIds, getRoomRect, getElevatorX } from "@grandhotel/shared";
import { isInsideRoom } from "@grandhotel/shared";
import type { RoomStateType } from "@grandhotel/shared";
import {
  callElevator,
  completeRide,
  createElevatorState,
  removeRiderFromCar,
  resetElevatorState,
  startNextCycle,
  tickArrival,
  tryRideElevator,
} from "../elevator.js";
import type { ElevatorCarState } from "../elevator.js";
import { canStartChannel, applyChannelCompletion } from "../channels.js";
import type { Channel } from "../channels.js";
import { attritionWinner, beginShift, computeCoverage, coverageWinner } from "../shift.js";
import type { Clock } from "../time.js";
import { ColyseusClock } from "../time.js";
import type { Cancel } from "../time.js";

// ── movement helpers ────────────────────────────────────────────────────────

/**
 * Server-side clamp: newX = lastX + clamp(dx, ±SERVER_MAX_SPEED_PX_S*dt)
 * then hard-clamped to hallway bounds. Pure, exported for unit tests.
 */
export function computeClampedX(
  currentX: number,
  dx: number,
  dtSec: number,
): number {
  const maxDelta = SERVER_MAX_SPEED_PX_S * Math.max(0, dtSec);
  const clampedDx = Math.max(-maxDelta, Math.min(maxDelta, dx));
  const newX = currentX + clampedDx;
  return Math.max(HALLWAY_MIN_X, Math.min(HALLWAY_MAX_X, newX));
}

// ── room ────────────────────────────────────────────────────────────────────

export class HotelRoom extends Room<RoomState> {
  declare state: RoomState;
  declare maxClients: number;
  declare hasReachedMaxClients: () => boolean;
  declare setPatchRate: (ms: number) => void;
  declare setState: (state: RoomState) => void;
  declare onMessage: (type: string, cb: (client: Client, data: unknown) => void) => void;
  private lastMoveAt = new Map<string, number>();
  private clientMap = new Map<string, Client>();
  private saboteurSessionId: string | null = null;
  private roleMap = new Map<string, "staff" | "saboteur">();
  private shiftLengthS: number = SHIFT_LENGTH_S;
  private elevatorRuntime = new WeakMap<ElevatorCar, ElevatorCarState>();
  private activeChannels = new Map<string, Channel>();
  private timers = new Map<string, Cancel>();
  private injectedClock?: Clock;
  private clockAdapter!: Clock;

  constructor(clock?: Clock) {
    super();
    this.injectedClock = clock;
  }

  onCreate(options: unknown): void {
    // Production keeps the behavior-identical Colyseus clock; tests inject a
    // VirtualClock through the constructor.
    this.clockAdapter =
      this.injectedClock ??
      new ColyseusClock(
        this.clock as unknown as {
          setTimeout(cb: () => void, ms: number, ...args: unknown[]): unknown;
          setInterval(cb: () => void, ms: number, ...args: unknown[]): unknown;
          clear(): void;
        },
      );

    // Rooms constructed directly in unit tests bypass the MatchMaker, which is
    // what normally assigns `listing` before onCreate. Stub it so colyseus'
    // dispose path (`listing.remove()` in Room._dispose) is a no-op instead of
    // throwing "Cannot read properties of undefined (reading 'remove')".
    if (!this.listing) {
      this.listing = { remove: () => undefined };
    }

    const opts = options as Record<string, unknown> | null | undefined;
    const override = opts?.["shiftLengthSOverride"];
    if (typeof override === "number" && Number.isFinite(override) && override > 0) {
      this.shiftLengthS = override;
    } else if (
      typeof opts?.["shiftLengthS"] === "number" &&
      Number.isFinite(opts?.["shiftLengthS"]) &&
      (opts?.["shiftLengthS"] as number) > 0
    ) {
      this.shiftLengthS = opts?.["shiftLengthS"] as number;
    } else {
      this.shiftLengthS = SHIFT_LENGTH_S;
    }

    this.maxClients = MAX_PLAYERS;
    this.setPatchRate(SERVER_PATCH_RATE_MS);
    this.setState(new RoomState());
    this.state.phase = "waiting";
    // ensure resultsPayload stays null per R-7
    this.state.resultsPayload = null;
    this.state.hostSessionId = "";
    this.state.shiftEndsAt = 0;
    this.state.winner = null;
    this.state.traitorReveal = null;
    this.state.coverage = 0;

    // building topology — ROOM_COUNT rooms via shared getRoomRect
    const ids = getAllRoomIds();
    // assert single source of truth for room count
    void ROOM_COUNT;
    for (const id of ids) {
      const rect = getRoomRect(id);
      const rd = new RoomData();
      rd.id = id;
      rd.floor = rect.floor;
      rd.xMin = rect.xMin;
      rd.xMax = rect.xMax;
      rd.state = "clean";
      this.state.rooms.set(id, rd);
    }

    // elevators idle at floor 0 stub for M1.3.1
    const elevatorA = new ElevatorCar();
    elevatorA.shaft = "A";
    elevatorA.floor = 0;
    elevatorA.state = "idle";
    this.state.elevators.set("A", elevatorA);
    const elevatorB = new ElevatorCar();
    elevatorB.shaft = "B";
    elevatorB.floor = 0;
    elevatorB.state = "idle";
    this.state.elevators.set("B", elevatorB);
    this.elevatorRuntime.set(elevatorA, createElevatorState("A"));
    this.elevatorRuntime.set(elevatorB, createElevatorState("B"));

    // drive the Colyseus clock so clock.setTimeout/interval fire deterministically
    this.setSimulationInterval(() => {}, 50);

    this.onMessage("move", (client: Client, data: unknown) => {
      this.handleMove(client, data);
    });

    this.onMessage("startRound", (client: Client, data: unknown) => {
      this.handleStartRound(client, data);
    });

    this.onMessage("callElevator", (client: Client, data: unknown) => {
      this.handleCallElevator(client, data);
    });

    this.onMessage("rideElevator", (client: Client, data: unknown) => {
      this.handleRideElevator(client, data);
    });

    this.onMessage("channelStart", (client: Client, data: unknown) => {
      this.handleChannelStart(client, data);
    });

    this.onMessage("channelCancel", (client: Client, data: unknown) => {
      this.handleChannelCancel(client, data);
    });
  }

  onDispose(): void {
    this.clockAdapter.clearAll();
  }

  private now(): number {
    return this.clockAdapter.now();
  }

  /** Register (or replace) a one-shot timer under a stable key. */
  private schedule(key: string, ms: number, fn: () => void): void {
    const prev = this.timers.get(key);
    if (prev) prev();
    const cancel = this.clockAdapter.setTimeout(ms, fn);
    this.timers.set(key, cancel);
  }

  /** Cancel and drop the timer registered under a stable key. */
  private cancel(key: string): void {
    const c = this.timers.get(key);
    if (c) {
      c();
      this.timers.delete(key);
    }
  }

  async onJoin(client: Client, options?: unknown): Promise<void> {
    const opts = options as Record<string, unknown> | undefined;
    const rawName = opts?.["name"];

    if (
      typeof rawName !== "string" ||
      rawName.trim().length === 0 ||
      rawName.trim().length > MAX_NAME_LENGTH
    ) {
      throw new Error("bad-name");
    }

    if (this.state.players.size >= MAX_PLAYERS) {
      throw new Error("full");
    }

    const name = rawName.trim();
    const colorIndex = this.state.players.size;
    const x = LOBBY_CENTER.x;

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.name = name;
    player.colorIndex = colorIndex;
    player.x = x;
    player.floor = 0;

    this.state.players.set(client.sessionId, player);

    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }

    this.clientMap.set(client.sessionId, client);
    this.lastMoveAt.set(client.sessionId, this.now());
  }

  async onLeave(client: Client, _consented?: boolean): Promise<void> {
    this.state.players.delete(client.sessionId);
    this.lastMoveAt.delete(client.sessionId);
    this.clientMap.delete(client.sessionId);
    this.roleMap.delete(client.sessionId);
    if (this.saboteurSessionId === client.sessionId) {
      this.saboteurSessionId = null;
    }

    for (const car of this.state.elevators.values()) {
      const runtime = this.elevatorRuntime.get(car);
      if (runtime) {
        removeRiderFromCar(runtime, client.sessionId);
        this.syncElevatorCar(car, runtime);
      }
    }

    if (this.state.hostSessionId === client.sessionId) {
      const remaining = [...this.state.players.keys()];
      this.state.hostSessionId = remaining[0] ?? "";
      if (this.state.players.size === 0) {
        this.state.hostSessionId = "";
      }
    }

    if (this.state.phase === "playing") {
      this.checkAttritionWin();
    }
  }

  private handleMove(client: Client, raw: unknown): void {
    const parsed = MoveMsgSchema.safeParse(raw);
    if (!parsed.success) return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const now = this.now();
    const last = this.lastMoveAt.get(client.sessionId) ?? now;
    const dt = Math.min(MAX_MOVE_DT_S, Math.max(0, (now - last) / 1000));

    // ignore dy entirely
    const newX = computeClampedX(player.x, parsed.data.dx, dt);
    player.x = newX;
    this.lastMoveAt.set(client.sessionId, now);

    // walk-out cancels any active channel (R-9)
    this.checkChannelBounds(client.sessionId);
  }

  private checkChannelBounds(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    const channel = this.activeChannels.get(sessionId);
    if (!player || !channel) return;
    if (!isInsideRoom(player.x, player.floor, channel.roomId)) {
      this.cancelChannel(sessionId);
    }
  }

  private handleStartRound(client: Client, raw: unknown): void {
    if (client.sessionId !== this.state.hostSessionId) return;
    const parsed = StartRoundMsgSchema.safeParse(raw ?? {});
    if (!parsed.success) return;

    if (this.state.phase !== "waiting") return;

    if (this.state.players.size < MIN_PLAYERS) {
      const anyClient = client as unknown as { send?: (t: string, d: unknown) => void };
      if (typeof anyClient.send === "function") {
        anyClient.send("error", { reason: "need-4-players" });
      }
      return;
    }

    // success: transition to playing, set shift timer, spawn at lobby, assign roles
    this.state.phase = "playing";

    // lobby gather spawn — all players at lobby center floor 0
    for (const p of this.state.players.values()) {
      p.x = LOBBY_CENTER.x;
      p.floor = 0;
    }

    // secret role assignment — uniformly pick one saboteur
    const ids = [...this.state.players.keys()];
    const { saboteurSessionId, roleBySessionId, endsAt } = beginShift(
      ids,
      Math.random,
      this.now(),
      this.shiftLengthS * 1000,
    );
    this.state.shiftEndsAt = endsAt;
    this.saboteurSessionId = saboteurSessionId;
    this.roleMap.clear();
    for (const [sid, role] of roleBySessionId) {
      this.roleMap.set(sid, role);
      const c = this.clientMap.get(sid);
      const anyC = c as unknown as { send?: (t: string, d: unknown) => void } | undefined;
      if (c && anyC && typeof anyC.send === "function") {
        anyC.send("role", { role });
      }
    }
    // reveal stays null until results — never write role into broadcast map

    this.startShiftTimer();
  }

  /** Starts the 1-second interval that checks for the shift buzzer. */
  private startShiftTimer(): void {
    this.cancel("shift");
    this.timers.set("shift", this.clockAdapter.setInterval(1000, () => this.checkBuzzer()));
  }

  /** Shared path for declaring the end of the round. */
  private endRound(winner: "staff" | "saboteur"): void {
    if (this.state.phase === "results") return;

    const preppedCount = [...this.state.rooms.values()].filter((r) => r.state === "prepped").length;
    this.state.coverage = computeCoverage(preppedCount, ROOM_COUNT);

    this.state.winner = winner;
    this.state.phase = "results";

    if (this.saboteurSessionId) {
      const saboteur = this.state.players.get(this.saboteurSessionId);
      if (saboteur) {
        const reveal = new TraitorReveal();
        reveal.sessionId = this.saboteurSessionId;
        reveal.name = saboteur.name;
        this.state.traitorReveal = reveal;
      } else {
        // Saboteur disconnected; best-effort reveal from private map cache is unavailable,
        // so leave traitorReveal null. Tests that need reveal keep saboteur connected.
        this.state.traitorReveal = null;
      }
    }

    this.cancel("shift");
    this.broadcastResults();
  }

  private checkBuzzer(): void {
    if (this.state.phase !== "playing") return;
    if (this.now() >= this.state.shiftEndsAt) {
      const preppedCount = [...this.state.rooms.values()].filter((r) => r.state === "prepped").length;
      const coverage = computeCoverage(preppedCount, ROOM_COUNT);
      this.endRound(coverageWinner(coverage));
    }
  }

  /** R-12 attrition: if non-disconnected staff count drops to 1, saboteur wins. */
  private checkAttritionWin(): void {
    if (this.state.phase !== "playing") return;
    const totalConnected = this.state.players.size;
    const saboteurConnected = this.saboteurSessionId ? (this.state.players.has(this.saboteurSessionId) ? 1 : 0) : 0;
    const staffCount = totalConnected - saboteurConnected;
    const winner = attritionWinner(totalConnected, saboteurConnected);
    if (winner) this.endRound(winner);
  }

  private broadcastResults(): void {
    const traitorReveal = this.state.traitorReveal;
    const payload = {
      winner: this.state.winner,
      traitorReveal: traitorReveal
        ? { sessionId: traitorReveal.sessionId, name: traitorReveal.name }
        : { sessionId: "", name: "" },
      coverage: this.state.coverage,
    };
    for (const c of this.clientMap.values()) {
      const anyC = c as unknown as { send?: (t: string, d: unknown) => void };
      if (typeof anyC.send === "function") {
        anyC.send("results", payload);
      }
    }
  }

  // ── elevator helpers ───────────────────────────────────────────────────────

  private getElevator(shaft: string): { car: ElevatorCar; runtime: ElevatorCarState } | null {
    const car = this.state.elevators.get(shaft);
    if (!car) return null;
    const runtime = this.elevatorRuntime.get(car);
    if (!runtime) return null;
    return { car, runtime };
  }

  private syncElevatorCar(car: ElevatorCar, runtime: ElevatorCarState): void {
    car.floor = runtime.floor;
    car.state = runtime.state;
    car.queue.splice(0, car.queue.length);
    for (const id of runtime.queue) {
      car.queue.push(id);
    }
  }

  private scheduleElevatorArrival(shaft: string): void {
    this.schedule("arrive:" + shaft, ELEVATOR_ARRIVE_MS, () => this.handleElevatorArrived(shaft));
  }

  private scheduleElevatorRide(shaft: string): void {
    this.schedule("ride:" + shaft, ELEVATOR_RIDE_MS, () => this.handleElevatorRode(shaft));
  }

  private handleCallElevator(client: Client, raw: unknown): void {
    const parsed = CallElevatorMsgSchema.safeParse(raw ?? {});
    if (!parsed.success) return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (this.state.phase !== "playing") return;
    const elevator = this.getElevator(parsed.data.shaft);
    if (!elevator) return;
    const { car, runtime } = elevator;
    if (Math.abs(player.x - getElevatorX(parsed.data.shaft)) > ELEVATOR_INTERACT_RADIUS) return;
    const now = this.now();

    const wasIdle = runtime.state === "idle";
    callElevator(runtime, client.sessionId, player.floor, now);
    this.syncElevatorCar(car, runtime);

    if (wasIdle && runtime.state === "arriving") {
      this.scheduleElevatorArrival(parsed.data.shaft);
    }
  }

  private handleRideElevator(client: Client, raw: unknown): void {
    const parsed = RideElevatorMsgSchema.safeParse(raw ?? {});
    if (!parsed.success) return;
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const elevator = this.getElevator(parsed.data.shaft);
    if (!elevator) return;
    const { car, runtime } = elevator;
    const result = tryRideElevator(
      runtime,
      client.sessionId,
      player.x,
      player.floor,
      parsed.data.destFloor,
    );
    if (!result.ok) {
      const anyClient = client as unknown as { send?: (t: string, d: unknown) => void };
      if (typeof anyClient.send === "function") {
        anyClient.send("error", { reason: result.reason });
      }
      return;
    }
    this.syncElevatorCar(car, runtime);
    if (result.seated) {
      // floor change via elevator cancels any active channel (R-9)
      this.cancelChannel(client.sessionId);
    }
  }

  private handleElevatorArrived(shaft: string): void {
    const elevator = this.getElevator(shaft);
    if (!elevator) return;
    const { car, runtime } = elevator;
    if (tickArrival(runtime, this.now())) {
      this.syncElevatorCar(car, runtime);
      this.scheduleElevatorRide(shaft);
    } else if (runtime.state === "arriving") {
      // The room clock accumulates real-time deltas but its elapsed time can
      // cross the delay a tick or two before wall-clock reaches arriveAt
      // (clock elapsed leads Date.now by up to one simulation tick). Firing
      // early must re-arm for the remaining delay instead of abandoning the
      // arrival, or the car stays "arriving" forever.
      const remaining = Math.max(0, runtime.arriveAt - this.now());
      this.schedule("arrive:" + shaft, remaining, () => this.handleElevatorArrived(shaft));
      return;
    }
    this.timers.delete("arrive:" + shaft);
  }

  private handleElevatorRode(shaft: string): void {
    const elevator = this.getElevator(shaft);
    if (!elevator) return;
    const { car, runtime } = elevator;
    if (runtime.state !== "boarding") {
      this.timers.delete("ride:" + shaft);
      return;
    }

    const { riders, destFloor } = completeRide(runtime);
    if (destFloor !== null) {
      const elevatorX = getElevatorX(car.shaft);
      for (const sessionId of riders) {
        const p = this.state.players.get(sessionId);
        if (p) {
          p.floor = destFloor;
          p.x = elevatorX;
          // floor change via elevator cancels any active channel (R-9)
          this.cancelChannel(sessionId);
        }
      }
    }

    this.syncElevatorCar(car, runtime);
    this.timers.delete("ride:" + shaft);

    if (runtime.queue.length > 0) {
      this.dequeueNextBatch(shaft);
    } else {
      resetElevatorState(runtime);
      this.syncElevatorCar(car, runtime);
    }
  }

  private dequeueNextBatch(shaft: string): void {
    const elevator = this.getElevator(shaft);
    if (!elevator) return;
    const { car, runtime } = elevator;
    startNextCycle(runtime, this.now());
    this.syncElevatorCar(car, runtime);
    this.scheduleElevatorArrival(shaft);
  }

  // ── channel helpers ────────────────────────────────────────────────────────

  private handleChannelStart(client: Client, raw: unknown): void {
    const parsed = ChannelStartMsgSchema.safeParse(raw ?? {});
    if (!parsed.success) return;
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const room = this.state.rooms.get(parsed.data.roomId);
    if (!room) return;

    const isInside = isInsideRoom(player.x, player.floor, parsed.data.roomId);
    const isSaboteur = this.getRoleFor(client.sessionId) === "saboteur";
    const alreadyChanneling = this.activeChannels.has(client.sessionId);

    const result = canStartChannel(
      parsed.data.type,
      parsed.data.roomId,
      client.sessionId,
      isInside,
      this.state.phase,
      room.state,
      isSaboteur,
      alreadyChanneling,
      this.now(),
    );

    if (!result.ok) {
      const anyClient = client as unknown as { send?: (t: string, d: unknown) => void };
      if (typeof anyClient.send === "function") {
        anyClient.send("error", { reason: result.reason });
      }
      return;
    }

    this.startChannel(client.sessionId, result.channel);
  }

  private startChannel(sessionId: string, channel: Channel): void {
    this.cancel("channel:" + sessionId);
    const player = this.state.players.get(sessionId);
    if (player) {
      player.activeChannel = channel.type;
    }
    this.activeChannels.set(sessionId, channel);
    const delay = Math.max(0, channel.endsAt - this.now());
    this.schedule("channel:" + sessionId, delay, () => this.completeChannel(sessionId));
  }

  private handleChannelCancel(client: Client, raw: unknown): void {
    const parsed = ChannelCancelMsgSchema.safeParse(raw ?? {});
    if (!parsed.success) return;
    if (this.state.phase !== "playing") return;
    this.cancelChannel(client.sessionId);
  }

  private cancelChannel(sessionId: string): void {
    const channel = this.activeChannels.get(sessionId);
    if (!channel) return;
    this.cancel("channel:" + sessionId);
    this.activeChannels.delete(sessionId);
    const player = this.state.players.get(sessionId);
    if (player) {
      player.activeChannel = null;
    }
  }

  private completeChannel(sessionId: string): void {
    this.timers.delete("channel:" + sessionId);
    const channel = this.activeChannels.get(sessionId);
    if (!channel) return;
    const player = this.state.players.get(sessionId);
    const room = this.state.rooms.get(channel.roomId);
    if (!player || !room) {
      this.activeChannels.delete(sessionId);
      if (player) player.activeChannel = null;
      return;
    }

    // re-validate: still inside the same room and same floor; channel still active
    if (!isInsideRoom(player.x, player.floor, channel.roomId)) {
      this.activeChannels.delete(sessionId);
      player.activeChannel = null;
      return;
    }

    room.state = applyChannelCompletion(channel.type, room.state);
    this.activeChannels.delete(sessionId);
    player.activeChannel = null;
  }

  /**
   * Visibility filtering helper (R-10): returns the subset of room states that
   * should be observable to the given session id. Only rooms where the player is
   * physically inside are included.
   */
  public getVisibleRooms(sessionId: string): Record<string, RoomStateType> {
    const player = this.state.players.get(sessionId);
    if (!player) return {};
    const visible: Record<string, RoomStateType> = {};
    for (const [id, room] of this.state.rooms.entries()) {
      if (isInsideRoom(player.x, player.floor, id)) {
        visible[id] = room.state;
      }
    }
    return visible;
  }

  /** Exposed for server unit tests — not part of public API */
  public getSaboteurSessionId(): string | null {
    return this.saboteurSessionId;
  }

  public getRoleFor(sessionId: string): "staff" | "saboteur" | null {
    return this.roleMap.get(sessionId) ?? null;
  }

  public getActiveChannel(sessionId: string): Readonly<Channel> | null {
    return this.activeChannels.get(sessionId) ?? null;
  }
}
