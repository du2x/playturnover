import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HALLWAY_MAX_X,
  HALLWAY_MIN_X,
  MAX_PLAYERS,
  SERVER_MAX_SPEED_PX_S,
} from "@grandhotel/shared";
import { HotelRoom, computeClampedX } from "../src/rooms/HotelRoom.js";

function mockClient(sessionId: string): any {
  return { sessionId } as unknown as import("colyseus").Client;
}

describe("HotelRoom — roster & cap (V-4)", () => {
  it("sets maxClients to MAX_PLAYERS via shared constant", async () => {
    const room = new HotelRoom();
    await room.onCreate({});
    expect(room.maxClients).toBe(MAX_PLAYERS);
    expect(MAX_PLAYERS).toBe(6);
  });

  it("six joins succeed, seventh rejected, roster stays 6", async () => {
    const room = new HotelRoom();
    await room.onCreate({});

    for (let i = 0; i < MAX_PLAYERS; i++) {
      const c = mockClient(`s${i}`);
      await room.onJoin(c, { name: `Player${i}` });
    }
    expect(room.state.players.size).toBe(6);
    // hasReachedMaxClients depends on internal clients array (managed by Server);
    // our direct Room.onJoin doesn't populate it, but maxClients is authoritative
    expect(room.maxClients).toBe(MAX_PLAYERS);
    expect(room.state.players.size).toBe(MAX_PLAYERS);

    const extra = mockClient("s6");
    await expect(room.onJoin(extra, { name: "Extra" })).rejects.toThrow(
      /full/,
    );
    expect(room.state.players.size).toBe(6);

    // roster contains six names
    const names = [...room.state.players.values()].map((p) => p.name);
    expect(names).toHaveLength(6);
  });

  it("validates display name: trimmed non-empty ≤24 chars, bad-name rejected", async () => {
    const room = new HotelRoom();
    await room.onCreate({});

    const c1 = mockClient("a1");
    await expect(room.onJoin(c1, { name: "" })).rejects.toThrow(/bad-name/);
    const c2 = mockClient("a2");
    await expect(room.onJoin(c2, { name: "   " })).rejects.toThrow(/bad-name/);
    const c3 = mockClient("a3");
    await expect(
      room.onJoin(c3, { name: "x".repeat(25) }),
    ).rejects.toThrow(/bad-name/);

    const c4 = mockClient("a4");
    await room.onJoin(c4, { name: "  Alice  " });
    expect(room.state.players.get("a4")?.name).toBe("Alice");
    expect(room.state.players.size).toBe(1);
  });

  it("assigns colorIndex by seat and midpoint x, first joiner becomes host", async () => {
    const room = new HotelRoom();
    await room.onCreate({});
    const host = mockClient("host");
    const other = mockClient("other");
    await room.onJoin(host, { name: "Host" });
    expect(room.state.hostSessionId).toBe("host");
    expect(room.state.players.get("host")?.colorIndex).toBe(0);
    const expectedMid = (HALLWAY_MIN_X + HALLWAY_MAX_X) / 2;
    expect(room.state.players.get("host")?.x).toBe(expectedMid);

    await room.onJoin(other, { name: "Other" });
    expect(room.state.players.get("other")?.colorIndex).toBe(1);
    // host stays
    expect(room.state.hostSessionId).toBe("host");
  });

  it("host leave reassigns to earliest remaining", async () => {
    const room = new HotelRoom();
    await room.onCreate({});
    const c0 = mockClient("s0");
    const c1 = mockClient("s1");
    const c2 = mockClient("s2");
    await room.onJoin(c0, { name: "A" });
    await room.onJoin(c1, { name: "B" });
    await room.onJoin(c2, { name: "C" });
    expect(room.state.hostSessionId).toBe("s0");
    await room.onLeave(c0);
    expect(room.state.hostSessionId).toBe("s1");
    await room.onLeave(c1);
    expect(room.state.hostSessionId).toBe("s2");
    await room.onLeave(c2);
    expect(room.state.hostSessionId).toBe("");
  });
});

describe("HotelRoom — lifecycle phases (V-7)", () => {
  it("initial phase waiting, host advance stepwise to playing then results with null payload", async () => {
    const room = new HotelRoom();
    await room.onCreate({});
    const host = mockClient("host1");
    const other = mockClient("other1");
    await room.onJoin(host, { name: "Host" });
    await room.onJoin(other, { name: "Other" });

    expect(room.state.phase).toBe("waiting");
    expect(room.state.resultsPayload).toBeNull();

    // both clients would observe waiting initially — simulate by checking room state
    const observedByHost: string[] = [room.state.phase];
    const observedByOther: string[] = [room.state.phase];

    // host advance → playing
    (room as any).handleAdvancePhase(host, {});
    expect(room.state.phase).toBe("playing");
    observedByHost.push(room.state.phase);
    observedByOther.push(room.state.phase);

    // non-host advance refused
    (room as any).handleAdvancePhase(other, {});
    expect(room.state.phase).toBe("playing");
    // no new entry added for refused attempt
    expect(observedByHost).toEqual(["waiting", "playing"]);
    expect(observedByOther).toEqual(["waiting", "playing"]);

    // second host advance → results
    (room as any).handleAdvancePhase(host, {});
    expect(room.state.phase).toBe("results");
    expect(room.state.resultsPayload).toBeNull();
    // no winner/traitor keys
    const serialized = JSON.stringify(room.state);
    expect(serialized).not.toMatch(/winner/i);
    expect(serialized).not.toMatch(/traitor/i);

    observedByHost.push(room.state.phase);
    observedByOther.push(room.state.phase);

    expect(observedByHost).toEqual(["waiting", "playing", "results"]);
    expect(observedByOther).toEqual(["waiting", "playing", "results"]);

    // further advance refused
    (room as any).handleAdvancePhase(host, {});
    expect(room.state.phase).toBe("results");
  });

  it("non-host cannot advance from waiting", async () => {
    const room = new HotelRoom();
    await room.onCreate({});
    const host = mockClient("h");
    const other = mockClient("o");
    await room.onJoin(host, { name: "Host" });
    await room.onJoin(other, { name: "Other" });
    (room as any).handleAdvancePhase(other, {});
    expect(room.state.phase).toBe("waiting");
  });
});

describe("HotelRoom — movement clamp unit (V-5 / V-6 server half)", () => {
  it("legal moves pass through", () => {
    // dt 0.1 → maxDelta 33, use mid values away from hallway bounds (96..864)
    expect(computeClampedX(400, 10, 0.1)).toBe(410);
    expect(computeClampedX(400, -10, 0.1)).toBe(390);
    // exactly at limit
    expect(computeClampedX(400, 33, 0.1)).toBe(433);
  });

  it(">max-speed*dt snaps down", () => {
    // dt 0.1 → 33
    expect(computeClampedX(400, 1000, 0.1)).toBe(400 + 33);
    expect(computeClampedX(400, -1000, 0.1)).toBe(400 - 33);
    // dt 0.5 → 165
    expect(computeClampedX(400, 500, 0.5)).toBe(400 + 165);
  });

  it("hard-clamps to hallway bounds", () => {
    expect(computeClampedX(HALLWAY_MIN_X, -1000, 1)).toBe(HALLWAY_MIN_X);
    expect(computeClampedX(HALLWAY_MAX_X, 1000, 1)).toBe(HALLWAY_MAX_X);
    // near bounds with large dx
    expect(computeClampedX(HALLWAY_MAX_X - 10, 1000, 1)).toBe(HALLWAY_MAX_X);
    expect(computeClampedX(HALLWAY_MIN_X + 10, -1000, 1)).toBe(HALLWAY_MIN_X);
  });

  it("ignores dy and rides schema: handler writes to state.players[sessionId].x", async () => {
    const room = new HotelRoom();
    await room.onCreate({});
    const c = mockClient("mover");
    await room.onJoin(c, { name: "Mover" });
    const startX = room.state.players.get("mover")!.x;

    // control time: set lastMoveAt to 100ms ago then send move
    const now = Date.now();
    (room as any).lastMoveAt.set("mover", now - 100);
    const realNow = Date.now;
    // stub Date.now to return now
    vi.spyOn(Date, "now").mockReturnValue(now);

    (room as any).handleMove(c, { dx: 10, dy: 999, seq: 1 });
    // dy ignored, dx 10 within 33 limit, so moved
    expect(room.state.players.get("mover")!.x).toBe(computeClampedX(startX, 10, 0.1));

    // large jump should be clamped
    const before = room.state.players.get("mover")!.x;
    // set last to now again, then advance 100ms
    (room as any).lastMoveAt.set("mover", now);
    vi.spyOn(Date, "now").mockReturnValue(now + 100);
    (room as any).handleMove(c, { dx: 1000, dy: 0, seq: 2 });
    const maxDelta = SERVER_MAX_SPEED_PX_S * 0.1;
    expect(room.state.players.get("mover")!.x).toBe(before + maxDelta);

    // invalid MoveMsg ignored (no crash, no move)
    const stable = room.state.players.get("mover")!.x;
    (room as any).lastMoveAt.set("mover", now + 100);
    vi.spyOn(Date, "now").mockReturnValue(now + 200);
    (room as any).handleMove(c, { dx: "bad" as unknown as number, dy: 0, seq: 3 });
    expect(room.state.players.get("mover")!.x).toBe(stable);

    vi.restoreAllMocks();
    // restore Date.now
    (Date.now as any) = realNow;
  });

  it("movement uses per-player lastMoveAt isolation", async () => {
    const room = new HotelRoom();
    await room.onCreate({});
    const a = mockClient("a");
    const b = mockClient("b");
    await room.onJoin(a, { name: "A" });
    await room.onJoin(b, { name: "B" });

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    (room as any).lastMoveAt.set("a", now - 100);
    (room as any).lastMoveAt.set("b", now - 100);

    (room as any).handleMove(a, { dx: 20, dy: 0, seq: 1 });
    const ax = room.state.players.get("a")!.x;
    const bxBefore = room.state.players.get("b")!.x;
    // b hasn't moved
    expect(bxBefore).toBe((HALLWAY_MIN_X + HALLWAY_MAX_X) / 2);
    // a moved
    expect(ax).not.toBe(bxBefore);

    vi.restoreAllMocks();
  });
});
