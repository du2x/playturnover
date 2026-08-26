import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { COVERAGE_TARGET, ROOM_COUNT, SHIFT_LENGTH_S } from "@grandhotel/shared";
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

function setRoomsPrepped(room: HotelRoom, count: number): void {
  let left = count;
  for (const [id, rd] of room.state.rooms.entries()) {
    if (left <= 0) break;
    rd.state = "prepped";
    left--;
  }
}

describe("buzzer coverage win", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("uses SHIFT_LENGTH_S and ROOM_COUNT from shared constants", () => {
    expect(SHIFT_LENGTH_S).toBe(300);
    expect(ROOM_COUNT).toBe(24);
    expect(COVERAGE_TARGET).toBe(0.8);
    expect(Math.ceil(ROOM_COUNT * COVERAGE_TARGET)).toBe(20);
  });

  it("mid-shift winner stays null", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoom(room, clients, 0);

    // fast-forward partway, but not to buzzer
    await vi.advanceTimersByTimeAsync(1000 * 150);
    expect(room.state.phase).toBe("playing");
    expect(room.state.winner).toBeNull();
  });

  it("staff wins when coverage >= COVERAGE_TARGET at buzzer", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoom(room, clients, 0);

    setRoomsPrepped(room, 20);

    const now = room.state.shiftEndsAt;
    vi.spyOn(Date, "now").mockReturnValue(now);

    await vi.advanceTimersByTimeAsync(1000);

    expect(room.state.phase).toBe("results");
    expect(room.state.winner).toBe("staff");
    const cov = room.state.coverage;
    expect(cov).toBeCloseTo(20 / 24, 8);
    expect(cov).toBeGreaterThanOrEqual(COVERAGE_TARGET);
  });

  it("saboteur wins when coverage < COVERAGE_TARGET at buzzer", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoom(room, clients, 0);

    setRoomsPrepped(room, 12);

    const now = room.state.shiftEndsAt;
    vi.spyOn(Date, "now").mockReturnValue(now);

    await vi.advanceTimersByTimeAsync(1000);

    expect(room.state.phase).toBe("results");
    expect(room.state.winner).toBe("saboteur");
    const cov = room.state.coverage;
    expect(cov).toBeCloseTo(12 / 24, 8);
    expect(cov).toBeLessThan(COVERAGE_TARGET);
  });

  it("timer interval respects shiftLengthSOverride", async () => {
    const room = new HotelRoom();
    await room.onCreate({ shiftLengthSOverride: 5 });
    const clients = [mockClient("s0"), mockClient("s1"), mockClient("s2"), mockClient("s3")];
    for (let i = 0; i < clients.length; i++) await room.onJoin(clients[i], { name: `P${i}` });

    const now = 1_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    startRoom(room, clients, 0);
    expect(room.state.shiftEndsAt).toBe(now + 5 * 1000);

    setRoomsPrepped(room, 20);
    vi.spyOn(Date, "now").mockReturnValue(now + 5 * 1000);

    await vi.advanceTimersByTimeAsync(1000);
    expect(room.state.phase).toBe("results");
    expect(room.state.winner).toBe("staff");
  });
});
