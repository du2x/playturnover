import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getRoomRect,
  PREP_TIME_MS,
  UNPREP_TIME_MS,
  ELEVATOR_A_X,
  ELEVATOR_ARRIVE_MS,
  ELEVATOR_RIDE_MS,
} from "@grandhotel/shared";
import { HotelRoom } from "../src/rooms/HotelRoom.js";
import { VirtualClock } from "../src/time.js";

function mockClient(sessionId: string): any {
  const c: any = { sessionId, _sent: [] as Array<{ type: string; data: unknown }> };
  c.send = (type: string, data: unknown) => {
    c._sent.push({ type, data });
  };
  c.getSent = () => c._sent;
  return c;
}

async function setupGame(): Promise<{
  room: HotelRoom;
  clients: any[];
  clock: VirtualClock;
}> {
  const clock = new VirtualClock();
  const room = new HotelRoom(clock);
  await room.onCreate({});
  const clients = ["p0", "p1", "p2", "p3"].map(mockClient);
  for (let i = 0; i < clients.length; i++) {
    await room.onJoin(clients[i], { name: `Player_${i}` });
  }
  // Force p0 as saboteur
  vi.spyOn(Math, "random").mockReturnValue(0);
  (room as any).handleStartRound(clients[0], {});
  vi.restoreAllMocks();
  return { room, clients, clock };
}

function placePlayer(room: HotelRoom, sessionId: string, roomId: string): void {
  const rect = getRoomRect(roomId);
  const p = room.state.players.get(sessionId)!;
  p.floor = rect.floor;
  p.x = (rect.xMin + rect.xMax) / 2;
}

describe("recap and event timeline", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("event timeline structure records ordered events with required fields", async () => {
    const { room, clients, clock } = await setupGame();
    const saboteur = clients[0]; // p0
    const staff1 = clients[1]; // p1
    const staff2 = clients[2]; // p2
    const staff3 = clients[3]; // p3

    // 1. Staff1 preps room 1-0
    placePlayer(room, staff1.sessionId, "1-0");
    (room as any).handleChannelStart(staff1, { type: "prep", roomId: "1-0" });
    await clock.advance(PREP_TIME_MS);

    // 2. Staff2 calls elevator A on floor 0 and rides to floor 1
    const p2 = room.state.players.get(staff2.sessionId)!;
    p2.floor = 0;
    p2.x = ELEVATOR_A_X;
    (room as any).handleCallElevator(staff2, { shaft: "A" });
    await clock.advance(ELEVATOR_ARRIVE_MS);
    (room as any).handleRideElevator(staff2, { shaft: "A", destFloor: 1 });
    await clock.advance(ELEVATOR_RIDE_MS);

    // 3. Saboteur sabotages room 1-2
    room.state.rooms.get("1-2")!.state = "prepped";
    placePlayer(room, saboteur.sessionId, "1-2");
    (room as any).handleChannelStart(saboteur, { type: "unprep", roomId: "1-2" });
    await clock.advance(UNPREP_TIME_MS);

    // 4. Staff3 makes wrong accusation against Staff1
    placePlayer(room, staff3.sessionId, "1-0");
    placePlayer(room, staff1.sessionId, "1-0");
    (room as any).handleAccusation(staff3, {
      targetSessionId: staff1.sessionId,
    });

    // 5. Staff2 makes correct accusation against Saboteur
    placePlayer(room, staff2.sessionId, "1-2");
    placePlayer(room, saboteur.sessionId, "1-2");
    (room as any).handleAccusation(staff2, {
      targetSessionId: saboteur.sessionId,
    });

    expect(room.state.phase).toBe("results");
    expect(room.state.winner).toBe("staff");

    const events = [...room.state.recapEvents];
    expect(events.length).toBeGreaterThanOrEqual(6);

    // Chronological ordering
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]!;
      const curr = events[i]!;
      expect(curr.timestamp).toBeGreaterThanOrEqual(prev.timestamp);
    }

    const types = events.map((e) => e?.type);
    expect(types).toEqual(["prep", "call", "ride", "sabotage", "accusation", "accusation"]);

    // Event 0: prep
    const prepEvt = events[0]!;
    expect(prepEvt.type).toBe("prep");
    expect(prepEvt.actorSessionId).toBe(staff1.sessionId);
    expect(prepEvt.roomId).toBe("1-0");
    expect(prepEvt.valid).toBe(true);

    // Event 1: elevator call
    const callEvt = events[1]!;
    expect(callEvt.type).toBe("call");
    expect(callEvt.actorSessionId).toBe(staff2.sessionId);
    expect(callEvt.shaft).toBe("A");
    expect(callEvt.valid).toBe(true);

    // Event 2: elevator ride
    const rideEvt = events[2]!;
    expect(rideEvt.type).toBe("ride");
    expect(rideEvt.actorSessionId).toBe(staff2.sessionId);
    expect(rideEvt.shaft).toBe("A");
    expect(rideEvt.valid).toBe(true);

    // Event 3: sabotage
    const sabotageEvt = events[3]!;
    expect(sabotageEvt.type).toBe("sabotage");
    expect(sabotageEvt.actorSessionId).toBe(saboteur.sessionId);
    expect(sabotageEvt.roomId).toBe("1-2");
    expect(sabotageEvt.valid).toBe(true);
    expect(sabotageEvt.wasTargetSaboteur).toBe(true);
    expect(sabotageEvt.crimeOccurred).toBe(true);

    // Event 4: wrong accusation
    const wrongAccEvt = events[4]!;
    expect(wrongAccEvt.type).toBe("accusation");
    expect(wrongAccEvt.actorSessionId).toBe(staff3.sessionId);
    expect(wrongAccEvt.targetSessionId).toBe(staff1.sessionId);
    expect(wrongAccEvt.valid).toBe(false);
    expect(wrongAccEvt.wasTargetSaboteur).toBe(false);
    expect(wrongAccEvt.crimeOccurred).toBe(true);

    // Event 5: correct accusation
    const correctAccEvt = events[5]!;
    expect(correctAccEvt.type).toBe("accusation");
    expect(correctAccEvt.actorSessionId).toBe(staff2.sessionId);
    expect(correctAccEvt.targetSessionId).toBe(saboteur.sessionId);
    expect(correctAccEvt.valid).toBe(true);
    expect(correctAccEvt.wasTargetSaboteur).toBe(true);
    expect(correctAccEvt.crimeOccurred).toBe(true);
  });

  it("event log emission produces authoritative JSONL telemetry with 1Hz coverage samples", async () => {
    const { room, clients, clock } = await setupGame();
    const saboteur = clients[0];
    const staff1 = clients[1];

    // Advance clock by a few seconds to emit 1Hz coverage samples
    await clock.advance(3000);

    // Perform an action
    placePlayer(room, staff1.sessionId, "1-0");
    (room as any).handleChannelStart(staff1, { type: "prep", roomId: "1-0" });
    await clock.advance(PREP_TIME_MS);

    // Sabotage
    room.state.rooms.get("1-1")!.state = "prepped";
    placePlayer(room, saboteur.sessionId, "1-1");
    (room as any).handleChannelStart(saboteur, { type: "unprep", roomId: "1-1" });
    await clock.advance(UNPREP_TIME_MS);

    // Staff enters trashed room -> discovery
    placePlayer(room, staff1.sessionId, "1-1");
    (room as any).handleMove(staff1, { dx: 0, dy: 0, seq: 1 });

    // Accuse to end round
    (room as any).handleAccusation(staff1, {
      targetSessionId: saboteur.sessionId,
    });

    const jsonl = room.getTelemetryJsonl();
    expect(typeof jsonl).toBe("string");
    expect(jsonl.length).toBeGreaterThan(0);

    const lines = jsonl.trim().split("\n");
    expect(lines.length).toBeGreaterThan(5);

    const parsedRecords = lines.map((line) => JSON.parse(line));

    // Must start with round_start
    expect(parsedRecords[0].type).toBe("round_start");
    expect(parsedRecords[0].saboteurSessionId).toBe(saboteur.sessionId);
    expect(parsedRecords[0].playerCount).toBe(4);

    // Must contain coverage_sample records
    const coverageSamples = parsedRecords.filter((r) => r.type === "coverage_sample");
    expect(coverageSamples.length).toBeGreaterThanOrEqual(3);
    for (const sample of coverageSamples) {
      expect(typeof sample.timestamp).toBe("number");
      expect(typeof sample.coverage).toBe("number");
      expect(typeof sample.coveragePercent).toBe("number");
      expect(typeof sample.preppedCount).toBe("number");
      expect(typeof sample.trashedCount).toBe("number");
      expect(typeof sample.cleanCount).toBe("number");
    }

    // Must contain discrete events
    const prepRecords = parsedRecords.filter((r) => r.type === "prep");
    expect(prepRecords.length).toBe(1);
    expect(prepRecords[0].actorSessionId).toBe(staff1.sessionId);
    expect(prepRecords[0].roomId).toBe("1-0");

    const sabotageRecords = parsedRecords.filter((r) => r.type === "sabotage");
    expect(sabotageRecords.length).toBe(1);
    expect(sabotageRecords[0].actorSessionId).toBe(saboteur.sessionId);
    expect(sabotageRecords[0].roomId).toBe("1-1");

    const discoveryRecords = parsedRecords.filter((r) => r.type === "discovery");
    expect(discoveryRecords.length).toBe(1);
    expect(discoveryRecords[0].actorSessionId).toBe(staff1.sessionId);
    expect(discoveryRecords[0].roomId).toBe("1-1");
    expect(discoveryRecords[0].timeSinceCrimeMs).toBeGreaterThanOrEqual(0);

    const accusationRecords = parsedRecords.filter((r) => r.type === "accusation");
    expect(accusationRecords.length).toBe(1);
    expect(accusationRecords[0].valid).toBe(true);

    // Must end with round_end
    const roundEndRecords = parsedRecords.filter((r) => r.type === "round_end");
    expect(roundEndRecords.length).toBe(1);
    expect(roundEndRecords[0].winner).toBe("staff");
  });
});
