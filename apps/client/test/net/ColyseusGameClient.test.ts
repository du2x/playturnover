import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ColyseusGameClient } from "../../src/net/ColyseusGameClient.js";

// Stub a minimal Room/Client for unit tests without Touching colyseus.js internals.
function makeFakeRoom(sessionId: string) {
  const state: Record<string, unknown> = {};
  const stateCbs = new Set<(state: unknown) => void>();
  const msgCbs = new Map<string, Array<(payload: unknown) => void>>();
  const errorCbs = new Set<(code: number, message?: string) => void>();
  const leaveCbs = new Set<(code: number) => void>();
  const sent: Array<{ type: string; payload: unknown }> = [];

  const room = {
    sessionId,
    roomId: "ROOM42",
    id: "ROOM42",
    state: state as unknown,
    onStateChange(cb: (state: unknown) => void) {
      stateCbs.add(cb);
    },
    onMessage(type: string, cb: (payload: unknown) => void) {
      if (!msgCbs.has(type)) msgCbs.set(type, []);
      msgCbs.get(type)!.push(cb);
    },
    onError(cb: (code: number, message?: string) => void) {
      errorCbs.add(cb);
    },
    onLeave(cb: (code: number) => void) {
      leaveCbs.add(cb);
    },
    send(type: string, payload: unknown) {
      sent.push({ type, payload });
    },
    leave() {},
    removeAllListeners() {},
    _setState(patch: Record<string, unknown>) {
      Object.assign(state, patch);
      for (const cb of stateCbs) cb(state);
    },
    _emitMessage(type: string, payload: unknown) {
      for (const cb of msgCbs.get(type) ?? []) cb(payload);
    },
    _sent: sent,
  };
  return room;
}

function makeFakeClient(room: ReturnType<typeof makeFakeRoom>) {
  return {
    joinOrCreate: vi.fn().mockResolvedValue(room),
    joinById: vi.fn().mockResolvedValue(room),
  };
}

describe("ColyseusGameClient", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:2567" } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("caches myRole from private 'role' message and reflects it in view", async () => {
    const room = makeFakeRoom("sess-a");
    const fake = makeFakeClient(room);
    const client = new ColyseusGameClient();
    // @ts-expect-error private field injection for test
    client.client = fake;
    await client.connect("Alice");
    await client.createRoom();

    room._setState({
      players: new Map([["sess-a", { sessionId: "sess-a", name: "Alice", colorIndex: 0, x: 100, floor: 0 }]]),
      phase: "waiting",
      hostSessionId: "sess-a",
      rooms: new Map(),
      elevators: new Map(),
    });

    expect(client.getCachedRole()).toBeNull();

    room._emitMessage("role", { role: "saboteur" });
    expect(client.getCachedRole()).toBe("saboteur");

    const last = client.getLastView();
    expect(last?.myRole).toBe("saboteur");
    expect(last?.myFloor).toBe(0);
  });

  it("sends startRound, callElevator, rideElevator, channelStart, channelCancel messages", async () => {
    const room = makeFakeRoom("sess-b");
    const fake = makeFakeClient(room);
    const client = new ColyseusGameClient();
    // @ts-expect-error private field injection for test
    client.client = fake;
    await client.connect("Bob");
    await client.createRoom();

    client.startRound();
    client.callElevator("A");
    client.rideElevator("B", 2);
    client.startChannel("prep", "1-0");
    client.cancelChannel();

    expect(room._sent).toEqual([
      { type: "startRound", payload: {} },
      { type: "callElevator", payload: { shaft: "A" } },
      { type: "rideElevator", payload: { shaft: "B", destFloor: 2 } },
      { type: "channelStart", payload: { type: "prep", roomId: "1-0" } },
      { type: "channelCancel", payload: {} },
    ]);
  });

  it("room observability: exposes state only when local player is inside", async () => {
    const room = makeFakeRoom("sess-c");
    const fake = makeFakeClient(room);
    const client = new ColyseusGameClient();
    // @ts-expect-error private field injection for test
    client.client = fake;
    await client.connect("Carol");
    await client.createRoom();

    room._emitMessage("role", { role: "staff" });
    // Place player inside room 2-3 (xMin=96+3*96=384, xMax=472)
    room._setState({
      players: new Map([
        ["sess-c", { sessionId: "sess-c", name: "Carol", colorIndex: 0, x: 400, floor: 2 }],
      ]),
      phase: "playing",
      hostSessionId: "sess-c",
      rooms: new Map([
        ["2-3", { id: "2-3", floor: 2, xMin: 384, xMax: 472, state: "prepped" }],
        ["2-4", { id: "2-4", floor: 2, xMin: 480, xMax: 568, state: "clean" }],
      ]),
      elevators: new Map(),
    });

    const last = client.getLastView();
    // lastView is updated by emitState which fires on state change, not via getLastView reflection
    expect(last).not.toBeNull();
    expect(last?.roomsView["2-3"]).toBe("prepped");
    expect(last?.roomsView["2-4"]).toBeNull();

    // Move player out of the room into hallway (x=350 is gap between rooms on floor 2)
    room._setState({
      players: new Map([
        ["sess-c", { sessionId: "sess-c", name: "Carol", colorIndex: 0, x: 350, floor: 2 }],
      ]),
    });

    const moved = client.getLastView();
    expect(moved?.roomsView["2-3"]).toBeNull();
    expect(moved?.roomsView["2-4"]).toBeNull();
  });

  it("results: surfaces winner banner and traitor reveal", async () => {
    const room = makeFakeRoom("sess-e");
    const fake = makeFakeClient(room);
    const client = new ColyseusGameClient();
    // @ts-expect-error private field injection for test
    client.client = fake;
    await client.connect("Eve");
    await client.createRoom();

    room._emitMessage("role", { role: "staff" });
    room._setState({
      players: new Map([["sess-e", { sessionId: "sess-e", name: "Eve", colorIndex: 0, x: 400, floor: 2 }]]),
      phase: "results",
      hostSessionId: "sess-e",
      winner: "staff",
      traitorReveal: { sessionId: "sess-betrayer", name: "Bad Bob" },
      rooms: new Map(),
      elevators: new Map(),
    });

    const last = client.getLastView();
    expect(last?.phase).toBe("results");
    expect(last?.winner).toBe("staff");
    expect(last?.traitorReveal).toEqual({ sessionId: "sess-betrayer", name: "Bad Bob" });
  });

  it("maps server error reasons to client events", async () => {
    const room = makeFakeRoom("sess-d");
    const fake = makeFakeClient(room);
    const client = new ColyseusGameClient();
    // @ts-expect-error private field injection for test
    client.client = fake;
    await client.connect("Dana");
    await client.createRoom();

    const events: Array<{ type: string; reason?: string; message?: string }> = [];
    client.onEvent((ev) => events.push(ev));

    room._emitMessage("error", { reason: "need-4-players" });
    room._emitMessage("error", { reason: "not-saboteur" });
    room._emitMessage("error", { reason: "wrong-state" });
    room._emitMessage("error", { reason: "unknown-problem" });

    expect(events).toEqual([
      { type: "rejected", reason: "need-4-players" },
      { type: "rejected", reason: "not-saboteur" },
      { type: "rejected", reason: "wrong-state" },
      { type: "error", message: "unknown-problem", reason: "unknown-problem" },
    ]);
  });
});
