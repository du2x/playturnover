import { describe, it, expect, vi } from "vitest";
import { getRoomRect, isInsideRoom } from "@grandhotel/shared";
import { HotelRoom } from "../src/rooms/HotelRoom.js";

function mockClient(sessionId: string): any {
  return { sessionId } as unknown as import("colyseus").Client;
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

function startRoom(room: HotelRoom, clients: any[], saboteurIndex = 0): void {
  vi.spyOn(Math, "random").mockReturnValue(saboteurIndex / clients.length);
  (room as any).handleStartRound(clients[0], {});
  vi.restoreAllMocks();
}

function putPlayerInside(room: HotelRoom, sessionId: string, roomId: string): void {
  const rect = getRoomRect(roomId);
  const p = room.state.players.get(sessionId)!;
  p.floor = rect.floor;
  p.x = (rect.xMin + rect.xMax) / 2;
}

function putPlayerInHallway(room: HotelRoom, sessionId: string, floor: number): void {
  const p = room.state.players.get(sessionId)!;
  p.floor = floor;
  // gap after 2-3 in the 8-room layout to ensure we are outside any room
  const rect = getRoomRect("2-3");
  p.x = rect.xMax + 4;
}

describe("room visibility", () => {
  it("getVisibleRooms uses shared isInsideRoom and hides rooms when outside", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoom(room, clients, 0);

    const insideRoom = "2-4";
    putPlayerInside(room, clients[0].sessionId, insideRoom);
    putPlayerInHallway(room, clients[1].sessionId, 2);

    expect(isInsideRoom(room.state.players.get(clients[0].sessionId)!.x, 2, insideRoom)).toBe(true);
    expect(room.state.players.get(clients[1].sessionId)!.x).toBeGreaterThan(getRoomRect("2-3").xMax);
    expect(isInsideRoom(room.state.players.get(clients[1].sessionId)!.x, 2, insideRoom)).toBe(false);

    const visible0 = room.getVisibleRooms(clients[0].sessionId);
    const visible1 = room.getVisibleRooms(clients[1].sessionId);

    expect(visible0[insideRoom]).toBe("clean");
    expect(visible1[insideRoom]).toBeUndefined();
  });

  it("moving into a room makes it visible in getVisibleRooms", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoom(room, clients, 0);

    const roomId = "1-3";
    room.state.rooms.get(roomId)!.state = "prepped";

    putPlayerInHallway(room, clients[0].sessionId, 1);
    expect(room.getVisibleRooms(clients[0].sessionId)[roomId]).toBeUndefined();

    putPlayerInside(room, clients[0].sessionId, roomId);
    expect(room.getVisibleRooms(clients[0].sessionId)[roomId]).toBe("prepped");
  });

  it("unknown session id returns empty record", async () => {
    const room = new HotelRoom();
    await room.onCreate({});
    expect(room.getVisibleRooms("missing")).toEqual({});
  });

  it("lobby floor returns no visible rooms", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoom(room, clients, 0);
    putPlayerInHallway(room, clients[0].sessionId, 0);
    expect(Object.keys(room.getVisibleRooms(clients[0].sessionId))).toHaveLength(0);
  });
});
