import { describe, expect, it, vi } from "vitest";
import { getRoomRect, UNPREP_TIME_MS } from "@grandhotel/shared";
import { HotelRoom } from "../src/rooms/HotelRoom.js";
import { VirtualClock } from "../src/time.js";

function mockClient(sessionId: string): any {
  return { sessionId, send: vi.fn() };
}

async function setup(): Promise<{
  room: HotelRoom;
  clients: any[];
  clock: VirtualClock;
}> {
  const clock = new VirtualClock();
  const room = new HotelRoom(clock);
  await room.onCreate({});
  const clients = ["p0", "p1", "p2", "p3"].map(mockClient);
  for (let index = 0; index < clients.length; index++) {
    await room.onJoin(clients[index], { name: `P${index}` });
  }
  vi.spyOn(Math, "random").mockReturnValue(0);
  (room as any).handleStartRound(clients[0], {});
  vi.restoreAllMocks();
  return { room, clients, clock };
}

function place(room: HotelRoom, sessionId: string, roomId: string): void {
  const rect = getRoomRect(roomId);
  const player = room.state.players.get(sessionId)!;
  player.floor = rect.floor;
  player.x = (rect.xMin + rect.xMax) / 2;
}

describe("M3 justice", () => {
  it("walk-in immediately fires the saboteur", async () => {
    const { room, clients, clock } = await setup();
    const saboteur = clients[0];
    const entrant = clients[1];
    const roomId = "1-0";
    room.state.rooms.get(roomId)!.state = "prepped";
    place(room, saboteur.sessionId, roomId);
    (room as any).handleChannelStart(saboteur, { type: "unprep", roomId });

    place(room, entrant.sessionId, roomId);
    (room as any).handleMove(entrant, { dx: 0, dy: 0, seq: 1 });

    expect(room.state.players.get(saboteur.sessionId)!.fired).toBe(true);
    expect(room.state.players.get(saboteur.sessionId)!.spectator).toBe(true);
    expect(room.state.phase).toBe("results");
    expect(room.state.winner).toBe("staff");
    expect([...room.state.recapEvents].map((event) => event?.type)).toEqual([
      "catch",
    ]);
    await clock.advance(UNPREP_TIME_MS);
    expect(room.state.rooms.get(roomId)!.state).toBe("prepped");
  });

  it("treats a pre-crime accusation as wrong and fires the accuser", async () => {
    const { room, clients } = await setup();
    const accuser = clients[1];
    const saboteur = clients[0];
    place(room, accuser.sessionId, "1-1");
    place(room, saboteur.sessionId, "1-1");

    (room as any).handleAccusation(accuser, {
      targetSessionId: saboteur.sessionId,
    });

    expect(room.state.players.get(accuser.sessionId)!.fired).toBe(true);
    expect(room.state.players.get(saboteur.sessionId)!.fired).toBe(false);
    expect(room.state.phase).toBe("playing");
    expect(room.state.recapEvents.at(0)?.valid).toBe(false);
  });

  it("fires the saboteur after the first completed crime", async () => {
    const { room, clients, clock } = await setup();
    const saboteur = clients[0];
    const accuser = clients[1];
    const roomId = "1-2";
    room.state.rooms.get(roomId)!.state = "prepped";
    place(room, saboteur.sessionId, roomId);
    (room as any).handleChannelStart(saboteur, { type: "unprep", roomId });
    await clock.advance(UNPREP_TIME_MS);

    place(room, accuser.sessionId, roomId);
    (room as any).handleAccusation(accuser, {
      targetSessionId: saboteur.sessionId,
    });

    expect(room.state.players.get(saboteur.sessionId)!.fired).toBe(true);
    expect(room.state.players.get(accuser.sessionId)!.fired).toBe(false);
    expect(room.state.phase).toBe("results");
    expect(room.state.winner).toBe("staff");
    expect([...room.state.recapEvents].map((event) => event?.type)).toEqual([
      "sabotage",
      "accusation",
    ]);
    expect(room.state.recapEvents.at(1)?.valid).toBe(true);
  });
});
