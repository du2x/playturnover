import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PREP_TIME_MS, UNPREP_TIME_MS } from "@grandhotel/shared";
import { getRoomRect, type RoomStateType } from "@grandhotel/shared";
import { HotelRoom } from "../src/rooms/HotelRoom.js";
import { canStartChannel, applyChannelCompletion } from "../src/channels.js";
import type { ChannelType } from "@grandhotel/shared";

function mockClient(sessionId: string): any {
  const c: any = { sessionId, _sent: [] as Array<{ type: string; data: unknown }> };
  c.send = (type: string, data: unknown) => {
    c._sent.push({ type, data });
  };
  c.getSent = () => c._sent;
  c.getErrors = () => c._sent.filter((s: { type: string; data: unknown }) => s.type === "error");
  return c;
}

async function createRoomWithPlayers(count: number): Promise<{ room: HotelRoom; clients: any[] }> {
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

function startRoomWithSaboteur(room: HotelRoom, clients: any[], saboteurIndex: number): any {
  vi.spyOn(Math, "random").mockReturnValue(saboteurIndex / clients.length);
  (room as any).handleStartRound(clients[0], {});
  vi.restoreAllMocks();
  return clients[saboteurIndex];
}

function putPlayerInside(room: HotelRoom, sessionId: string, roomId: string): void {
  const rect = getRoomRect(roomId);
  const p = room.state.players.get(sessionId)!;
  p.floor = rect.floor;
  p.x = (rect.xMin + rect.xMax) / 2;
}

function putPlayerOutside(room: HotelRoom, sessionId: string, roomId: string): void {
  const rect = getRoomRect(roomId);
  const p = room.state.players.get(sessionId)!;
  p.floor = rect.floor;
  // Position in the gap just left of the room; rooms away from the hallway
  // left edge (e.g. not 1-0) keep this value outside after clamp.
  p.x = rect.xMin - Math.floor((rect.xMax - rect.xMin) / 2);
}

describe("prep channel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("constants come from shared single source of truth", () => {
    expect(PREP_TIME_MS).toBe(5000);
    expect(UNPREP_TIME_MS).toBe(3000);
  });

  it("clean room stays clean at t+4999, becomes prepped at t+5000", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoomWithSaboteur(room, clients, 0);
    const player = clients[1]; // staff
    const roomId = "1-0";
    putPlayerInside(room, player.sessionId, roomId);

    expect(room.state.rooms.get(roomId)!.state).toBe("clean");
    (room as any).handleChannelStart(player, { type: "prep", roomId });
    expect(room.state.players.get(player.sessionId)!.activeChannel).toBe("prep");

    await vi.advanceTimersByTimeAsync(PREP_TIME_MS - 1);
    expect(room.state.rooms.get(roomId)!.state).toBe("clean");

    await vi.advanceTimersByTimeAsync(1);
    expect(room.state.rooms.get(roomId)!.state).toBe("prepped");
    expect(room.state.players.get(player.sessionId)!.activeChannel).toBeNull();
    expect((room as any).getActiveChannel(player.sessionId)).toBeNull();
  });

  it("moving out at t+2500 leaves room clean", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoomWithSaboteur(room, clients, 0);
    const player = clients[1];
    const roomId = "1-2";
    putPlayerInside(room, player.sessionId, roomId);

    (room as any).handleChannelStart(player, { type: "prep", roomId });
    await vi.advanceTimersByTimeAsync(2500);
    putPlayerOutside(room, player.sessionId, roomId);
    (room as any).handleMove(player, { dx: -100, dy: 0, seq: 1 });

    expect(room.state.rooms.get(roomId)!.state).toBe("clean");
    expect(room.state.players.get(player.sessionId)!.activeChannel).toBeNull();

    await vi.advanceTimersByTimeAsync(PREP_TIME_MS);
    expect(room.state.rooms.get(roomId)!.state).toBe("clean");
  });

  it("prep in non-clean room is rejected with wrong-state", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoomWithSaboteur(room, clients, 0);
    const player = clients[1];
    const roomId = "1-0";
    putPlayerInside(room, player.sessionId, roomId);
    room.state.rooms.get(roomId)!.state = "prepped";

    (room as any).handleChannelStart(player, { type: "prep", roomId });
    const err = player.getErrors()[0];
    expect(err).toBeDefined();
    expect((err!.data as any).reason).toBe("wrong-state");
    expect(room.state.rooms.get(roomId)!.state).toBe("prepped");
  });

  it("second start while channeling is rejected with already-channeling", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoomWithSaboteur(room, clients, 0);
    const player = clients[1];
    const roomId = "1-0";
    putPlayerInside(room, player.sessionId, roomId);

    (room as any).handleChannelStart(player, { type: "prep", roomId });
    (room as any).handleChannelStart(player, { type: "prep", roomId });

    const errors = player.getErrors();
    expect(errors).toHaveLength(1);
    expect((errors[0]!.data as any).reason).toBe("already-channeling");
  });
});

describe("unprep and re-trash", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("saboteur unpreps prepped→trashed after UNPREP_TIME_MS", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    const saboteur = startRoomWithSaboteur(room, clients, 1);
    const roomId = "2-3";
    room.state.rooms.get(roomId)!.state = "prepped";
    putPlayerInside(room, saboteur.sessionId, roomId);

    (room as any).handleChannelStart(saboteur, { type: "unprep", roomId });
    expect(room.state.players.get(saboteur.sessionId)!.activeChannel).toBe("unprep");

    await vi.advanceTimersByTimeAsync(UNPREP_TIME_MS - 1);
    expect(room.state.rooms.get(roomId)!.state).toBe("prepped");

    await vi.advanceTimersByTimeAsync(1);
    expect(room.state.rooms.get(roomId)!.state).toBe("trashed");
    expect(room.state.players.get(saboteur.sessionId)!.activeChannel).toBeNull();
  });

  it("staff unprep attempt rejected with not-saboteur", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoomWithSaboteur(room, clients, 1);
    const staff = clients[0];
    const roomId = "2-3";
    room.state.rooms.get(roomId)!.state = "prepped";
    putPlayerInside(room, staff.sessionId, roomId);

    (room as any).handleChannelStart(staff, { type: "unprep", roomId });
    const err = staff.getErrors()[0];
    expect(err).toBeDefined();
    expect((err!.data as any).reason).toBe("not-saboteur");
    expect(room.state.rooms.get(roomId)!.state).toBe("prepped");
  });

  it("saboteur re-trashes trashed→trashed after another UNPREP_TIME_MS", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    const saboteur = startRoomWithSaboteur(room, clients, 2);
    const roomId = "3-1";
    room.state.rooms.get(roomId)!.state = "trashed";
    putPlayerInside(room, saboteur.sessionId, roomId);

    (room as any).handleChannelStart(saboteur, { type: "unprep", roomId });
    await vi.advanceTimersByTimeAsync(UNPREP_TIME_MS);
    expect(room.state.rooms.get(roomId)!.state).toBe("trashed");
  });

  it("early walk-out at 1500ms leaves room prepped", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    const saboteur = startRoomWithSaboteur(room, clients, 0);
    const roomId = "1-7";
    room.state.rooms.get(roomId)!.state = "prepped";
    putPlayerInside(room, saboteur.sessionId, roomId);

    (room as any).handleChannelStart(saboteur, { type: "unprep", roomId });
    await vi.advanceTimersByTimeAsync(1500);
    putPlayerOutside(room, saboteur.sessionId, roomId);
    (room as any).handleMove(saboteur, { dx: -10, dy: 0, seq: 1 });

    expect(room.state.rooms.get(roomId)!.state).toBe("prepped");
    expect(room.state.players.get(saboteur.sessionId)!.activeChannel).toBeNull();

    await vi.advanceTimersByTimeAsync(UNPREP_TIME_MS);
    expect(room.state.rooms.get(roomId)!.state).toBe("prepped");
  });
});

describe("fake prep identical", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("saboteur fake-prep on clean room keeps room clean at and after PREP_TIME_MS", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    const saboteur = startRoomWithSaboteur(room, clients, 3);
    const roomId = "1-2";
    putPlayerInside(room, saboteur.sessionId, roomId);

    (room as any).handleChannelStart(saboteur, { type: "fake", roomId });
    expect(room.state.players.get(saboteur.sessionId)!.activeChannel).toBe("fake");

    await vi.advanceTimersByTimeAsync(PREP_TIME_MS - 1);
    expect(room.state.rooms.get(roomId)!.state).toBe("clean");

    await vi.advanceTimersByTimeAsync(1);
    expect(room.state.rooms.get(roomId)!.state).toBe("clean");
    expect(room.state.players.get(saboteur.sessionId)!.activeChannel).toBeNull();
  });

  it("staff fake-prep attempt rejected with not-saboteur", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoomWithSaboteur(room, clients, 3);
    const staff = clients[0];
    const roomId = "1-2";
    putPlayerInside(room, staff.sessionId, roomId);

    (room as any).handleChannelStart(staff, { type: "fake", roomId });
    const err = staff.getErrors()[0];
    expect(err).toBeDefined();
    expect((err!.data as any).reason).toBe("not-saboteur");
  });

  it("fake-prep duration equals real prep duration", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    const saboteur = startRoomWithSaboteur(room, clients, 0);
    const fakeRoom = "1-3";
    const realRoom = "1-4";
    putPlayerInside(room, saboteur.sessionId, fakeRoom);

    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    (room as any).handleChannelStart(saboteur, { type: "fake", roomId: fakeRoom });
    const fakeChannel = (room as any).getActiveChannel(saboteur.sessionId);
    vi.restoreAllMocks();

    expect(fakeChannel.type).toBe("fake");
    expect(fakeChannel.endsAt - fakeChannel.startedAt).toBe(PREP_TIME_MS);
    expect(PREP_TIME_MS).toBe(5000);
  });
});

describe("channel cancel cleanly", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const cases: Array<{ type: ChannelType; initialState: RoomStateType; saboteurOnly: boolean }> = [
    { type: "prep", initialState: "clean", saboteurOnly: false },
    { type: "unprep", initialState: "prepped", saboteurOnly: true },
    { type: "fake", initialState: "prepped", saboteurOnly: true },
  ];

  for (const c of cases) {
    it(`${c.type}: explicit cancel leaves room state unchanged and clears active channel`, async () => {
      const { room, clients } = await createRoomWithPlayers(4);
      const actorIndex = c.saboteurOnly ? 2 : 1;
      const actor = c.saboteurOnly
        ? startRoomWithSaboteur(room, clients, actorIndex)
        : clients[actorIndex];
      if (!c.saboteurOnly) startRoomWithSaboteur(room, clients, 0);
      const roomId = "1-5";
      room.state.rooms.get(roomId)!.state = c.initialState;
      putPlayerInside(room, actor.sessionId, roomId);

      (room as any).handleChannelStart(actor, { type: c.type, roomId });
      expect((room as any).getActiveChannel(actor.sessionId)).not.toBeNull();

      (room as any).handleChannelCancel(actor, {});
      expect(room.state.rooms.get(roomId)!.state).toBe(c.initialState);
      expect(room.state.players.get(actor.sessionId)!.activeChannel).toBeNull();
      expect((room as any).getActiveChannel(actor.sessionId)).toBeNull();
    });

    it(`${c.type}: walk-out cancels without state change`, async () => {
      const { room, clients } = await createRoomWithPlayers(4);
      const actorIndex = c.saboteurOnly ? 2 : 1;
      const actor = c.saboteurOnly
        ? startRoomWithSaboteur(room, clients, actorIndex)
        : clients[actorIndex];
      if (!c.saboteurOnly) startRoomWithSaboteur(room, clients, 0);
      const roomId = "1-5";
      room.state.rooms.get(roomId)!.state = c.initialState;
      putPlayerInside(room, actor.sessionId, roomId);

      (room as any).handleChannelStart(actor, { type: c.type, roomId });
      await vi.advanceTimersByTimeAsync(c.type === "unprep" ? 1500 : 2500);

      putPlayerOutside(room, actor.sessionId, roomId);
      (room as any).handleMove(actor, { dx: -10, dy: 0, seq: 1 });

      expect(room.state.rooms.get(roomId)!.state).toBe(c.initialState);
      expect(room.state.players.get(actor.sessionId)!.activeChannel).toBeNull();
      expect((room as any).getActiveChannel(actor.sessionId)).toBeNull();
    });

    it(`${c.type}: floor change via elevator cancels without state change`, async () => {
      const { room, clients } = await createRoomWithPlayers(4);
      const actorIndex = c.saboteurOnly ? 2 : 1;
      const actor = c.saboteurOnly
        ? startRoomWithSaboteur(room, clients, actorIndex)
        : clients[actorIndex];
      if (!c.saboteurOnly) startRoomWithSaboteur(room, clients, 0);
      const roomId = "1-5";
      room.state.rooms.get(roomId)!.state = c.initialState;
      putPlayerInside(room, actor.sessionId, roomId);

      (room as any).handleChannelStart(actor, { type: c.type, roomId });

      // teleport the player to another floor as if via elevator
      const p = room.state.players.get(actor.sessionId)!;
      p.floor = 2;
      (room as any).cancelChannel(actor.sessionId);

      expect(room.state.rooms.get(roomId)!.state).toBe(c.initialState);
      expect(room.state.players.get(actor.sessionId)!.activeChannel).toBeNull();
      expect((room as any).getActiveChannel(actor.sessionId)).toBeNull();
    });
  }
});

// Pure helpers unit test (edge case guard)
describe("channels pure helpers", () => {
  it("canStartChannel rejects when phase is not playing", () => {
    const result = canStartChannel("prep", "1-0", "s0", true, "waiting", "clean", false, false, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-playing");
  });

  it("canStartChannel rejects already channeling", () => {
    const result = canStartChannel("prep", "1-0", "s0", true, "playing", "clean", false, true, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("already-channeling");
  });

  it("canStartChannel returns duration from shared constants", () => {
    const prep = canStartChannel("prep", "1-0", "s0", true, "playing", "clean", false, false, 1000);
    expect(prep.ok).toBe(true);
    if (prep.ok) expect(prep.channel.endsAt - prep.channel.startedAt).toBe(PREP_TIME_MS);

    const unp = canStartChannel("unprep", "1-0", "s0", true, "playing", "prepped", true, false, 1000);
    expect(unp.ok).toBe(true);
    if (unp.ok) expect(unp.channel.endsAt - unp.channel.startedAt).toBe(UNPREP_TIME_MS);

    const fake = canStartChannel("fake", "1-0", "s0", true, "playing", "clean", true, false, 1000);
    expect(fake.ok).toBe(true);
    if (fake.ok) expect(fake.channel.endsAt - fake.channel.startedAt).toBe(PREP_TIME_MS);
  });

  it("applyChannelCompletion transitions correctly", () => {
    expect(applyChannelCompletion("prep", "clean")).toBe("prepped");
    expect(applyChannelCompletion("prep", "prepped")).toBe("prepped");
    expect(applyChannelCompletion("unprep", "prepped")).toBe("trashed");
    expect(applyChannelCompletion("unprep", "trashed")).toBe("trashed");
    expect(applyChannelCompletion("fake", "clean")).toBe("clean");
    expect(applyChannelCompletion("fake", "prepped")).toBe("prepped");
  });
});
