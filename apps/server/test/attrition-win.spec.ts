import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("attrition win", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("4-player round, disconnect two staff so 1 staff remains -> saboteur attrition win", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    // saboteur at index 1 => staff are s0, s2, s3
    startRoom(room, clients, 1);

    const saboteur = clients[1];
    expect((room as any).getSaboteurSessionId()).toBe(saboteur.sessionId);

    // disconnect two staff before buzzer
    await room.onLeave(clients[2]);
    expect(room.state.phase).toBe("playing");

    await room.onLeave(clients[3]);

    expect(room.state.phase).toBe("results");
    expect(room.state.winner).toBe("saboteur");

    const results = (clients[0] as any).getResults();
    expect(results).toBeDefined();
    expect((results as any).winner).toBe("saboteur");
  });

  it("disconnecting the saboteur alone does not end the round", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    // saboteur at index 2 => staff are s0, s1, s3
    startRoom(room, clients, 2);

    await room.onLeave(clients[2]);

    expect(room.state.phase).toBe("playing");
    expect(room.state.winner).toBeNull();
    expect(room.state.traitorReveal).toBeNull();
  });

  it("attrition overrides the timer and fires before buzzer", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoom(room, clients, 0); // saboteur s0, staff s1, s2, s3

    const now = Date.now();
    // buzzer would be at now + 300s; we disconnect two staff long before that
    vi.spyOn(Date, "now").mockReturnValue(now + 5_000);

    await room.onLeave(clients[2]);
    expect(room.state.phase).toBe("playing");
    await room.onLeave(clients[3]);

    expect(room.state.phase).toBe("results");
    expect(room.state.winner).toBe("saboteur");
    expect(clients[1].getResults()).toBeDefined();
  });
});
