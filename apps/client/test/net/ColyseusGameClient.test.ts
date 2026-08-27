import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { ClientMock } = vi.hoisted(() => ({
  ClientMock: vi.fn(),
}));

vi.mock("colyseus.js", () => ({
  Client: ClientMock,
}));

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

  it("uses the game server URL when the browser is on a Vite dev port", async () => {
    ClientMock.mockClear();
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });

    const client = new ColyseusGameClient();
    await client.connect("Dev");

    expect(ClientMock).toHaveBeenCalledWith("http://localhost:2567");
    expect(client.getCachedRole()).toBeNull();
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

  it("sends startRound, callElevator, rideElevator, accuse, channelStart, channelCancel messages", async () => {
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
    client.accuse("target-xyz");
    client.startChannel("prep", "1-0");
    client.cancelChannel();

    expect(room._sent).toEqual([
      { type: "startRound", payload: {} },
      { type: "callElevator", payload: { shaft: "A" } },
      { type: "rideElevator", payload: { shaft: "B", destFloor: 2 } },
      { type: "accusation", payload: { targetSessionId: "target-xyz" } },
      { type: "channelStart", payload: { type: "prep", roomId: "1-0" } },
      { type: "channelCancel", payload: {} },
    ]);
  });

  it("decodes fired and spectator player states, and gives spectators full-building visibility", async () => {
    const room = makeFakeRoom("sess-spectator");
    const fake = makeFakeClient(room);
    const client = new ColyseusGameClient();
    // @ts-expect-error private field injection for test
    client.client = fake;
    await client.connect("Spectator");
    await client.createRoom();

    room._setState({
      players: new Map([
        ["sess-spectator", { sessionId: "sess-spectator", name: "Spectator", colorIndex: 0, x: 100, floor: 0, fired: true, spectator: true }],
        ["sess-other", { sessionId: "sess-other", name: "Active", colorIndex: 1, x: 200, floor: 1, fired: false, spectator: false }],
      ]),
      phase: "playing",
      hostSessionId: "sess-spectator",
      rooms: new Map([
        ["1-0", { id: "1-0", floor: 1, xMin: 96, xMax: 184, state: "prepped" }],
        ["2-3", { id: "2-3", floor: 2, xMin: 384, xMax: 472, state: "trashed" }],
      ]),
      elevators: new Map(),
    });

    const view = client.getLastView();
    expect(view?.players[0]?.fired).toBe(true);
    expect(view?.players[0]?.spectator).toBe(true);
    expect(view?.players[1]?.fired).toBe(false);
    expect(view?.players[1]?.spectator).toBe(false);

    // Spectator is on floor 0 x=100 (lobby), but should have full building visibility of all room states
    expect(view?.roomsView["1-0"]).toBe("prepped");
    expect(view?.roomsView["2-3"]).toBe("trashed");
    // All 24 rooms exist in roomsView
    expect(Object.keys(view?.roomsView ?? {}).length).toBe(24);
  });

  it("decodes recapEvents array in results view", async () => {
    const room = makeFakeRoom("sess-recap");
    const fake = makeFakeClient(room);
    const client = new ColyseusGameClient();
    // @ts-expect-error private field injection for test
    client.client = fake;
    await client.connect("RecapTester");
    await client.createRoom();

    room._setState({
      players: new Map([["sess-recap", { sessionId: "sess-recap", name: "RecapTester", colorIndex: 0, x: 100, floor: 0 }]]),
      phase: "results",
      hostSessionId: "sess-recap",
      winner: "staff",
      traitorReveal: { sessionId: "sess-sab", name: "Sab" },
      recapEvents: [
        { type: "prep", actorSessionId: "p1", targetSessionId: "", roomId: "1-0", shaft: "", timestamp: 1000, valid: true, wasTargetSaboteur: false, crimeOccurred: false },
        { type: "call", actorSessionId: "p2", targetSessionId: "", roomId: "", shaft: "A", timestamp: 2000, valid: true, wasTargetSaboteur: false, crimeOccurred: false },
        { type: "sabotage", actorSessionId: "sess-sab", targetSessionId: "", roomId: "1-1", shaft: "", timestamp: 3000, valid: true, wasTargetSaboteur: true, crimeOccurred: true },
        { type: "accusation", actorSessionId: "p1", targetSessionId: "sess-sab", roomId: "", shaft: "", timestamp: 4000, valid: true, wasTargetSaboteur: true, crimeOccurred: true },
      ],
      rooms: new Map(),
      elevators: new Map(),
    });

    const view = client.getLastView();
    expect(view?.recapEvents.length).toBe(4);
    expect(view?.recapEvents[0]).toEqual({
      type: "prep",
      actorSessionId: "p1",
      targetSessionId: "",
      roomId: "1-0",
      shaft: undefined,
      timestamp: 1000,
      valid: true,
      wasTargetSaboteur: false,
      crimeOccurred: false,
    });
    expect(view?.recapEvents[1]?.shaft).toBe("A");
    expect(view?.recapEvents[3]?.wasTargetSaboteur).toBe(true);
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
