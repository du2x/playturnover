import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderOverlay } from "../src/ui/screens.js";
import type { RoomStateView } from "../src/net/GameClient.js";
import type { UIState } from "../src/ui/reducer.js";
import { getAllRoomIds } from "@grandhotel/shared";

function makeSpectatorView(): RoomStateView {
  const roomsView: Record<string, "clean" | "prepped" | "trashed" | null> = {};
  for (const rid of getAllRoomIds()) {
    roomsView[rid] = "clean";
  }
  roomsView["1-0"] = "prepped";
  roomsView["2-3"] = "trashed";

  return {
    players: [
      {
        id: "p1",
        name: "Alice",
        colorIndex: 0,
        x: 100,
        floor: 1,
        fired: true,
        spectator: true,
      },
      {
        id: "p2",
        name: "Bob",
        colorIndex: 1,
        x: 200,
        floor: 1,
        fired: false,
        spectator: false,
      },
    ],
    phase: "playing",
    mySessionId: "p1",
    hostSessionId: "p1",
    myRole: "staff",
    myFloor: 1,
    roomsView,
    evidenceView: {
      "1-0": { card: { present: true, text: "PREPPED" }, freshness: null, trashedAtTime: 0 },
      "2-3": { card: { present: true, text: "TRASHED" }, freshness: "fresh", trashedAtTime: 123 },
    },
    elevatorsView: {
      A: { floor: 1, state: "idle" },
      B: { floor: 0, state: "idle" },
    },
    shiftEndsAt: Date.now() + 100000,
    winner: null,
    traitorReveal: null,
    recapEvents: [],
  };
}

describe("Spectator UI (R-5, V-4)", () => {
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

  it("renders spectator banner when local player is fired/spectator", () => {
    const view = makeSpectatorView();
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const spectatorBanner = overlay.querySelector("#spectator-banner");
    expect(spectatorBanner).not.toBeNull();
    expect(spectatorBanner?.textContent).toContain("SPECTATOR");
  });

  it("does NOT render elevator or channel controls for spectator", () => {
    const view = makeSpectatorView();
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    expect(overlay.querySelector("#elevator-controls")).toBeNull();
    expect(overlay.querySelector("#channel-controls")).toBeNull();
    expect(overlay.querySelector("#accusation-controls")).toBeNull();
  });

  it("renders (Fired) badge next to fired players in roster", () => {
    const view = makeSpectatorView();
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const roster = overlay.querySelector("#roster");
    expect(roster).not.toBeNull();
    const badges = roster?.querySelectorAll(".spectator-badge");
    expect(badges?.length).toBe(1);
    expect(badges?.[0]?.textContent).toContain("Fired");
  });

  it("renders all 24 rooms with observable states for full-building overview", () => {
    const view = makeSpectatorView();
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const roomList = overlay.querySelector("#room-states");
    expect(roomList).not.toBeNull();
    const roomItems = roomList?.querySelectorAll("li");
    expect(roomItems?.length).toBe(24);

    const preppedRoom = roomList?.querySelector('[data-room="1-0"]');
    expect(preppedRoom?.textContent).toContain("prepped");
    const trashedRoom = roomList?.querySelector('[data-room="2-3"]');
    expect(trashedRoom?.textContent).toContain("trashed");
  });
});
