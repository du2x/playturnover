import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderOverlay } from "../src/ui/screens.js";
import type { RoomStateView } from "../src/net/GameClient.js";
import type { UIState } from "../src/ui/reducer.js";

function makeResultsView(overrides?: Partial<RoomStateView>): RoomStateView {
  return {
    players: [
      { id: "p1", name: "Alice", colorIndex: 0, x: 100, floor: 1, fired: false, spectator: false },
      { id: "p2", name: "Bob", colorIndex: 1, x: 200, floor: 1, fired: false, spectator: false },
      { id: "p3", name: "Eve", colorIndex: 2, x: 300, floor: 2, fired: true, spectator: true },
    ],
    phase: "results",
    mySessionId: "p1",
    hostSessionId: "p1",
    myRole: "staff",
    myFloor: 1,
    roomsView: {},
    elevatorsView: {
      A: { floor: 0, state: "idle" },
      B: { floor: 0, state: "idle" },
    },
    shiftEndsAt: null,
    winner: "staff",
    traitorReveal: { sessionId: "p3", name: "Eve" },
    recapEvents: [
      { type: "prep", actorSessionId: "p1", targetSessionId: "", roomId: "1-0", timestamp: 1000, valid: true, wasTargetSaboteur: false, crimeOccurred: false },
      { type: "call", actorSessionId: "p2", targetSessionId: "", roomId: "", shaft: "A", timestamp: 2000, valid: true, wasTargetSaboteur: false, crimeOccurred: false },
      { type: "ride", actorSessionId: "p2", targetSessionId: "", roomId: "", shaft: "A", timestamp: 3000, valid: true, wasTargetSaboteur: false, crimeOccurred: false },
      { type: "sabotage", actorSessionId: "p3", targetSessionId: "", roomId: "2-1", timestamp: 4000, valid: true, wasTargetSaboteur: true, crimeOccurred: true },
      { type: "catch", actorSessionId: "p1", targetSessionId: "p3", roomId: "2-1", timestamp: 5000, valid: true, wasTargetSaboteur: true, crimeOccurred: true },
      { type: "accusation", actorSessionId: "p1", targetSessionId: "p3", roomId: "", timestamp: 6000, valid: true, wasTargetSaboteur: true, crimeOccurred: true },
    ],
    ...overrides,
  };
}

describe("Results Recap UI (R-6, V-5, V-9)", () => {
  let overlay: HTMLElement;
  let handlers: any;

  beforeEach(() => {
    overlay = document.createElement("div");
    document.body.appendChild(overlay);
    handlers = {
      onSubmitName: vi.fn(),
      onCreateRoom: vi.fn(),
      onJoinRoom: vi.fn(),
      onStartRound: vi.fn(),
      onCallElevator: vi.fn(),
      onRideElevator: vi.fn(),
      onAccuse: vi.fn(),
      onStartChannel: vi.fn(),
      onCancelChannel: vi.fn(),
      onSetCodeInput: vi.fn(),
    };
  });

  afterEach(() => {
    overlay.remove();
    vi.restoreAllMocks();
  });

  it("renders winner banner and traitor reveal", () => {
    const view = makeResultsView();
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const banner = overlay.querySelector("#results-banner");
    expect(banner).not.toBeNull();
    const title = banner?.querySelector(".results-title");
    expect(title?.textContent).toBe("STAFF WIN");
    const traitor = banner?.querySelector(".results-traitor");
    expect(traitor?.textContent).toContain("Eve");
  });

  it("renders chronological recap event timeline with event details", () => {
    const view = makeResultsView();
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const timeline = overlay.querySelector("#recap-timeline");
    expect(timeline).not.toBeNull();
    const events = timeline?.querySelectorAll(".recap-event");
    expect(events?.length).toBe(6);

    // Event 0: prep
    expect(events?.[0]?.textContent).toContain("PREP");
    expect(events?.[0]?.textContent).toContain("Alice");
    expect(events?.[0]?.textContent).toContain("1-0");

    // Event 1: elevator call
    expect(events?.[1]?.textContent).toContain("ELEVATOR CALL");
    expect(events?.[1]?.textContent).toContain("Bob");
    expect(events?.[1]?.textContent).toContain("Shaft A");

    // Event 2: elevator ride
    expect(events?.[2]?.textContent).toContain("ELEVATOR RIDE");
    expect(events?.[2]?.textContent).toContain("Bob");

    // Event 3: sabotage
    expect(events?.[3]?.textContent).toContain("SABOTAGE");
    expect(events?.[3]?.textContent).toContain("2-1");

    // Event 4: catch
    expect(events?.[4]?.textContent).toContain("CAUGHT IN ACT");
    expect(events?.[4]?.textContent).toContain("Alice caught Eve");

    // Event 5: accusation
    expect(events?.[5]?.textContent).toContain("ACCUSATION");
    expect(events?.[5]?.textContent).toContain("Alice accused Eve");
    expect(events?.[5]?.textContent).toContain("CORRECT");
  });

  it("renders wrong accusation outcome properly", () => {
    const view = makeResultsView({
      recapEvents: [
        { type: "accusation", actorSessionId: "p1", targetSessionId: "p2", roomId: "", timestamp: 1000, valid: false, wasTargetSaboteur: false, crimeOccurred: true },
      ],
    });
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const timeline = overlay.querySelector("#recap-timeline");
    const events = timeline?.querySelectorAll(".recap-event");
    expect(events?.length).toBe(1);
    expect(events?.[0]?.textContent).toContain("WRONG");
    expect(events?.[0]?.textContent).toContain("Alice accused Bob");
  });

  it("handles empty recap event list gracefully", () => {
    const view = makeResultsView({ recapEvents: [] });
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const timeline = overlay.querySelector("#recap-timeline");
    expect(timeline).not.toBeNull();
    const emptyLi = timeline?.querySelector(".recap-empty");
    expect(emptyLi).not.toBeNull();
    expect(emptyLi?.textContent).toContain("No events recorded");
  });
});
