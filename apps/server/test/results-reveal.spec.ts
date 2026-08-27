import { describe, it, expect, vi } from "vitest";
import { ROOM_COUNT, TraitorReveal } from "@grandhotel/shared";
import { HotelRoom } from "../src/rooms/HotelRoom.js";
import { VirtualClock } from "../src/time.js";

function mockClient(sessionId: string): any {
  const c: any = { sessionId, _sent: [] as Array<{ type: string; data: unknown }> };
  c.send = (type: string, data: unknown) => {
    c._sent.push({ type, data });
  };
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
    await room.onJoin(c, { name: `Player${i}` });
    clients.push(c);
  }
  return { room, clients, clock };
}

function startRoom(room: HotelRoom, clients: any[], saboteurIndex = 0): void {
  vi.spyOn(Math, "random").mockReturnValue(saboteurIndex / clients.length);
  (room as any).handleStartRound(clients[0], {});
  vi.restoreAllMocks();
}

describe("results v1 reveal", () => {
  it("staff coverage win exposes phase, winner, traitorReveal with correct name", async () => {
    const { room, clients, clock } = await createRoomWithPlayers(4);
    startRoom(room, clients, 2);
    const saboteurId = clients[2].sessionId as string;
    const saboteurName = room.state.players.get(saboteurId)!.name;

    for (const [id, rd] of room.state.rooms.entries()) {
      rd.state = "prepped";
      void id;
    }

    // advance continuously to (and just past) the buzzer so the 1000ms
    // interval fires with now >= shiftEndsAt
    await clock.advance(room.state.shiftEndsAt - clock.now() + 1);

    expect(room.state.phase).toBe("results");
    expect(room.state.winner).toBe("staff");
    expect(room.state.traitorReveal).toBeInstanceOf(TraitorReveal);
    expect(room.state.traitorReveal!.sessionId).toBe(saboteurId);
    expect(room.state.traitorReveal!.name).toBe(saboteurName);

    const results = clients[0].getResults();
    expect(results).toBeDefined();
    expect((results as any).winner).toBe("staff");
    expect((results as any).traitorReveal.sessionId).toBe(saboteurId);
    expect((results as any).traitorReveal.name).toBe(saboteurName);

    const serialized = JSON.stringify(room.state);
    expect(serialized).not.toMatch(/"events"/);
    expect(serialized).not.toMatch(/"recap"/);
    expect(serialized).not.toMatch(/"timeline"/);
  });

  it("attrition saboteur win exposes correct traitor reveal", async () => {
    const { room, clients } = await createRoomWithPlayers(4);
    startRoom(room, clients, 1);
    const saboteurId = clients[1].sessionId as string;
    const saboteurName = room.state.players.get(saboteurId)!.name;

    await room.onLeave(clients[2]);
    await room.onLeave(clients[3]);

    expect(room.state.phase).toBe("results");
    expect(room.state.winner).toBe("saboteur");
    expect(room.state.traitorReveal).toBeInstanceOf(TraitorReveal);
    expect(room.state.traitorReveal!.sessionId).toBe(saboteurId);
    expect(room.state.traitorReveal!.name).toBe(saboteurName);
  });

  it("coverage computed as preppedCount / ROOM_COUNT", async () => {
    const { room, clients, clock } = await createRoomWithPlayers(4);
    startRoom(room, clients, 0);

    let prepped = 0;
    for (const [id, rd] of room.state.rooms.entries()) {
      if (prepped >= 18) break;
      rd.state = "prepped";
      prepped++;
      void id;
    }

    await clock.advance(room.state.shiftEndsAt - clock.now() + 1);

    expect(room.state.coverage).toBeCloseTo(18 / ROOM_COUNT, 8);
    expect(room.state.winner).toBe("saboteur");
  });
});
