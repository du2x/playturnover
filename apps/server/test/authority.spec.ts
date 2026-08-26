import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HALLWAY_MIN_X, HALLWAY_MAX_X, SERVER_MAX_SPEED_PX_S } from "@grandhotel/shared";
import { getRoomRect } from "@grandhotel/shared";
import { HotelRoom } from "../src/rooms/HotelRoom.js";

function mockClient(sessionId: string): any {
  const c: any = { sessionId, _sent: [] as Array<{ type: string; data: unknown }> };
  c.send = (type: string, data: unknown) => {
    c._sent.push({ type, data });
  };
  c.getResults = () => c._sent.find((s: { type: string; data: unknown }) => s.type === "results")?.data;
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

describe("authority", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("spoofed client messages cannot set roles", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoom(room, clients, 0);
    const original = (room as any).getRoleFor(clients[1].sessionId);

    // Attempt to inject a role field through move message (no such capability)
    (room as any).handleMove(clients[1], { dx: 0, dy: 0, seq: 1, role: "saboteur" } as any);

    expect((room as any).getRoleFor(clients[1].sessionId)).toBe(original);
  });

  it("spoofed messages cannot set winner directly", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoom(room, clients, 0);

    // There is no handler to set winner via client message, but movement should ignore winner in payload
    (room as any).handleMove(clients[0], { dx: 10, winner: "saboteur" } as any);
    expect(room.state.winner).toBeNull();
    expect(room.state.phase).toBe("playing");
  });

  it("spoofed messages cannot set elevator positions", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoom(room, clients, 0);
    const car = room.state.elevators.get("A")!;
    const originalFloor = car.floor;

    (room as any).handleMove(clients[0], { dx: 10, elevator: { A: { floor: 2 } } } as any);
    expect(car.floor).toBe(originalFloor);
  });

  it("spoofed messages cannot set room state directly", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoom(room, clients, 0);
    const roomId = "1-0";
    const originalState = room.state.rooms.get(roomId)!.state;

    (room as any).handleMove(clients[0], { dx: 0, roomStates: { [roomId]: "prepped" } } as any);
    expect(room.state.rooms.get(roomId)!.state).toBe(originalState);
  });

  it("spoofed direct state mutation from client does not occur; roleMap assignment happens only via startRound", async () => {
    const { room, clients } = await createRoomWithPlayers(2);
    // No startRound; no roles assigned.
    expect((room as any).getSaboteurSessionId()).toBeNull();
    expect((room as any).getRoleFor(clients[0].sessionId)).toBeNull();
  });

  it("movement clamp rejects oversized dx beyond SERVER_MAX_SPEED_PX_S * dt", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoom(room, clients, 0);
    const p = room.state.players.get(clients[0].sessionId)!;

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    (room as any).lastMoveAt.set(clients[0].sessionId, now - 100);

    p.x = HALLWAY_MIN_X + 100;
    (room as any).handleMove(clients[0], { dx: 50_000, dy: 0, seq: 1 });

    const maxDelta = SERVER_MAX_SPEED_PX_S * 0.1;
    expect(p.x).toBeLessThanOrEqual(HALLWAY_MIN_X + 100 + maxDelta);
    expect(p.x).toBeLessThanOrEqual(HALLWAY_MAX_X);
  });

  it("non-host cannot start round and therefore cannot assign roles", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    (room as any).handleStartRound(clients[1], {});
    expect(room.state.phase).toBe("waiting");
    expect((room as any).getSaboteurSessionId()).toBeNull();
  });

  it("only inside-room channel can change room state; staff cannot unprep", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoom(room, clients, 1);
    const staff = clients[0];
    const roomId = "1-0";
    room.state.rooms.get(roomId)!.state = "prepped";
    putPlayerInside(room, staff.sessionId, roomId);

    (room as any).handleChannelStart(staff, { type: "unprep", roomId });
    expect(room.state.rooms.get(roomId)!.state).toBe("prepped");
    expect(staff._sent.some((s: { type: string; data: unknown }) => (s.data as any).reason === "not-saboteur")).toBe(true);
  });
});
