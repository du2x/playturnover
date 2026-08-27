import { Room } from "../colyseus-compat.js";
import type { Client } from "colyseus";
import {
  ELEVATOR_ARRIVE_MS,
  ELEVATOR_INTERACT_RADIUS,
  ELEVATOR_RIDE_MS,
  ACCUSATION_RANGE_TILES,
  FRESHNESS_WINDOW_MS,
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
  TILE_SIZE_PX,
} from "@grandhotel/shared";
import {
  ElevatorCar,
  PlayerState,
  RecapEvent,
  RoomData,
  RoomState,
  TraitorReveal,
} from "@grandhotel/shared";
import {
  CallElevatorMsgSchema,
  ChannelCancelMsgSchema,
  ChannelStartMsgSchema,
  AccusationMsgSchema,
  MoveMsgSchema,
  RideElevatorMsgSchema,
  StartRoundMsgSchema,
} from "@grandhotel/shared";
import {
  getAllRoomIds,
  getHallBounds,
  getRoomRect,
  getElevatorX,
} from "@grandhotel/shared";
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
import {
  attritionWinner,
  beginShift,
  computeCoverage,
  coverageWinner,
} from "../shift.js";
import type { Clock } from "../time.js";
import { ColyseusClock } from "../time.js";
import type { Cancel } from "../time.js";
import { TelemetryLogger, type TelemetryRecord } from "../telemetry.js";
import { roomCodeRegistry } from "./roomCodes.js";

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
  declare onMessage: (
    type: string,
    cb: (client: Client, data: unknown) => void,
  ) => void;
  private lastMoveAt = new Map<string, number>();
  private clientMap = new Map<string, Client>();
  private saboteurSessionId: string | null = null;
  private roleMap = new Map<string, "staff" | "saboteur">();
  private shiftLengthS: number = SHIFT_LENGTH_S;
  private elevatorRuntime = new WeakMap<ElevatorCar, ElevatorCarState>();
  // Riders in flight: car departed but players not yet dropped at dest.
  private pendingDrops = new Map<
    string,
    { riders: string[]; destFloor: number; fromFloor: number }
  >();
  private activeChannels = new Map<string, Channel>();
  private timers = new Map<string, Cancel>();
  private injectedClock?: Clock;
  private clockAdapter!: Clock;
  private saboteurHasCommittedCrime = false;
  private telemetry = new TelemetryLogger();
  private roundStartedAt = 0;
  private undiscoveredCrimes = new Map<string, number>();
  private acquiredRoomCode = "";

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
    if (
      typeof override === "number" &&
      Number.isFinite(override) &&
      override > 0
    ) {
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
    this.state.coveragePercent = 0;

    // R-1 join-by-code: acquire a unique short code, expose it on the
    // replicated state and matchmaking metadata. Runs after the listing stub
    // above so directly-constructed test rooms tolerate setMetadata.
    this.acquiredRoomCode = roomCodeRegistry.acquire();
    this.state.roomCode = this.acquiredRoomCode;
    (this as unknown as {
      setMetadata: (meta: Record<string, string>) => Promise<void>;
    }).setMetadata({ roomCode: this.acquiredRoomCode });

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
      rd.doorCard.present = false;
      rd.doorCard.text = "";
      rd.trashedAtTime = 0;
      rd.freshness = null;
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

    this.onMessage("accusation", (client: Client, data: unknown) => {
      this.handleAccusation(client, data);
    });
  }

  onDispose(): void {
    if (this.acquiredRoomCode) {
      roomCodeRegistry.release(this.acquiredRoomCode);
    }
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
    if (player.fired || player.spectator) return;

    const now = this.now();
    const last = this.lastMoveAt.get(client.sessionId) ?? now;
    const dt = Math.min(MAX_MOVE_DT_S, Math.max(0, (now - last) / 1000));

    // ignore dy entirely
    const newX = computeClampedX(player.x, parsed.data.dx, dt);
    player.x = newX;
    this.lastMoveAt.set(client.sessionId, now);

    // walk-out cancels any active channel (R-9)
    this.checkWalkInCatch(client.sessionId);
    this.checkDiscovery(client.sessionId);
    this.checkChannelBounds(client.sessionId);
  }

  private checkDiscovery(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player || player.fired || player.spectator) return;
    if (this.getRoleFor(sessionId) !== "staff") return;

    for (const [roomId, crimeTime] of this.undiscoveredCrimes.entries()) {
      if (isInsideRoom(player.x, player.floor, roomId)) {
        const now = this.now();
        const timeSinceCrimeMs = now - crimeTime;
        this.undiscoveredCrimes.delete(roomId);
        this.telemetry.log({
          type: "discovery",
          timestamp: now,
          actorSessionId: sessionId,
          roomId,
          timeSinceCrimeMs,
          crimeTimestamp: crimeTime,
        });
      }
    }
  }

  private checkWalkInCatch(enteringSessionId: string): void {
    const entering = this.state.players.get(enteringSessionId);
    if (!entering) return;
    for (const [sessionId, channel] of this.activeChannels) {
      if (sessionId === enteringSessionId || channel.type !== "unprep")
        continue;
      const saboteur = this.state.players.get(sessionId);
      if (
        saboteur &&
        !saboteur.fired &&
        isInsideRoom(entering.x, entering.floor, channel.roomId)
      ) {
        this.undiscoveredCrimes.delete(channel.roomId);
        this.recordEvent(
          "catch",
          enteringSessionId,
          sessionId,
          channel.roomId,
          true,
          true,
          true,
          "",
        );
        this.firePlayer(sessionId);
        this.endRound("staff");
        return;
      }
    }
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
      const anyClient = client as unknown as {
        send?: (t: string, d: unknown) => void;
      };
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
    this.saboteurHasCommittedCrime = false;
    this.state.recapEvents.splice(0, this.state.recapEvents.length);
    this.telemetry.clear();
    this.undiscoveredCrimes.clear();
    this.roundStartedAt = this.now();
    this.telemetry.log({
      type: "round_start",
      timestamp: this.now(),
      saboteurSessionId: saboteurSessionId ?? "",
      playerCount: ids.length,
      players: ids,
      shiftEndsAt: endsAt,
    });
    this.roleMap.clear();
    for (const [sid, role] of roleBySessionId) {
      this.roleMap.set(sid, role);
      const c = this.clientMap.get(sid);
      const anyC = c as unknown as
        | { send?: (t: string, d: unknown) => void }
        | undefined;
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
    this.timers.set(
      "shift",
      this.clockAdapter.setInterval(1000, () => this.checkBuzzer()),
    );
    this.cancel("evidence");
    this.timers.set(
      "evidence",
      this.clockAdapter.setInterval(1000, () => this.updateEvidence()),
    );
    this.updateEvidence();
  }

  private updateEvidence(): void {
    const now = this.now();
    let preppedCount = 0;
    let trashedCount = 0;
    for (const room of this.state.rooms.values()) {
      if (room.state === "prepped") preppedCount += 1;
      else if (room.state === "trashed") trashedCount += 1;
      if (room.trashedAtTime > 0) {
        room.freshness =
          now - room.trashedAtTime < FRESHNESS_WINDOW_MS ? "fresh" : "settled";
      } else {
        room.freshness = null;
      }
    }
    this.state.coverage = computeCoverage(preppedCount, ROOM_COUNT);
    this.state.coveragePercent = Math.floor(this.state.coverage * 100);

    if (this.state.phase === "playing") {
      this.telemetry.log({
        type: "coverage_sample",
        timestamp: now,
        coverage: this.state.coverage,
        coveragePercent: this.state.coveragePercent,
        preppedCount,
        trashedCount,
        cleanCount: ROOM_COUNT - preppedCount - trashedCount,
      });
    }
  }

  /** Shared path for declaring the end of the round. */
  private endRound(winner: "staff" | "saboteur"): void {
    if (this.state.phase === "results") return;

    const preppedCount = [...this.state.rooms.values()].filter(
      (r) => r.state === "prepped",
    ).length;
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

    this.telemetry.log({
      type: "round_end",
      timestamp: this.now(),
      winner,
      traitorSessionId: this.saboteurSessionId ?? "",
      traitorName: this.state.traitorReveal?.name ?? "",
      coverage: this.state.coverage,
      coveragePercent: this.state.coveragePercent,
      durationMs: this.roundStartedAt ? this.now() - this.roundStartedAt : 0,
    });

    this.cancel("shift");
    this.cancel("evidence");
    this.broadcastResults();
  }

  private checkBuzzer(): void {
    if (this.state.phase !== "playing") return;
    if (this.now() >= this.state.shiftEndsAt) {
      const preppedCount = [...this.state.rooms.values()].filter(
        (r) => r.state === "prepped",
      ).length;
      const coverage = computeCoverage(preppedCount, ROOM_COUNT);
      this.endRound(coverageWinner(coverage));
    }
  }

  /** R-12 attrition: if non-disconnected active staff count drops to 1, saboteur wins. */
  private checkAttritionWin(): void {
    if (this.state.phase !== "playing") return;
    const saboteurConnected = this.saboteurSessionId
      ? this.state.players.has(this.saboteurSessionId)
        ? 1
        : 0
      : 0;
    const activeStaffCount = [...this.state.players.values()].filter(
      (p) => p.sessionId !== this.saboteurSessionId && !p.fired,
    ).length;
    const totalActive = activeStaffCount + saboteurConnected;
    const winner = attritionWinner(totalActive, saboteurConnected);
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

  private getElevator(
    shaft: string,
  ): { car: ElevatorCar; runtime: ElevatorCarState } | null {
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
    this.schedule("arrive:" + shaft, ELEVATOR_ARRIVE_MS, () =>
      this.handleElevatorArrived(shaft),
    );
  }

  private scheduleElevatorRide(shaft: string): void {
    this.schedule("ride:" + shaft, ELEVATOR_RIDE_MS, () =>
      this.handleElevatorRode(shaft),
    );
  }

  private handleCallElevator(client: Client, raw: unknown): void {
    const parsed = CallElevatorMsgSchema.safeParse(raw ?? {});
    if (!parsed.success) return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (player.fired || player.spectator) return;
    // Elevators run pre-round too (lobby socializing / decoy calls).
    if (this.state.phase !== "waiting" && this.state.phase !== "playing")
      return;
    const elevator = this.getElevator(parsed.data.shaft);
    if (!elevator) return;
    if (this.pendingDrops.has(parsed.data.shaft)) {
      // Car is in flight — a call now would stomp its travel floor.
      return;
    }
    const { car, runtime } = elevator;
    if (
      Math.abs(player.x - getElevatorX(parsed.data.shaft)) >
      ELEVATOR_INTERACT_RADIUS
    )
      return;
    const now = this.now();

    const wasIdle = runtime.state === "idle";
    callElevator(runtime, client.sessionId, player.floor, now);
    this.syncElevatorCar(car, runtime);

    this.recordEvent(
      "call",
      client.sessionId,
      "",
      "",
      true,
      this.getRoleFor(client.sessionId) === "saboteur",
      false,
      parsed.data.shaft,
      { floor: player.floor },
    );

    if (wasIdle && runtime.state === "arriving") {
      this.scheduleElevatorArrival(parsed.data.shaft);
    }
  }

  private handleRideElevator(client: Client, raw: unknown): void {
    const parsed = RideElevatorMsgSchema.safeParse(raw ?? {});
    if (!parsed.success) return;
    if (this.state.phase !== "waiting" && this.state.phase !== "playing")
      return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (player.fired || player.spectator) return;
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
      const anyClient = client as unknown as {
        send?: (t: string, d: unknown) => void;
      };
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
      this.schedule("arrive:" + shaft, remaining, () =>
        this.handleElevatorArrived(shaft),
      );
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

    // Two-stage ride: the car departs now (its floor broadcast changes, so
    // clients animate the travel), while seated players stay authoritative on
    // the origin floor until the drop tick ELEVATOR_RIDE_MS later.
    const fromFloor = runtime.floor;
    const { riders, destFloor } = completeRide(runtime);
    if (destFloor !== null && riders.length > 0) {
      this.pendingDrops.set(shaft, { riders, destFloor, fromFloor });
      runtime.floor = destFloor;
      this.syncElevatorCar(car, runtime);
      this.schedule("drop:" + shaft, ELEVATOR_RIDE_MS, () =>
        this.handleElevatorDrop(shaft),
      );
    } else if (runtime.queue.length > 0) {
      this.dequeueNextBatch(shaft);
    } else {
      resetElevatorState(runtime);
      this.syncElevatorCar(car, runtime);
    }
    this.timers.delete("ride:" + shaft);
  }

  private handleElevatorDrop(shaft: string): void {
    const drop = this.pendingDrops.get(shaft);
    this.pendingDrops.delete(shaft);
    this.timers.delete("drop:" + shaft);
    const elevator = this.getElevator(shaft);
    if (!elevator || !drop) return;
    const { car, runtime } = elevator;
    const elevatorX = getElevatorX(car.shaft);
    for (const sessionId of drop.riders) {
      const p = this.state.players.get(sessionId);
      if (!p || p.fired || p.spectator) continue;
      p.floor = drop.destFloor;
      p.x = elevatorX;
      // floor change via elevator cancels any active channel (R-9)
      this.cancelChannel(sessionId);
      this.recordEvent(
        "ride",
        sessionId,
        "",
        "",
        true,
        this.getRoleFor(sessionId) === "saboteur",
        false,
        car.shaft,
        { fromFloor: drop.fromFloor, destFloor: drop.destFloor },
      );
    }

    if (runtime.queue.length > 0) {
      // Queued riders board where they are still standing (origin floor),
      // so bring the car back there before starting the next cycle.
      runtime.floor = drop.fromFloor;
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
    if (player.fired || player.spectator) return;
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
      const anyClient = client as unknown as {
        send?: (t: string, d: unknown) => void;
      };
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
    this.schedule("channel:" + sessionId, delay, () =>
      this.completeChannel(sessionId),
    );
  }

  private handleChannelCancel(client: Client, raw: unknown): void {
    const parsed = ChannelCancelMsgSchema.safeParse(raw ?? {});
    if (!parsed.success) return;
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.fired || player.spectator) return;
    this.cancelChannel(client.sessionId);
  }

  private handleAccusation(client: Client, raw: unknown): void {
    const parsed = AccusationMsgSchema.safeParse(raw ?? {});
    if (!parsed.success || this.state.phase !== "playing") return;
    const accuser = this.state.players.get(client.sessionId);
    const target = this.state.players.get(parsed.data.targetSessionId);
    if (
      !accuser ||
      !target ||
      accuser.fired ||
      accuser.spectator ||
      target.fired ||
      target.spectator ||
      this.getRoleFor(client.sessionId) !== "staff" ||
      client.sessionId === parsed.data.targetSessionId ||
      accuser.floor !== target.floor ||
      Math.abs(accuser.x - target.x) > ACCUSATION_RANGE_TILES * TILE_SIZE_PX
    ) {
      return;
    }

    const targetIsSaboteur =
      parsed.data.targetSessionId === this.saboteurSessionId;
    const correct = targetIsSaboteur && this.saboteurHasCommittedCrime;
    this.recordEvent(
      "accusation",
      client.sessionId,
      parsed.data.targetSessionId,
      "",
      correct,
      targetIsSaboteur,
      this.saboteurHasCommittedCrime,
      "",
    );
    if (correct) {
      this.firePlayer(parsed.data.targetSessionId);
      this.endRound("staff");
    } else {
      this.firePlayer(client.sessionId);
      this.checkAttritionWin();
    }
  }

  private firePlayer(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player || player.fired) return;
    this.cancelChannel(sessionId);
    player.fired = true;
    player.spectator = true;
    for (const car of this.state.elevators.values()) {
      const runtime = this.elevatorRuntime.get(car);
      if (runtime) {
        removeRiderFromCar(runtime, sessionId);
        this.syncElevatorCar(car, runtime);
      }
    }
  }

  private recordEvent(
    type: string,
    actorSessionId: string,
    targetSessionId: string,
    roomId: string,
    valid = false,
    wasTargetSaboteur = false,
    crimeOccurred = false,
    shaft = "",
    extra: Record<string, unknown> = {},
  ): void {
    const event = new RecapEvent();
    event.type = type;
    event.actorSessionId = actorSessionId;
    event.targetSessionId = targetSessionId;
    event.roomId = roomId;
    event.shaft = shaft;
    event.timestamp = this.now();
    event.valid = valid;
    event.wasTargetSaboteur = wasTargetSaboteur;
    event.crimeOccurred = crimeOccurred;
    this.state.recapEvents.push(event);

    this.telemetry.log({
      type: type as any,
      timestamp: event.timestamp,
      actorSessionId,
      targetSessionId,
      roomId,
      shaft,
      valid,
      wasTargetSaboteur,
      crimeOccurred,
      ...extra,
    });
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

    const previousState = room.state;
    room.state = applyChannelCompletion(channel.type, room.state);
    if (
      channel.type === "prep" &&
      previousState === "clean" &&
      room.state === "prepped"
    ) {
      room.doorCard.present = true;
      room.doorCard.text = "PREPPED";
      this.recordEvent(
        "prep",
        sessionId,
        "",
        channel.roomId,
        true,
        false,
        false,
        "",
      );
    } else if (channel.type === "unprep" && room.state === "trashed") {
      room.doorCard.present = true;
      room.doorCard.text = "TRASHED";
      room.trashedAtTime = this.now();
      room.freshness = "fresh";
      this.saboteurHasCommittedCrime = true;
      this.undiscoveredCrimes.set(channel.roomId, this.now());
      this.recordEvent(
        "sabotage",
        sessionId,
        "",
        channel.roomId,
        true,
        true,
        true,
        "",
      );
      this.broadcastSabotageEvent(channel.roomId, player);
    }
    this.updateEvidence();
    this.activeChannels.delete(sessionId);
    player.activeChannel = null;
  }

  private broadcastSabotageEvent(roomId: string, player: PlayerState): void {
    const position = { x: player.x, y: getHallBounds(player.floor).y };
    const event = { roomId, position, timestamp: this.now() };
    for (const client of this.clientMap.values()) {
      const anyClient = client as unknown as {
        send?: (type: string, data: unknown) => void;
      };
      if (typeof anyClient.send === "function") {
        anyClient.send("sabotageEvent", event);
      }
    }
  }

  /**
   * Visibility filtering helper (R-10): returns the subset of room states that
   * should be observable to the given session id. Only rooms where the player is
   * physically inside are included, unless the player is a spectator/fired.
   */
  public getVisibleRooms(sessionId: string): Record<string, RoomStateType> {
    const player = this.state.players.get(sessionId);
    if (!player) return {};
    const visible: Record<string, RoomStateType> = {};
    if (player.fired || player.spectator) {
      for (const [id, room] of this.state.rooms.entries()) {
        visible[id] = room.state;
      }
      return visible;
    }
    for (const [id, room] of this.state.rooms.entries()) {
      if (isInsideRoom(player.x, player.floor, id)) {
        visible[id] = room.state;
      }
    }
    return visible;
  }

  public getTelemetryRecords(): TelemetryRecord[] {
    return this.telemetry.getRecords();
  }

  public getTelemetryJsonl(): string {
    return this.telemetry.toJsonl();
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
