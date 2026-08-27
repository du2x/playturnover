import { describe, expect, it, vi } from "vitest";
import {
  FRESHNESS_WINDOW_MS,
  PREP_TIME_MS,
  UNPREP_TIME_MS,
  getRoomRect,
} from "@grandhotel/shared";
import { HotelRoom } from "../src/rooms/HotelRoom.js";
import { VirtualClock } from "../src/time.js";

function client(sessionId: string): any {
  return { sessionId, send: vi.fn() };
}

async function roomWithPlayers(): Promise<{
  room: HotelRoom;
  clients: any[];
  clock: VirtualClock;
}> {
  const clock = new VirtualClock();
  const room = new HotelRoom(clock);
  await room.onCreate({});
  const clients = ["p0", "p1", "p2", "p3"].map(client);
  for (const [index, current] of clients.entries()) {
    await room.onJoin(current, { name: `P${index}` });
  }
  vi.spyOn(Math, "random").mockReturnValue(0);
  (room as any).handleStartRound(clients[0], {});
  vi.restoreAllMocks();
  return { room, clients, clock };
}

function placeInside(room: HotelRoom, sessionId: string, roomId: string): void {
  const rect = getRoomRect(roomId);
  const player = room.state.players.get(sessionId)!;
  player.floor = rect.floor;
  player.x = (rect.xMin + rect.xMax) / 2;
}

describe("M2 server evidence", () => {
  it("hangs a permanent card on prep and updates it on sabotage", async () => {
    const { room, clients, clock } = await roomWithPlayers();
    const roomId = "1-0";
    placeInside(room, clients[1].sessionId, roomId);
    (room as any).handleChannelStart(clients[1], { type: "prep", roomId });
    await clock.advance(PREP_TIME_MS);

    const roomData = room.state.rooms.get(roomId)!;
    expect(roomData.doorCard.present).toBe(true);
    expect(roomData.doorCard.text).toBe("PREPPED");

    placeInside(room, clients[0].sessionId, roomId);
    (room as any).handleChannelStart(clients[0], { type: "unprep", roomId });
    await clock.advance(UNPREP_TIME_MS);
    expect(roomData.state).toBe("trashed");
    expect(roomData.doorCard.present).toBe(true);
    expect(roomData.doorCard.text).toBe("TRASHED");
  });

  it("transitions trash from fresh to settled at the shared boundary", async () => {
    const { room, clients, clock } = await roomWithPlayers();
    const roomId = "1-1";
    const roomData = room.state.rooms.get(roomId)!;
    roomData.state = "prepped";
    placeInside(room, clients[0].sessionId, roomId);
    (room as any).handleChannelStart(clients[0], { type: "unprep", roomId });
    await clock.advance(UNPREP_TIME_MS);

    expect(roomData.trashedAtTime).toBe(3000);
    expect(roomData.freshness).toBe("fresh");
    await clock.advance(FRESHNESS_WINDOW_MS - 1);
    expect(roomData.freshness).toBe("fresh");
    await clock.advance(1);
    expect(roomData.freshness).toBe("settled");
  });

  it("publishes integer coverage percentage", async () => {
    const { room } = await roomWithPlayers();
    let count = 0;
    for (const roomData of room.state.rooms.values()) {
      if (count === 2) break;
      roomData.state = "prepped";
      count += 1;
    }
    (room as any).updateEvidence();
    expect(room.state.coverage).toBeCloseTo(2 / 24);
    expect(room.state.coveragePercent).toBe(8);
  });

  it("emits sabotageEvent on completion but not on walk-out cancellation", async () => {
    const { room, clients, clock } = await roomWithPlayers();
    const roomId = "1-2";
    const roomData = room.state.rooms.get(roomId)!;
    roomData.state = "prepped";
    placeInside(room, clients[0].sessionId, roomId);
    (room as any).handleChannelStart(clients[0], { type: "unprep", roomId });
    await clock.advance(UNPREP_TIME_MS);

    const completionEvents = clients[1].send.mock.calls.filter(
      ([type]: [string]) => type === "sabotageEvent",
    );
    expect(completionEvents).toHaveLength(1);
    expect(completionEvents[0][1]).toMatchObject({
      roomId,
      position: { x: room.state.players.get(clients[0].sessionId)!.x },
      timestamp: UNPREP_TIME_MS,
    });

    roomData.state = "prepped";
    placeInside(room, clients[0].sessionId, roomId);
    (room as any).handleChannelStart(clients[0], { type: "unprep", roomId });
    await clock.advance(UNPREP_TIME_MS - 1);
    room.state.players.get(clients[0].sessionId)!.x = roomData.xMin - 1;
    (room as any).handleMove(clients[0], { dx: 0, dy: 0, seq: 1 });
    await clock.advance(1);

    const allEvents = clients[1].send.mock.calls.filter(
      ([type]: [string]) => type === "sabotageEvent",
    );
    expect(allEvents).toHaveLength(1);
    expect(roomData.state).toBe("prepped");
  });
});
