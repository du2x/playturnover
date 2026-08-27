import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderOverlay } from "../src/ui/screens.js";
import type { RoomStateView } from "../src/net/GameClient.js";
import type { UIState } from "../src/ui/reducer.js";
import { ACCUSATION_RANGE_TILES, TILE_SIZE_PX } from "@grandhotel/shared";

function makePlayingView(overrides?: Partial<RoomStateView>): RoomStateView {
  return {
    players: [
      {
        id: "p1",
        name: "Alice",
        colorIndex: 0,
        x: 100,
        floor: 1,
        fired: false,
        spectator: false,
      },
      {
        id: "p2",
        name: "Bob",
        colorIndex: 1,
        x: 100 + ACCUSATION_RANGE_TILES * TILE_SIZE_PX - 1, // within range
        floor: 1,
        fired: false,
        spectator: false,
      },
    ],
    phase: "playing",
    roomCode: null,
    mySessionId: "p1",
    hostSessionId: "p1",
    myRole: "staff",
    myFloor: 1,
    roomsView: {},
    elevatorsView: {
      A: { floor: 0, state: "idle" },
      B: { floor: 0, state: "idle" },
    },
    shiftEndsAt: Date.now() + 100000,
    winner: null,
    traitorReveal: null,
    recapEvents: [],
    ...overrides,
  };
}

/**
 * Accusation UI contract post-HUD-overhaul: accusations are hold-E only
 * (window-level listeners in main.ts + channel-bar progress indicator).
 * The overlay must NEVER render HTML accusation controls, regardless of
 * role / proximity / phase — all of these used to be DOM buttons.
 */
describe("Accusation UI (R-2, R-3, V-2) — hold-E only", () => {
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
      onStartChannel: vi.fn(),
      onCancelChannel: vi.fn(),
      onSetCodeInput: vi.fn(),
    };
  });

  afterEach(() => {
    overlay.remove();
    vi.restoreAllMocks();
  });

  it("does NOT render HTML accusation controls for staff near eligible targets", () => {
    const view = makePlayingView();
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    expect(overlay.querySelector("#accusation-controls")).toBeNull();
    expect(overlay.querySelector("#accuse-p2")).toBeNull();
  });

  it("does NOT render accusation controls when local player is saboteur", () => {
    const view = makePlayingView({ myRole: "saboteur" });
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    expect(overlay.querySelector("#accusation-controls")).toBeNull();
  });

  it("does NOT render accusation controls when local player is fired/spectator", () => {
    const view = makePlayingView({
      players: [
        { id: "p1", name: "Alice", colorIndex: 0, x: 100, floor: 1, fired: true, spectator: true },
        { id: "p2", name: "Bob", colorIndex: 1, x: 120, floor: 1, fired: false, spectator: false },
      ],
    });
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    expect(overlay.querySelector("#accusation-controls")).toBeNull();
  });

  it("does NOT render accusation controls when target is outside range, wrong floor, or fired", () => {
    const cases: Partial<RoomStateView>[] = [
      {
        players: [
          { id: "p1", name: "Alice", colorIndex: 0, x: 100, floor: 1, fired: false, spectator: false },
          { id: "p2", name: "Bob", colorIndex: 1, x: 100, floor: 2, fired: false, spectator: false },
        ],
      },
      {
        players: [
          { id: "p1", name: "Alice", colorIndex: 0, x: 100, floor: 1, fired: false, spectator: false },
          {
            id: "p2",
            name: "Bob",
            colorIndex: 1,
            x: 100 + ACCUSATION_RANGE_TILES * TILE_SIZE_PX + 10,
            floor: 1,
            fired: false,
            spectator: false,
          },
        ],
      },
      {
        players: [
          { id: "p1", name: "Alice", colorIndex: 0, x: 100, floor: 1, fired: false, spectator: false },
          { id: "p2", name: "Bob", colorIndex: 1, x: 120, floor: 1, fired: true, spectator: true },
        ],
      },
    ];
    for (const overrides of cases) {
      const view = makePlayingView(overrides);
      const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };
      renderOverlay(overlay, state, handlers);
      expect(overlay.querySelector("#accusation-controls")).toBeNull();
      expect(overlay.querySelector("#elevator-controls")).toBeNull();
    }
  });
});
