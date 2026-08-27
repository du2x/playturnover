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

describe("Accusation UI (R-2, R-3, V-2)", () => {
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

  it("renders accusation button when staff is within range on same floor as active player", () => {
    const view = makePlayingView();
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const accuseSection = overlay.querySelector("#accusation-controls");
    expect(accuseSection).not.toBeNull();
    const accuseBtn = overlay.querySelector("#accuse-p2") as HTMLButtonElement;
    expect(accuseBtn).not.toBeNull();
    expect(accuseBtn.textContent).toContain("Accuse Bob");
  });

  it("does NOT render accusation button when local player is saboteur", () => {
    const view = makePlayingView({ myRole: "saboteur" });
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const accuseSection = overlay.querySelector("#accusation-controls");
    expect(accuseSection).toBeNull();
  });

  it("does NOT render accusation button when local player is fired/spectator", () => {
    const view = makePlayingView({
      players: [
        { id: "p1", name: "Alice", colorIndex: 0, x: 100, floor: 1, fired: true, spectator: true },
        { id: "p2", name: "Bob", colorIndex: 1, x: 120, floor: 1, fired: false, spectator: false },
      ],
    });
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const accuseSection = overlay.querySelector("#accusation-controls");
    expect(accuseSection).toBeNull();
  });

  it("does NOT render accusation button when target is on a different floor", () => {
    const view = makePlayingView({
      players: [
        { id: "p1", name: "Alice", colorIndex: 0, x: 100, floor: 1, fired: false, spectator: false },
        { id: "p2", name: "Bob", colorIndex: 1, x: 100, floor: 2, fired: false, spectator: false },
      ],
    });
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const accuseSection = overlay.querySelector("#accusation-controls");
    expect(accuseSection).toBeNull();
  });

  it("does NOT render accusation button when target is outside ACCUSATION_RANGE_TILES", () => {
    const view = makePlayingView({
      players: [
        { id: "p1", name: "Alice", colorIndex: 0, x: 100, floor: 1, fired: false, spectator: false },
        { id: "p2", name: "Bob", colorIndex: 1, x: 100 + ACCUSATION_RANGE_TILES * TILE_SIZE_PX + 10, floor: 1, fired: false, spectator: false },
      ],
    });
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const accuseSection = overlay.querySelector("#accusation-controls");
    expect(accuseSection).toBeNull();
  });

  it("does NOT render accusation button when target is already fired", () => {
    const view = makePlayingView({
      players: [
        { id: "p1", name: "Alice", colorIndex: 0, x: 100, floor: 1, fired: false, spectator: false },
        { id: "p2", name: "Bob", colorIndex: 1, x: 120, floor: 1, fired: true, spectator: true },
      ],
    });
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const accuseSection = overlay.querySelector("#accusation-controls");
    expect(accuseSection).toBeNull();
  });

  it("does NOT render accusation button when phase is not playing", () => {
    const view = makePlayingView({ phase: "waiting" });
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const accuseSection = overlay.querySelector("#accusation-controls");
    expect(accuseSection).toBeNull();
  });

  it("hold to confirm submits accusation, while early release cancels", () => {
    vi.useFakeTimers();
    const view = makePlayingView();
    const state: UIState = { screen: "inRoom", name: "Alice", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const button = overlay.querySelector("#accuse-p2") as HTMLButtonElement;
    expect(button).not.toBeNull();

    // 1. Mouse down starts hold, mouse up at 500ms (< 1000ms) cancels
    button.dispatchEvent(new MouseEvent("mousedown"));
    vi.advanceTimersByTime(500);
    button.dispatchEvent(new MouseEvent("mouseup"));
    vi.advanceTimersByTime(600);
    expect(handlers.onAccuse).not.toHaveBeenCalled();

    // 2. Mouse down held for full 1000ms triggers accusation
    button.dispatchEvent(new MouseEvent("mousedown"));
    vi.advanceTimersByTime(1000);
    expect(handlers.onAccuse).toHaveBeenCalledWith("p2");

    vi.useRealTimers();
  });
});
