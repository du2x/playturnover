import { describe, expect, it, vi, afterEach } from "vitest";
import {
  ACCUSATION_RANGE_TILES,
  getRoomRect,
  TILE_SIZE_PX,
  UNPREP_TIME_MS,
} from "@grandhotel/shared";
import { HotelRoom } from "../src/rooms/HotelRoom.js";
import { VirtualClock } from "../src/time.js";

function mockClient(sessionId: string): any {
  const c: any = { sessionId, _sent: [] as Array<{ type: string; data: unknown }> };
  c.send = vi.fn((type: string, data: unknown) => {
    c._sent.push({ type, data });
  });
  c.getSent = () => c._sent;
  c.getResults = () => c._sent.find((s: { type: string; data: unknown }) => s.type === "results")?.data;
  return c;
}

async function createRoomWithPlayers(count: number): Promise<{
  room: HotelRoom;
  clients: any[];
  clock: VirtualClock;
}> {
  const clock = new VirtualClock();
  const room = new HotelRoom(clock);
  await room.onCreate({});
  const clients: any[] = [];
  for (let i = 0; i < count; i++) {
    const c = mockClient(`p${i}`);
    await room.onJoin(c, { name: `P${i}` });
    clients.push(c);
  }
  return { room, clients, clock };
}

function startRoomWithSaboteur(room: HotelRoom, clients: any[], saboteurIndex: number): any {
  vi.spyOn(Math, "random").mockReturnValue(saboteurIndex / clients.length);
  (room as any).handleStartRound(clients[0], {});
  vi.restoreAllMocks();
  return clients[saboteurIndex];
}

function placeAt(room: HotelRoom, sessionId: string, floor: number, x: number): void {
  const p = room.state.players.get(sessionId)!;
  p.floor = floor;
  p.x = x;
}

function placeInside(room: HotelRoom, sessionId: string, roomId: string): void {
  const rect = getRoomRect(roomId);
  placeAt(room, sessionId, rect.floor, (rect.xMin + rect.xMax) / 2);
}

describe("accusation constraints", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accusation constraints: rejects saboteur attempting to accuse", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    const saboteur = startRoomWithSaboteur(room, clients, 0); // p0 = saboteur
    const staff = clients[1];

    placeAt(room, saboteur.sessionId, 1, 200);
    placeAt(room, staff.sessionId, 1, 220); // within range on same floor

    (room as any).handleAccusation(saboteur, {
      targetSessionId: staff.sessionId,
    });

    // Saboteur cannot accuse -> rejected, no state changes, no events
    expect(room.state.players.get(saboteur.sessionId)!.fired).toBe(false);
    expect(room.state.players.get(staff.sessionId)!.fired).toBe(false);
    expect(room.state.phase).toBe("playing");
    expect(room.state.recapEvents).toHaveLength(0);
  });

  it("accusation constraints: rejects accusation across different floors", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoomWithSaboteur(room, clients, 0); // p0 = saboteur
    const staff1 = clients[1];
    const staff2 = clients[2];

    placeAt(room, staff1.sessionId, 1, 200);
    placeAt(room, staff2.sessionId, 2, 200); // same x, different floor

    (room as any).handleAccusation(staff1, {
      targetSessionId: staff2.sessionId,
    });

    expect(room.state.players.get(staff1.sessionId)!.fired).toBe(false);
    expect(room.state.players.get(staff2.sessionId)!.fired).toBe(false);
    expect(room.state.recapEvents).toHaveLength(0);
  });

  it("accusation constraints: rejects accusation beyond ACCUSATION_RANGE_TILES", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoomWithSaboteur(room, clients, 0);
    const staff1 = clients[1];
    const staff2 = clients[2];

    const maxDistancePx = ACCUSATION_RANGE_TILES * TILE_SIZE_PX; // 64px
    placeAt(room, staff1.sessionId, 1, 200);
    placeAt(room, staff2.sessionId, 1, 200 + maxDistancePx + 1); // 65px (out of range)

    (room as any).handleAccusation(staff1, {
      targetSessionId: staff2.sessionId,
    });

    expect(room.state.players.get(staff1.sessionId)!.fired).toBe(false);
    expect(room.state.players.get(staff2.sessionId)!.fired).toBe(false);
    expect(room.state.recapEvents).toHaveLength(0);
  });

  it("accusation constraints: accepts accusation at exact boundary ACCUSATION_RANGE_TILES", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoomWithSaboteur(room, clients, 0);
    const staff1 = clients[1];
    const staff2 = clients[2];

    const maxDistancePx = ACCUSATION_RANGE_TILES * TILE_SIZE_PX; // 64px
    placeAt(room, staff1.sessionId, 1, 200);
    placeAt(room, staff2.sessionId, 1, 200 + maxDistancePx); // 64px (in range)

    (room as any).handleAccusation(staff1, {
      targetSessionId: staff2.sessionId,
    });

    // In range, wrong accusation against innocent staff -> accuser fired
    expect(room.state.players.get(staff1.sessionId)!.fired).toBe(true);
    expect(room.state.players.get(staff2.sessionId)!.fired).toBe(false);
    expect(room.state.recapEvents).toHaveLength(1);
  });

  it("accusation constraints: rejects self-target accusation", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoomWithSaboteur(room, clients, 0);
    const staff = clients[1];

    placeAt(room, staff.sessionId, 1, 200);

    (room as any).handleAccusation(staff, {
      targetSessionId: staff.sessionId,
    });

    expect(room.state.players.get(staff.sessionId)!.fired).toBe(false);
    expect(room.state.recapEvents).toHaveLength(0);
  });

  it("accusation constraints: rejects targeting already fired player", async () => {
    const { room, clients } = await createRoomWithPlayers(5);
    startRoomWithSaboteur(room, clients, 0);
    const staff1 = clients[1];
    const staff2 = clients[2];
    const staff3 = clients[3];

    placeAt(room, staff1.sessionId, 1, 200);
    placeAt(room, staff2.sessionId, 1, 210);
    placeAt(room, staff3.sessionId, 1, 220);

    // staff1 makes wrong accusation against staff2 -> staff1 is fired
    (room as any).handleAccusation(staff1, {
      targetSessionId: staff2.sessionId,
    });
    expect(room.state.players.get(staff1.sessionId)!.fired).toBe(true);

    // staff3 attempts to accuse staff1 (who is already fired)
    (room as any).handleAccusation(staff3, {
      targetSessionId: staff1.sessionId,
    });

    // Rejected: staff3 is not fired, no second recap event added
    expect(room.state.players.get(staff3.sessionId)!.fired).toBe(false);
    expect(room.state.recapEvents).toHaveLength(1);
  });

  it("accusation constraints: rejects fired/spectator player attempting to accuse", async () => {
    const { room, clients } = await createRoomWithPlayers(5);
    startRoomWithSaboteur(room, clients, 0);
    const staff1 = clients[1];
    const staff2 = clients[2];
    const staff3 = clients[3];

    placeAt(room, staff1.sessionId, 1, 200);
    placeAt(room, staff2.sessionId, 1, 210);
    placeAt(room, staff3.sessionId, 1, 220);

    // staff1 makes wrong accusation -> staff1 fired
    (room as any).handleAccusation(staff1, {
      targetSessionId: staff2.sessionId,
    });
    expect(room.state.players.get(staff1.sessionId)!.fired).toBe(true);

    // staff1 attempts to accuse staff3 while fired
    (room as any).handleAccusation(staff1, {
      targetSessionId: staff3.sessionId,
    });

    // Rejected: staff3 remains active, no new event
    expect(room.state.players.get(staff3.sessionId)!.fired).toBe(false);
    expect(room.state.recapEvents).toHaveLength(1);
  });
});

describe("accusation grace period", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accusation grace period: accusing saboteur before first completed crime fires accuser", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    const saboteur = startRoomWithSaboteur(room, clients, 0); // p0 = saboteur
    const accuser = clients[1]; // p1 = staff

    placeAt(room, accuser.sessionId, 1, 300);
    placeAt(room, saboteur.sessionId, 1, 310);

    // Saboteur has NOT completed any un-prep crime yet
    (room as any).handleAccusation(accuser, {
      targetSessionId: saboteur.sessionId,
    });

    // Grace period rule: accuser is fired, saboteur is NOT fired
    const accuserState = room.state.players.get(accuser.sessionId)!;
    expect(accuserState.fired).toBe(true);
    expect(accuserState.spectator).toBe(true);

    const saboteurState = room.state.players.get(saboteur.sessionId)!;
    expect(saboteurState.fired).toBe(false);
    expect(saboteurState.spectator).toBe(false);

    // Round continues (2 active staff remain: p2, p3)
    expect(room.state.phase).toBe("playing");
    expect(room.state.winner).toBeNull();

    // Event recorded with valid=false, wasTargetSaboteur=true, crimeOccurred=false
    expect(room.state.recapEvents).toHaveLength(1);
    const event = room.state.recapEvents[0]!;
    expect(event.type).toBe("accusation");
    expect(event.actorSessionId).toBe(accuser.sessionId);
    expect(event.targetSessionId).toBe(saboteur.sessionId);
    expect(event.valid).toBe(false);
    expect(event.wasTargetSaboteur).toBe(true);
    expect(event.crimeOccurred).toBe(false);
  });

  it("accusation grace period: voluntary walk-out does not end grace period", async () => {
    const { room, clients, clock } = await createRoomWithPlayers(4);
    const saboteur = startRoomWithSaboteur(room, clients, 0);
    const accuser = clients[1];
    const roomId = "1-2";

    room.state.rooms.get(roomId)!.state = "prepped";
    placeInside(room, saboteur.sessionId, roomId);

    // Saboteur starts unprep, advances 1s, then cancels via walk-out
    (room as any).handleChannelStart(saboteur, { type: "unprep", roomId });
    await clock.advance(1000);
    (room as any).handleChannelCancel(saboteur, {});

    // Grace period is still active because no un-prep completed
    placeAt(room, accuser.sessionId, 1, 300);
    placeAt(room, saboteur.sessionId, 1, 310);

    (room as any).handleAccusation(accuser, {
      targetSessionId: saboteur.sessionId,
    });

    expect(room.state.players.get(accuser.sessionId)!.fired).toBe(true);
    expect(room.state.players.get(saboteur.sessionId)!.fired).toBe(false);
    expect(room.state.phase).toBe("playing");
    expect(room.state.recapEvents.at(-1)?.valid).toBe(false);
    expect(room.state.recapEvents.at(-1)?.crimeOccurred).toBe(false);
  });

  it("accusation grace period: accusing saboteur after first completed crime fires saboteur and staff wins", async () => {
    const { room, clients, clock } = await createRoomWithPlayers(4);
    const saboteur = startRoomWithSaboteur(room, clients, 0);
    const accuser = clients[1];
    const roomId = "1-2";

    room.state.rooms.get(roomId)!.state = "prepped";
    placeInside(room, saboteur.sessionId, roomId);

    // Saboteur completes unprep crime
    (room as any).handleChannelStart(saboteur, { type: "unprep", roomId });
    await clock.advance(UNPREP_TIME_MS);
    expect(room.state.rooms.get(roomId)!.state).toBe("trashed");

    // Staff accuses saboteur within range
    placeAt(room, accuser.sessionId, 1, 300);
    placeAt(room, saboteur.sessionId, 1, 320);

    (room as any).handleAccusation(accuser, {
      targetSessionId: saboteur.sessionId,
    });

    // Post-grace-period: Saboteur is fired, staff wins
    const saboteurState = room.state.players.get(saboteur.sessionId)!;
    expect(saboteurState.fired).toBe(true);
    expect(saboteurState.spectator).toBe(true);

    const accuserState = room.state.players.get(accuser.sessionId)!;
    expect(accuserState.fired).toBe(false);
    expect(accuserState.spectator).toBe(false);

    expect(room.state.phase).toBe("results");
    expect(room.state.winner).toBe("staff");

    // Recap timeline contains sabotage and accusation
    const accusationEvent = room.state.recapEvents.find((e) => e.type === "accusation");
    expect(accusationEvent).toBeDefined();
    expect(accusationEvent!.valid).toBe(true);
    expect(accusationEvent!.wasTargetSaboteur).toBe(true);
    expect(accusationEvent!.crimeOccurred).toBe(true);
  });

  it("accusation grace period: wrong accusation against innocent staff fires accuser", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoomWithSaboteur(room, clients, 0); // p0 = saboteur
    const accuser = clients[1]; // staff
    const innocent = clients[2]; // staff

    placeAt(room, accuser.sessionId, 1, 200);
    placeAt(room, innocent.sessionId, 1, 220);

    (room as any).handleAccusation(accuser, {
      targetSessionId: innocent.sessionId,
    });

    expect(room.state.players.get(accuser.sessionId)!.fired).toBe(true);
    expect(room.state.players.get(innocent.sessionId)!.fired).toBe(false);
    expect(room.state.phase).toBe("playing");

    const event = room.state.recapEvents[0]!;
    expect(event.valid).toBe(false);
    expect(event.wasTargetSaboteur).toBe(false);
  });

  it("accusation grace period: wrong accusation reducing active staff to 1 triggers saboteur attrition win", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoomWithSaboteur(room, clients, 0); // p0 = saboteur, staff: p1, p2, p3
    const staff1 = clients[1];
    const staff2 = clients[2];
    const staff3 = clients[3];

    placeAt(room, staff1.sessionId, 1, 200);
    placeAt(room, staff2.sessionId, 1, 210);
    placeAt(room, staff3.sessionId, 1, 220);

    // staff1 makes wrong accusation -> 2 active staff left (p2, p3)
    (room as any).handleAccusation(staff1, {
      targetSessionId: staff2.sessionId,
    });
    expect(room.state.phase).toBe("playing");

    // staff2 makes wrong accusation -> 1 active staff left (p3) -> saboteur attrition win!
    (room as any).handleAccusation(staff2, {
      targetSessionId: staff3.sessionId,
    });

    expect(room.state.phase).toBe("results");
    expect(room.state.winner).toBe("saboteur");
  });
});
