import { describe, expect, it, vi, afterEach } from "vitest";
import { getRoomRect, PREP_TIME_MS, UNPREP_TIME_MS } from "@grandhotel/shared";
import type { ChannelType, RoomStateType } from "@grandhotel/shared";
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

function placeInside(room: HotelRoom, sessionId: string, roomId: string): void {
  const rect = getRoomRect(roomId);
  const p = room.state.players.get(sessionId)!;
  p.floor = rect.floor;
  p.x = (rect.xMin + rect.xMax) / 2;
}

function placeOutside(room: HotelRoom, sessionId: string, floor: number, x: number): void {
  const p = room.state.players.get(sessionId)!;
  p.floor = floor;
  p.x = x;
}

describe("walk-in fire", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("walk-in fire: entering room during active un-prep fires saboteur and resolves staff win", async () => {
    const { room, clients, clock } = await createRoomWithPlayers(4);
    const saboteur = startRoomWithSaboteur(room, clients, 0); // p0 = saboteur
    const staff = clients[1]; // p1 = staff
    const roomId = "1-2";

    room.state.rooms.get(roomId)!.state = "prepped";
    placeInside(room, saboteur.sessionId, roomId);

    // Saboteur starts unprep channel
    (room as any).handleChannelStart(saboteur, { type: "unprep", roomId });
    expect(room.state.players.get(saboteur.sessionId)!.activeChannel).toBe("unprep");

    // Advance halfway through unprep
    await clock.advance(UNPREP_TIME_MS / 2);
    expect(room.state.phase).toBe("playing");

    // Staff walks into the room
    placeInside(room, staff.sessionId, roomId);
    (room as any).handleMove(staff, { dx: 0, dy: 0, seq: 1 });

    // Assert saboteur is immediately fired & spectator
    const saboteurState = room.state.players.get(saboteur.sessionId)!;
    expect(saboteurState.fired).toBe(true);
    expect(saboteurState.spectator).toBe(true);
    expect(saboteurState.activeChannel).toBeNull();

    // Staff player is not fired
    const staffState = room.state.players.get(staff.sessionId)!;
    expect(staffState.fired).toBe(false);
    expect(staffState.spectator).toBe(false);

    // Round resolves for staff
    expect(room.state.phase).toBe("results");
    expect(room.state.winner).toBe("staff");

    // Recap event 'catch' recorded authoritatively
    const catchEvent = room.state.recapEvents.find((e) => e.type === "catch");
    expect(catchEvent).toBeDefined();
    expect(catchEvent!.actorSessionId).toBe(staff.sessionId);
    expect(catchEvent!.targetSessionId).toBe(saboteur.sessionId);
    expect(catchEvent!.roomId).toBe(roomId);
    expect(catchEvent!.valid).toBe(true);
    expect(catchEvent!.wasTargetSaboteur).toBe(true);

    // Room was not trashed (remains prepped) even if time advances
    await clock.advance(UNPREP_TIME_MS);
    expect(room.state.rooms.get(roomId)!.state).toBe("prepped");
  });

  it("walk-in fire: entry during fake prep does not fire saboteur or end round", async () => {
    const { room, clients, clock } = await createRoomWithPlayers(4);
    const saboteur = startRoomWithSaboteur(room, clients, 0);
    const staff = clients[1];
    const roomId = "1-2";

    room.state.rooms.get(roomId)!.state = "clean";
    placeInside(room, saboteur.sessionId, roomId);

    (room as any).handleChannelStart(saboteur, { type: "fake", roomId });
    expect(room.state.players.get(saboteur.sessionId)!.activeChannel).toBe("fake");

    await clock.advance(1000);

    // Staff enters the room
    placeInside(room, staff.sessionId, roomId);
    (room as any).handleMove(staff, { dx: 0, dy: 0, seq: 1 });

    expect(room.state.players.get(saboteur.sessionId)!.fired).toBe(false);
    expect(room.state.phase).toBe("playing");
    expect(room.state.winner).toBeNull();
    expect(room.state.recapEvents.filter((e) => e.type === "catch")).toHaveLength(0);
  });

  it("walk-in fire: entry during real prep does not fire anyone", async () => {
    const { room, clients, clock } = await createRoomWithPlayers(4);
    startRoomWithSaboteur(room, clients, 0); // p0 = saboteur
    const staff1 = clients[1];
    const staff2 = clients[2];
    const roomId = "1-3";

    room.state.rooms.get(roomId)!.state = "clean";
    placeInside(room, staff1.sessionId, roomId);

    (room as any).handleChannelStart(staff1, { type: "prep", roomId });
    expect(room.state.players.get(staff1.sessionId)!.activeChannel).toBe("prep");

    await clock.advance(1000);

    // Another staff enters the room
    placeInside(room, staff2.sessionId, roomId);
    (room as any).handleMove(staff2, { dx: 0, dy: 0, seq: 1 });

    expect(room.state.players.get(staff1.sessionId)!.fired).toBe(false);
    expect(room.state.players.get(staff2.sessionId)!.fired).toBe(false);
    expect(room.state.phase).toBe("playing");
  });

  it("walk-in fire: moving outside hallway or in another room does not trigger catch", async () => {
    const { room, clients, clock } = await createRoomWithPlayers(4);
    const saboteur = startRoomWithSaboteur(room, clients, 0);
    const staff = clients[1];
    const roomId = "1-2";

    room.state.rooms.get(roomId)!.state = "prepped";
    placeInside(room, saboteur.sessionId, roomId);

    (room as any).handleChannelStart(saboteur, { type: "unprep", roomId });

    // Staff moves in room 1-3 (adjacent, not same room)
    placeInside(room, staff.sessionId, "1-3");
    (room as any).handleMove(staff, { dx: 0, dy: 0, seq: 1 });

    expect(room.state.players.get(saboteur.sessionId)!.fired).toBe(false);
    expect(room.state.phase).toBe("playing");

    // Staff moves on floor 2 (different floor)
    placeInside(room, staff.sessionId, "2-2");
    (room as any).handleMove(staff, { dx: 0, dy: 0, seq: 2 });

    expect(room.state.players.get(saboteur.sessionId)!.fired).toBe(false);
    expect(room.state.phase).toBe("playing");
  });
});

describe("channel cancel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const channelCases: Array<{
    type: ChannelType;
    initialState: RoomStateType;
    isSaboteur: boolean;
  }> = [
    { type: "prep", initialState: "clean", isSaboteur: false },
    { type: "unprep", initialState: "prepped", isSaboteur: true },
    { type: "fake", initialState: "clean", isSaboteur: true },
  ];

  for (const tc of channelCases) {
    it(`channel cancel: voluntary walk-out cancels ${tc.type} channel without firing`, async () => {
      const { room, clients, clock } = await createRoomWithPlayers(4);
      const actorIndex = tc.isSaboteur ? 0 : 1;
      const actor = tc.isSaboteur
        ? startRoomWithSaboteur(room, clients, 0)
        : clients[1];
      if (!tc.isSaboteur) startRoomWithSaboteur(room, clients, 0);

      const roomId = "1-4";
      room.state.rooms.get(roomId)!.state = tc.initialState;
      placeInside(room, actor.sessionId, roomId);

      (room as any).handleChannelStart(actor, { type: tc.type, roomId });
      expect(room.state.players.get(actor.sessionId)!.activeChannel).toBe(tc.type);

      await clock.advance(tc.type === "unprep" ? 1000 : 2000);

      // Walk out into the hallway gap
      const rect = getRoomRect(roomId);
      placeOutside(room, actor.sessionId, rect.floor, rect.xMin - 4);
      (room as any).handleMove(actor, { dx: -10, dy: 0, seq: 1 });

      // Active channel is cleared
      expect(room.state.players.get(actor.sessionId)!.activeChannel).toBeNull();
      // Actor is NOT fired
      expect(room.state.players.get(actor.sessionId)!.fired).toBe(false);
      expect(room.state.players.get(actor.sessionId)!.spectator).toBe(false);
      // Room state unchanged
      expect(room.state.rooms.get(roomId)!.state).toBe(tc.initialState);
      // Round is still playing
      expect(room.state.phase).toBe("playing");

      // Advance clock past full duration — state must still be unchanged
      await clock.advance(PREP_TIME_MS);
      expect(room.state.rooms.get(roomId)!.state).toBe(tc.initialState);
    });

    it(`channel cancel: explicit cancel msg cancels ${tc.type} channel without firing`, async () => {
      const { room, clients, clock } = await createRoomWithPlayers(4);
      const actorIndex = tc.isSaboteur ? 0 : 1;
      const actor = tc.isSaboteur
        ? startRoomWithSaboteur(room, clients, 0)
        : clients[1];
      if (!tc.isSaboteur) startRoomWithSaboteur(room, clients, 0);

      const roomId = "1-4";
      room.state.rooms.get(roomId)!.state = tc.initialState;
      placeInside(room, actor.sessionId, roomId);

      (room as any).handleChannelStart(actor, { type: tc.type, roomId });
      expect(room.state.players.get(actor.sessionId)!.activeChannel).toBe(tc.type);

      (room as any).handleChannelCancel(actor, {});

      expect(room.state.players.get(actor.sessionId)!.activeChannel).toBeNull();
      expect(room.state.players.get(actor.sessionId)!.fired).toBe(false);
      expect(room.state.rooms.get(roomId)!.state).toBe(tc.initialState);
      expect(room.state.phase).toBe("playing");
    });
  }
});
