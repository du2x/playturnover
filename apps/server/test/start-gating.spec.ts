import { describe, it, expect } from "vitest";
import { HALLWAY_MIN_X, HALLWAY_MAX_X, LOBBY_CENTER } from "@grandhotel/shared";
import { HotelRoom } from "../src/rooms/HotelRoom.js";
import { VirtualClock } from "../src/time.js";

function mockClient(sessionId: string): any {
  const c: any = { sessionId, _sent: [] as Array<{ type: string; data: unknown }> };
  c.send = (type: string, data: unknown) => {
    c._sent.push({ type, data });
  };
  c.getSent = () => c._sent;
  return c as unknown as import("colyseus").Client & { _sent: Array<{ type: string; data: unknown }>; getSent: () => Array<{ type: string; data: unknown }> };
}

describe("start gating", () => {
  it("3 clients startRound rejected stays waiting with need-4-players error", async () => {
    const clock = new VirtualClock();
    const room = new HotelRoom(clock);
    await room.onCreate({});
    const c0 = mockClient("s0");
    const c1 = mockClient("s1");
    const c2 = mockClient("s2");
    await room.onJoin(c0, { name: "A" });
    await room.onJoin(c1, { name: "B" });
    await room.onJoin(c2, { name: "C" });
    expect(room.state.hostSessionId).toBe("s0");
    expect(room.state.phase).toBe("waiting");
    // host attempts start
    (room as any).handleStartRound(c0, {});
    expect(room.state.phase).toBe("waiting");
    const sent = (c0 as any)._sent as Array<{ type: string; data: unknown }>;
    const err = sent.find((s) => s.type === "error");
    expect(err).toBeDefined();
    expect((err!.data as any).reason).toBe("need-4-players");
    // still waiting, shift not set
    expect(room.state.shiftEndsAt).toBe(0);
  });

  it("non-host startRound ignored, phase stays waiting", async () => {
    const clock = new VirtualClock();
    const room = new HotelRoom(clock);
    await room.onCreate({});
    const c0 = mockClient("s0");
    const c1 = mockClient("s1");
    const c2 = mockClient("s2");
    const c3 = mockClient("s3");
    await room.onJoin(c0, { name: "A" });
    await room.onJoin(c1, { name: "B" });
    await room.onJoin(c2, { name: "C" });
    await room.onJoin(c3, { name: "D" });
    // non-host tries
    (room as any).handleStartRound(c1, {});
    expect(room.state.phase).toBe("waiting");
  });

  it("4 clients succeeds to playing, positions inside lobby bounds", async () => {
    const clock = new VirtualClock();
    const room = new HotelRoom(clock);
    await room.onCreate({});
    const clients = [mockClient("s0"), mockClient("s1"), mockClient("s2"), mockClient("s3")];
    for (let i = 0; i < clients.length; i++) {
      await room.onJoin(clients[i], { name: `P${i}` });
    }
    // move players away before start to ensure spawn resets
    room.state.players.get("s1")!.x = HALLWAY_MIN_X + 10;
    room.state.players.get("s1")!.floor = 2;
    room.state.players.get("s2")!.x = HALLWAY_MAX_X - 10;
    room.state.players.get("s2")!.floor = 1;

    const host = clients[0];
    // freeze the virtual clock for deterministic shiftEndsAt
    const now = 1_700_000_000_000;
    clock.setNow(now);
    (room as any).handleStartRound(host, {});

    expect(room.state.phase).toBe("playing");
    expect(room.state.shiftEndsAt).toBe(now + 300 * 1000);
    // all players at lobby center floor 0
    for (const p of room.state.players.values()) {
      expect(p.floor).toBe(0);
      expect(p.x).toBe(LOBBY_CENTER.x);
      expect(p.x).toBeGreaterThanOrEqual(HALLWAY_MIN_X);
      expect(p.x).toBeLessThanOrEqual(HALLWAY_MAX_X);
    }
  });

  it("shiftLengthSOverride respected", async () => {
    const clock = new VirtualClock();
    const room = new HotelRoom(clock);
    await room.onCreate({ shiftLengthSOverride: 10 });
    const clients = [mockClient("s0"), mockClient("s1"), mockClient("s2"), mockClient("s3")];
    for (let i = 0; i < clients.length; i++) {
      await room.onJoin(clients[i], { name: `P${i}` });
    }
    const now = 1_800_000_000_000;
    clock.setNow(now);
    (room as any).handleStartRound(clients[0], {});
    expect(room.state.shiftEndsAt).toBe(now + 10 * 1000);
  });
});
