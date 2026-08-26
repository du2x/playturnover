import {
  ELEVATOR_ARRIVE_MS,
  ELEVATOR_CAPACITY,
  ELEVATOR_INTERACT_RADIUS,
  ELEVATOR_RIDE_MS,
  getElevatorX,
} from "@grandhotel/shared";
import type { ElevatorShaft } from "@grandhotel/shared";

/**
 * Pure runtime state for one elevator car.
 * The broadcast schema only carries shaft, floor, state and queue; seats,
 * arriveAt and destFloor are server-authoritative and tracked here.
 */
export interface ElevatorCarState {
  shaft: ElevatorShaft;
  floor: number;
  state: "idle" | "arriving" | "boarding";
  arriveAt: number;
  seats: string[];
  queue: string[];
  destFloor: number | null;
}

export function createElevatorState(shaft: ElevatorShaft): ElevatorCarState {
  return {
    shaft,
    floor: 0,
    state: "idle",
    arriveAt: 0,
    seats: [],
    queue: [],
    destFloor: null,
  };
}

export function resetElevatorState(car: ElevatorCarState): void {
  car.state = "idle";
  car.arriveAt = 0;
  car.seats = [];
  car.destFloor = null;
}

export function callElevator(
  car: ElevatorCarState,
  callerId: string,
  callerFloor: number,
  now: number,
): { enqueued: boolean } {
  if (car.state === "idle") {
    car.floor = callerFloor;
    car.state = "arriving";
    car.arriveAt = now + ELEVATOR_ARRIVE_MS;
    car.seats = [];
    car.destFloor = null;
    // Caller is not auto-seated; they must explicitly request a ride.
    return { enqueued: false };
  }

  if ((car.state === "arriving" || car.state === "boarding") && !car.queue.includes(callerId)) {
    car.queue.push(callerId);
  }
  return { enqueued: true };
}

export function tickArrival(car: ElevatorCarState, now: number): boolean {
  if (car.state !== "arriving") return false;
  if (now < car.arriveAt) return false;
  car.state = "boarding";
  return true;
}

export function tryRideElevator(
  car: ElevatorCarState,
  callerId: string,
  callerX: number,
  callerFloor: number,
  destFloor: number,
): { ok: boolean; seated: boolean; reason?: string } {
  if (car.state !== "boarding") {
    return { ok: false, seated: false, reason: "not-boarding" };
  }
  if (car.floor !== callerFloor) {
    return { ok: false, seated: false, reason: "wrong-floor" };
  }
  const elevatorX = getElevatorX(car.shaft);
  if (Math.abs(callerX - elevatorX) > ELEVATOR_INTERACT_RADIUS) {
    return { ok: false, seated: false, reason: "out-of-range" };
  }

  // A caller already seated (e.g. auto-dequeued for the next cycle) just
  // confirms the destination; first explicit request wins.
  if (car.seats.includes(callerId)) {
    if (car.destFloor === null) {
      car.destFloor = destFloor;
    }
    return { ok: true, seated: true };
  }

  // First rider sets the destination for this ride.
  if (car.seats.length === 0) {
    car.seats.push(callerId);
    car.destFloor = destFloor;
    return { ok: true, seated: true };
  }

  // Second rider can only share the car if they want the same floor;
  // otherwise they queue for the next cycle (per M1 plan free variable).
  if (car.seats.length < ELEVATOR_CAPACITY) {
    if (car.destFloor === null) {
      // Auto-seated riders from a previous cycle have no destination yet.
      car.destFloor = destFloor;
      car.seats.push(callerId);
      return { ok: true, seated: true };
    }
    if (car.destFloor !== destFloor) {
      if (!car.queue.includes(callerId)) {
        car.queue.push(callerId);
      }
      return { ok: true, seated: false };
    }
    car.seats.push(callerId);
    return { ok: true, seated: true };
  }

  if (!car.queue.includes(callerId)) {
    car.queue.push(callerId);
  }
  return { ok: true, seated: false };
}

export function completeRide(car: ElevatorCarState): {
  riders: string[];
  destFloor: number | null;
} {
  const riders = car.seats.slice();
  const destFloor = car.destFloor;
  car.seats = [];
  car.destFloor = null;
  return { riders, destFloor };
}

export function startNextCycle(car: ElevatorCarState, now: number): boolean {
  if (car.queue.length === 0) {
    car.state = "idle";
    car.arriveAt = 0;
    return false;
  }
  car.seats = car.queue.splice(0, ELEVATOR_CAPACITY);
  car.destFloor = null;
  car.state = "arriving";
  car.arriveAt = now + ELEVATOR_ARRIVE_MS;
  return true;
}

export function removeRiderFromCar(car: ElevatorCarState, sessionId: string): void {
  const seatIdx = car.seats.indexOf(sessionId);
  if (seatIdx >= 0) car.seats.splice(seatIdx, 1);
  const queueIdx = car.queue.indexOf(sessionId);
  if (queueIdx >= 0) car.queue.splice(queueIdx, 1);
  if (car.seats.length === 0) car.destFloor = null;
}

export { ELEVATOR_ARRIVE_MS, ELEVATOR_RIDE_MS, ELEVATOR_CAPACITY, ELEVATOR_INTERACT_RADIUS };
