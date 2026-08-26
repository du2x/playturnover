import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ELEVATOR_ARRIVE_MS,
  ELEVATOR_CAPACITY,
  ELEVATOR_INTERACT_RADIUS,
  ELEVATOR_RIDE_MS,
  ELEVATOR_A_X,
  ELEVATOR_B_X,
} from "@grandhotel/shared";
import type { ElevatorShaft } from "@grandhotel/shared";
import { HotelRoom } from "../src/rooms/HotelRoom.js";
import {
  callElevator,
  completeRide,
  createElevatorState,
  removeRiderFromCar,
  resetElevatorState,
  startNextCycle,
  tickArrival,
  tryRideElevator,
} from "../src/elevator.js";

function mockClient(sessionId: string): any {
  const c: any = { sessionId, _sent: [] as Array<{ type: string; data: unknown }> };
  c.send = (type: string, data: unknown) => {
    c._sent.push({ type, data });
  };
  c.getSent = () => c._sent;
  return c as unknown as import("colyseus").Client & {
    _sent: Array<{ type: string; data: unknown }>;
    getSent: () => Array<{ type: string; data: unknown }>;
  };
}

async function createRoomWithHostAndPlayers(count: number): Promise<{ room: HotelRoom; clients: any[] }> {
  const room = new HotelRoom();
  await room.onCreate({});
  const clients: any[] = [];
  for (let i = 0; i < count; i++) {
    const c = mockClient(`p${i}`);
    await room.onJoin(c, { name: `P${i}` });
    clients.push(c);
  }
  return { room, clients };
}

async function startRoomForElevator(room: HotelRoom, host: any): Promise<void> {
  // Put players on a specific floor so elevator can be called and ridden.
  (room as any).handleStartRound(host, {});
}

describe("elevator deterministic", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("constants match shared single source of truth", () => {
    expect(ELEVATOR_ARRIVE_MS).toBe(3000);
    expect(ELEVATOR_RIDE_MS).toBe(2000);
    expect(ELEVATOR_CAPACITY).toBe(2);
    expect(ELEVATOR_INTERACT_RADIUS).toBe(18);
  });

  it("pure helper: call transitions idle car to arriving with 3s arrival", () => {
    const car = createElevatorState("A");
    expect(car.state).toBe("idle");
    const result = callElevator(car, "p1", 0, 0);
    expect(result.enqueued).toBe(false);
    expect(car.state).toBe("arriving");
    expect(car.arriveAt).toBe(3000);
    expect(car.floor).toBe(0);
  });

  it("pure helper: second call while arriving enqueues the caller", () => {
    const car = createElevatorState("A");
    callElevator(car, "p1", 0, 0);
    const result = callElevator(car, "p2", 0, 0);
    expect(result.enqueued).toBe(true);
    expect(car.queue).toEqual(["p2"]);
  });

  it("pure helper: ride requires boarding state, range and floor", () => {
    const car = createElevatorState("A");
    callElevator(car, "p1", 0, 0);
    tickArrival(car, 3000);
    expect(car.state).toBe("boarding");

    // too far from elevator
    const far = tryRideElevator(car, "p1", ELEVATOR_A_X + 100, 0, 1);
    expect(far.ok).toBe(false);
    expect(far.reason).toBe("out-of-range");

    // wrong floor
    const wrongFloor = tryRideElevator(car, "p1", ELEVATOR_A_X, 2, 1);
    expect(wrongFloor.ok).toBe(false);
    expect(wrongFloor.reason).toBe("wrong-floor");

    // valid
    const valid = tryRideElevator(car, "p1", ELEVATOR_A_X, 0, 1);
    expect(valid.ok).toBe(true);
    expect(valid.seated).toBe(true);
  });

  it("pure helper: third concurrent rider is queued, first two share same destination", () => {
    const car = createElevatorState("A");
    callElevator(car, "p1", 0, 0);
    tickArrival(car, 3000);

    const r1 = tryRideElevator(car, "p1", ELEVATOR_A_X, 0, 1);
    expect(r1.seated).toBe(true);
    const r2 = tryRideElevator(car, "p2", ELEVATOR_A_X, 0, 1);
    expect(r2.seated).toBe(true);
    expect(car.seats).toEqual(["p1", "p2"]);

    const r3 = tryRideElevator(car, "p3", ELEVATOR_A_X, 0, 1);
    expect(r3.seated).toBe(false);
    expect(car.queue).toEqual(["p3"]);
  });

  it("pure helper: different destination second rider is queued", () => {
    const car = createElevatorState("A");
    callElevator(car, "p1", 0, 0);
    tickArrival(car, 3000);

    const r1 = tryRideElevator(car, "p1", ELEVATOR_A_X, 0, 1);
    expect(r1.seated).toBe(true);
    const r2 = tryRideElevator(car, "p2", ELEVATOR_A_X, 0, 2);
    expect(r2.seated).toBe(false);
    expect(r2.ok).toBe(true);
    expect(car.queue).toEqual(["p2"]);
  });

  it("pure helper: completeRide clears seats and returns riders/dest", () => {
    const car = createElevatorState("A");
    callElevator(car, "p1", 0, 0);
    tickArrival(car, 3000);
    tryRideElevator(car, "p1", ELEVATOR_A_X, 0, 2);
    tryRideElevator(car, "p2", ELEVATOR_A_X, 0, 2);
    const { riders, destFloor } = completeRide(car);
    expect(riders).toEqual(["p1", "p2"]);
    expect(destFloor).toBe(2);
    expect(car.seats).toEqual([]);
  });

  it("pure helper: leave removes from seats and queue", () => {
    const car = createElevatorState("A");
    callElevator(car, "p1", 0, 0);
    tickArrival(car, 3000);
    tryRideElevator(car, "p1", ELEVATOR_A_X, 0, 1);
    tryRideElevator(car, "p2", ELEVATOR_A_X, 0, 1);
    tryRideElevator(car, "p3", ELEVATOR_A_X, 0, 1);
    expect(car.queue).toEqual(["p3"]);
    removeRiderFromCar(car, "p3");
    expect(car.queue).toEqual([]);
    removeRiderFromCar(car, "p1");
    expect(car.seats).toEqual(["p2"]);
  });

  it("pure helper: startNextCycle fills seats from queue", () => {
    const car = createElevatorState("A");
    callElevator(car, "p1", 0, 0);
    tickArrival(car, 3000);
    tryRideElevator(car, "p1", ELEVATOR_A_X, 0, 1);
    tryRideElevator(car, "p2", ELEVATOR_A_X, 0, 1);
    tryRideElevator(car, "p3", ELEVATOR_A_X, 0, 1);
    tryRideElevator(car, "p4", ELEVATOR_A_X, 0, 1);
    completeRide(car);
    startNextCycle(car, 5000);
    expect(car.seats).toEqual(["p3", "p4"]);
    expect(car.state).toBe("arriving");
    expect(car.arriveAt).toBe(8000);
  });

  it("HotelRoom: call on floor 0, car unavailable at t+2999, available at t+3000", async () => {
    const { room, clients } = await createRoomWithHostAndPlayers(4);
    await startRoomForElevator(room, clients[0]);
    const host = clients[0];
    // position host at elevator A
    room.state.players.get("p0")!.x = ELEVATOR_A_X;
    room.state.players.get("p0")!.floor = 0;

    (room as any).handleCallElevator(host, { shaft: "A" });
    const car = room.state.elevators.get("A")!;
    expect(car.state).toBe("arriving");

    await vi.advanceTimersByTimeAsync(2999);
    expect(car.state).toBe("arriving");

    await vi.advanceTimersByTimeAsync(1);
    expect(car.state).toBe("boarding");
  });

  it("HotelRoom: ride 2000ms teleports rider to destination floor", async () => {
    const { room, clients } = await createRoomWithHostAndPlayers(4);
    await startRoomForElevator(room, clients[0]);
    const host = clients[0];
    room.state.players.get("p0")!.x = ELEVATOR_A_X;
    room.state.players.get("p0")!.floor = 0;

    (room as any).handleCallElevator(host, { shaft: "A" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(room.state.elevators.get("A")!.state).toBe("boarding");

    (room as any).handleRideElevator(host, { shaft: "A", destFloor: 2 });
    await vi.advanceTimersByTimeAsync(2000);

    const p = room.state.players.get("p0")!;
    expect(p.floor).toBe(2);
    expect(p.x).toBe(ELEVATOR_A_X);
    expect(room.state.elevators.get("A")!.state).toBe("idle");
  });

  it("HotelRoom: third concurrent rider is queued and rides next cycle", async () => {
    const { room, clients } = await createRoomWithHostAndPlayers(4);
    await startRoomForElevator(room, clients[0]);
    const [c0, c1, c2] = clients;
    room.state.players.get("p0")!.x = ELEVATOR_A_X;
    room.state.players.get("p0")!.floor = 0;
    room.state.players.get("p1")!.x = ELEVATOR_A_X;
    room.state.players.get("p1")!.floor = 0;
    room.state.players.get("p2")!.x = ELEVATOR_A_X;
    room.state.players.get("p2")!.floor = 0;

    (room as any).handleCallElevator(c0, { shaft: "A" });
    await vi.advanceTimersByTimeAsync(3000);

    (room as any).handleRideElevator(c0, { shaft: "A", destFloor: 2 });
    (room as any).handleRideElevator(c1, { shaft: "A", destFloor: 2 });
    (room as any).handleRideElevator(c2, { shaft: "A", destFloor: 2 });

    const car = room.state.elevators.get("A")!;
    expect([...car.queue]).toEqual(["p2"]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(room.state.players.get("p0")!.floor).toBe(2);
    expect(room.state.players.get("p1")!.floor).toBe(2);
    expect(room.state.players.get("p2")!.floor).toBe(0);
    expect(car.state).toBe("arriving");

    await vi.advanceTimersByTimeAsync(3000);
    expect(car.state).toBe("boarding");

    (room as any).handleRideElevator(c2, { shaft: "A", destFloor: 2 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(room.state.players.get("p2")!.floor).toBe(2);
  });

  it("HotelRoom: spoof floor change via move is ignored", async () => {
    const { room, clients } = await createRoomWithHostAndPlayers(4);
    await startRoomForElevator(room, clients[0]);
    const host = clients[0];
    room.state.players.get("p0")!.x = ELEVATOR_A_X;
    room.state.players.get("p0")!.floor = 0;

    (room as any).handleMove(host, { dx: 0, dy: 0, seq: 1, floor: 2 });
    expect(room.state.players.get("p0")!.floor).toBe(0);
  });

  it("HotelRoom: elevator B uses ELEVATOR_B_X", async () => {
    const { room, clients } = await createRoomWithHostAndPlayers(4);
    await startRoomForElevator(room, clients[0]);
    const host = clients[0];
    room.state.players.get("p0")!.x = ELEVATOR_B_X;
    room.state.players.get("p0")!.floor = 0;

    (room as any).handleCallElevator(host, { shaft: "B" });
    await vi.advanceTimersByTimeAsync(3000);
    (room as any).handleRideElevator(host, { shaft: "B", destFloor: 1 });
    await vi.advanceTimersByTimeAsync(2000);

    expect(room.state.players.get("p0")!.floor).toBe(1);
    expect(room.state.players.get("p0")!.x).toBe(ELEVATOR_B_X);
  });
});
