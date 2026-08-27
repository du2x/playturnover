import { describe, it, expect } from "vitest";
import { initialState, uiReducer, filterCodeInput } from "./reducer.js";
import { ROOM_CODE_ALPHABET } from "@grandhotel/shared";
import type { RoomStateView } from "../net/GameClient.js";
import type { ElevatorShaft } from "@grandhotel/shared";

function makeView(overrides?: Partial<RoomStateView>): RoomStateView {
  return {
    players: [
      {
        id: "a1",
        name: "Alice",
        colorIndex: 0,
        x: 100,
        floor: 0,
        fired: false,
        spectator: false,
      },
    ],
    phase: "waiting",
    roomCode: null,
    mySessionId: "a1",
    hostSessionId: "a1",
    myRole: null,
    myFloor: 0,
    roomsView: {},
    elevatorsView: {
      A: { floor: 0, state: "idle" },
      B: { floor: 0, state: "idle" },
    },
    shiftEndsAt: null,
    winner: null,
    traitorReveal: null,
    recapEvents: [],
    ...overrides,
  };
}

describe("ui reducer — lobby flow (M0.3.3)", () => {
  it("empty name blocked — stays idle with error", () => {
    let s = initialState;
    expect(s.screen).toBe("idle");
    s = uiReducer(s, { type: "submitName", name: "" });
    expect(s.screen).toBe("idle");
    expect(s.error).toMatch(/Name required/i);

    s = uiReducer(initialState, { type: "submitName", name: "   " });
    expect(s.screen).toBe("idle");
    expect(s.error).toBeDefined();

    // valid name should transition to Named
    s = uiReducer(initialState, { type: "submitName", name: "  Alice  " });
    expect(s.screen).toBe("named");
    if (s.screen === "named") {
      expect(s.name).toBe("Alice");
      expect(s.error).toBeUndefined();
    }
  });

  it("valid code path transitions to InRoom", () => {
    let s = uiReducer(initialState, { type: "submitName", name: "Bob" });
    expect(s.screen).toBe("named");
    // code input filtering
    s = uiReducer(s, { type: "setCodeInput", code: "ab12" });
    if (s.screen === "named") {
      // ab12 contains 1 which is not in alphabet (1 filtered), so should uppercase and filter
      // Check that filtered result only contains alphabet chars
      for (const ch of s.codeInput) {
        expect(ROOM_CODE_ALPHABET).toContain(ch);
      }
      expect(s.codeInput.length).toBeLessThanOrEqual(4);
    }

    // direct join path: Named -> InRoom
    s = uiReducer(s, { type: "joined", code: "ABCD" });
    expect(s.screen).toBe("inRoom");
    if (s.screen === "inRoom") {
      expect(s.name).toBe("Bob");
      expect(s.code).toBe("ABCD");
      expect(s.view).toBeNull();
    }

    // also createRoom path
    let s2 = uiReducer(initialState, { type: "submitName", name: "Cara" });
    s2 = uiReducer(s2, { type: "createRoom", code: "WXYZ" });
    expect(s2.screen).toBe("inRoom");
    if (s2.screen === "inRoom") expect(s2.code).toBe("WXYZ");

    // stateUpdate populates view
    const view = makeView({
      phase: "playing",
      hostSessionId: "a1",
      mySessionId: "a1",
    });
    let s3 = uiReducer(s2, { type: "stateUpdate", view });
    expect(s3.screen).toBe("inRoom");
    if (s3.screen === "inRoom") {
      expect(s3.view?.phase).toBe("playing");
      expect(s3.view?.players[0]?.name).toBe("Alice");
    }
  });

  it("rejected event surfaces reason into state.error", () => {
    let s = uiReducer(initialState, { type: "submitName", name: "Dave" });
    s = uiReducer(s, { type: "joined", code: "ABCD" });
    expect(s.screen).toBe("inRoom");
    s = uiReducer(s, {
      type: "clientEvent",
      event: { type: "rejected", reason: "full" },
    });
    expect(s.error).toMatch(/full/i);
    expect(s.error).toMatch(/Rejected/i);

    // also bad-name
    s = uiReducer(initialState, { type: "submitName", name: "Eve" });
    s = uiReducer(s, {
      type: "clientEvent",
      event: { type: "rejected", reason: "bad-name" },
    });
    expect(s.error).toMatch(/bad-name/i);

    // generic error surfaces message
    s = uiReducer(s, {
      type: "clientEvent",
      event: { type: "error", message: "boom" },
    });
    expect(s.error).toBe("boom");
  });

  it("start gating error surfaces reason into state.error", () => {
    let s = uiReducer(initialState, { type: "submitName", name: "Host" });
    s = uiReducer(s, { type: "joined", code: "ABCD" });
    s = uiReducer(s, {
      type: "clientEvent",
      event: { type: "rejected", reason: "need-4-players" },
    });
    expect(s.error).toMatch(/need-4-players/i);

    s = uiReducer(s, {
      type: "clientEvent",
      event: { type: "rejected", reason: "not-saboteur" },
    });
    expect(s.error).toMatch(/not-saboteur/i);
  });

  it("stateUpdate carries new RoomStateView fields", () => {
    const view = makeView({
      myRole: "staff",
      myFloor: 2,
      roomsView: { "2-0": "clean", "2-1": null },
      elevatorsView: {
        A: { floor: 1, state: "arriving" } as {
          floor: number;
          state: "idle" | "arriving" | "boarding";
        },
        B: { floor: 2, state: "idle" },
      },
      shiftEndsAt: 123456,
      winner: null,
      traitorReveal: null,
    });
    let s = uiReducer(initialState, { type: "submitName", name: "Observer" });
    s = uiReducer(s, { type: "joined", code: "WXYZ" });
    s = uiReducer(s, { type: "stateUpdate", view });
    expect(s.screen).toBe("inRoom");
    if (s.screen === "inRoom") {
      expect(s.view?.myRole).toBe("staff");
      expect(s.view?.myFloor).toBe(2);
      expect(s.view?.roomsView["2-0"]).toBe("clean");
      expect(s.view?.roomsView["2-1"]).toBeNull();
      expect(s.view?.elevatorsView.A.floor).toBe(1);
      expect(s.view?.shiftEndsAt).toBe(123456);
    }
  });

  it("results: banner state surfaces winner and traitor reveal", () => {
    const view = makeView({
      phase: "results",
      winner: "saboteur",
      traitorReveal: { sessionId: "sess-traitor", name: "Morgana" },
    });
    let s = uiReducer(initialState, { type: "submitName", name: "Wren" });
    s = uiReducer(s, { type: "joined", code: "PQRS" });
    s = uiReducer(s, { type: "stateUpdate", view });
    expect(s.screen).toBe("inRoom");
    if (s.screen === "inRoom") {
      expect(s.view?.phase).toBe("results");
      expect(s.view?.winner).toBe("saboteur");
      expect(s.view?.traitorReveal).toEqual({
        sessionId: "sess-traitor",
        name: "Morgana",
      });
    }
  });

  it("filterCodeInput uppercase and alphabet-only, truncates to 4", () => {
    expect(filterCodeInput("abci")).toBe("ABC"); // i not in alphabet, filtered
    expect(filterCodeInput("abcd")).toBe("ABCD");
    expect(filterCodeInput("ABCDEF")).toBe("ABCD"); // truncated
    expect(filterCodeInput("a1b2")).toBe("AB2"); // 1 not in alphabet, 2 is
    // ensure all chars in returned are alphabet
    const out = filterCodeInput("xyz1!@");
    for (const ch of out) expect(ROOM_CODE_ALPHABET).toContain(ch);
    expect(out.length).toBeLessThanOrEqual(4);
  });

  it("code input is filtered on setCodeInput", () => {
    let s = uiReducer(initialState, { type: "submitName", name: "Frank" });
    s = uiReducer(s, { type: "setCodeInput", code: "ab12" });
    if (s.screen === "named") {
      // should be uppercase, alphabet filtered
      expect(s.codeInput).toBe(filterCodeInput("ab12"));
    }
    s = uiReducer(s, { type: "setCodeInput", code: "WXYZ" });
    if (s.screen === "named") expect(s.codeInput).toBe("WXYZ");
  });
});
