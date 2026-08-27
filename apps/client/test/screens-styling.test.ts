import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderOverlay } from "../src/ui/screens.js";
import { truncateName } from "../src/ui/hudText.js";
import type { RoomStateView } from "../src/net/GameClient.js";
import type { UIState } from "../src/ui/reducer.js";
import { HUD_NAME_MAX_CHARS, MAX_PLAYERS } from "@grandhotel/shared";

const CSS_TEXT = readFileSync(
  resolve(process.cwd(), "src/style.css"),
  "utf8",
);

function makePlayer(
  index: number,
  overrides?: Partial<RoomStateView["players"][number]>,
): RoomStateView["players"][number] {
  return {
    id: `p${index}`,
    name: `Player${index}`,
    colorIndex: index,
    x: 100,
    floor: 1,
    fired: false,
    spectator: false,
    ...overrides,
  };
}

function makeView(
  players: RoomStateView["players"],
  overrides?: Partial<RoomStateView>,
): RoomStateView {
  return {
    players,
    phase: "playing",
    roomCode: "TQ7X",
    mySessionId: "p0",
    hostSessionId: "p0",
    myRole: "staff",
    myFloor: 1,
    roomsView: {},
    elevatorsView: {
      A: { floor: 1, state: "idle" },
      B: { floor: 2, state: "idle" },
    },
    shiftEndsAt: Date.now() + 100000,
    winner: null,
    traitorReveal: null,
    recapEvents: [],
    ...overrides,
  };
}

describe("menu styling (V-4)", () => {
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

  it("name screen renders a screen-card with the game title heading", () => {
    const state: UIState = { screen: "idle" };
    renderOverlay(overlay, state, handlers);

    const nameScreen = overlay.querySelector("#screen-name")!;
    expect(nameScreen).not.toBeNull();
    const cards = nameScreen.querySelectorAll(".screen-card");
    expect(cards.length).toBe(1);
    const title = nameScreen.querySelector(".screen-title")!;
    expect(title).not.toBeNull();
    expect(title.textContent).toBe("Turnover");
  });

  it("menu screen renders a screen-card with the game title heading", () => {
    const state: UIState = { screen: "named", name: "Alice", codeInput: "" };
    renderOverlay(overlay, state, handlers);

    const menuScreen = overlay.querySelector("#screen-menu") as HTMLElement;
    expect(menuScreen.hidden).toBe(false);
    const cards = menuScreen.querySelectorAll(".screen-card");
    expect(cards.length).toBe(1);
    const title = menuScreen.querySelector(".screen-title")!;
    expect(title.textContent).toBe("Turnover");
    // The join controls still live inside the card.
    expect(menuScreen.querySelector("#create-room-btn")).not.toBeNull();
    expect(menuScreen.querySelector("#code-input")).not.toBeNull();
    expect(menuScreen.querySelector("#join-btn")).not.toBeNull();
  });

  it("style.css defines :focus-visible outline rules for overlay controls", () => {
    // Read as file text — jsdom does not apply external stylesheets.
    expect(CSS_TEXT).toContain(":focus-visible");
    expect(CSS_TEXT).toMatch(/#overlay button:focus-visible[^{]*\{/);
    expect(CSS_TEXT).toMatch(/#overlay input:focus-visible[^{]*\{/);
  });
});

describe("hud caps (V-5)", () => {
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

  it("truncateName ellipsizes long names and leaves short names intact", () => {
    const long = "Bartholomew-Wilhelmina";
    const truncated = truncateName(long);
    expect(truncated).not.toBe(long);
    expect(truncated.endsWith("…")).toBe(true);
    expect(truncated.startsWith(long.slice(0, HUD_NAME_MAX_CHARS))).toBe(true);

    const short = "Alice";
    expect(truncateName(short)).toBe(short);

    // Shared constant is the default cap.
    expect(HUD_NAME_MAX_CHARS).toBeGreaterThan(0);
    expect(truncateName(long).slice(0, -1).length).toBeLessThan(long.length);
  });

  it("renders exactly MAX_PLAYERS roster chips (ellipsized), all rule-bearing chips present", () => {
    const players: RoomStateView["players"] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      players.push(
        makePlayer(i, {
          name:
            i % 2 === 0
              ? `ExtremelyLongDisplayNameNumber${i}`
              : `P${i}`,
          fired: i === MAX_PLAYERS - 1,
        }),
      );
    }
    const view = makeView(players);
    const state: UIState = { screen: "inRoom", name: "P0", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const rosterLis = overlay.querySelectorAll("#hud-roster .roster li");
    expect(rosterLis.length).toBe(MAX_PLAYERS);

    const nameSpans = overlay.querySelectorAll(
      "#hud-roster .roster li .roster-name",
    );
    expect(nameSpans.length).toBe(MAX_PLAYERS);
    let sawTruncated = false;
    nameSpans.forEach((span) => {
      const text = span.textContent ?? "";
      if (text.endsWith("…")) {
        sawTruncated = true;
        // Ellipsis only replaces display characters — name stays under cap+1.
        expect(text.length).toBeLessThanOrEqual(HUD_NAME_MAX_CHARS + 1);
      }
    });
    expect(sawTruncated).toBe(true);

    // Rule-bearing chips still render.
    const phaseChip = overlay.querySelector("#hud-phase")!;
    expect(phaseChip.textContent).toBeTruthy();
    const floorChip = overlay.querySelector("#hud-floor")!;
    expect(floorChip.textContent).toContain("Floor:");
    const codeChip = overlay.querySelector("#hud-code")!;
    expect(codeChip.textContent).toContain(view.roomCode!);
    const elevatorsChip = overlay.querySelector("#hud-elevators")!;
    expect(elevatorsChip.textContent).toContain("A:");
    expect(elevatorsChip.textContent).toContain("B:");

    // Fired badge survives truncation.
    const badge = overlay.querySelector(
      "#hud-roster .roster li.fired .spectator-badge",
    );
    expect(badge?.textContent).toBe("(Fired)");
  });

  it("results reveal line renders names through truncateName", () => {
    const players = [
      makePlayer(0, { name: "Shorty" }),
      makePlayer(1, { name: "SaboteurWithAVeryLongNameIndeed", fired: true }),
    ];
    const view = makeView(players, {
      phase: "results",
      winner: "saboteur",
      traitorReveal: {
        sessionId: "p1",
        name: "SaboteurWithAVeryLongNameIndeed",
      },
    });
    const state: UIState = { screen: "inRoom", name: "Shorty", code: "ABCD", view };

    renderOverlay(overlay, state, handlers);

    const traitorLine = overlay.querySelector(".results-traitor")!;
    expect(traitorLine.textContent).toContain(
      truncateName("SaboteurWithAVeryLongNameIndeed"),
    );
    expect(traitorLine.textContent!.length).toBeLessThan(
      "Saboteur".length + "SaboteurWithAVeryLongNameIndeed".length + 10,
    );
  });
});
