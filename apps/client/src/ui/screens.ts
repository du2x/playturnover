import {
  AVATAR_COLORS,
  MAX_NAME_LENGTH,
  MIN_PLAYERS,
  ROOM_CODE_LENGTH,
} from "@grandhotel/shared";
import {
  clearChildren,
  createButton,
  createEl,
  createInput,
  createSwatch,
  qs,
} from "./dom.js";
import { filterCodeInput } from "./reducer.js";
import type { RoomStateView, UIState } from "./reducer.js";

/**
 * Handlers the HTML overlay needs after moving elevator triggering,
 * accusations, room states and evidence into the Phaser world / window-level
 * keyboard paths. Elevator calls happen via in-world buttons; accusation and
 * work channels run on hold-E captured by main.ts listeners.
 */
export interface UIHandlers {
  onSubmitName: (name: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onStartRound: () => void;
  onStartChannel: (type: "prep" | "unprep" | "fake", roomId: string) => void;
  onCancelChannel: () => void;
  onSetCodeInput: (code: string) => void;
}

function buildHudBarSkeleton(): HTMLElement {
  const bar = createEl("div", { id: "hud-bar" });
  bar.hidden = true;
  const phase = createEl("div", { id: "hud-phase", className: "hud-chip" });
  const floor = createEl("div", { id: "hud-floor", className: "hud-chip" });
  const code = createEl("div", { id: "hud-code", className: "hud-chip" });
  const elevators = createEl("div", {
    id: "hud-elevators",
    className: "hud-chip",
  });
  const roster = createEl("div", { id: "hud-roster" });
  bar.append(phase, floor, code, elevators, roster);
  return bar;
}

/** Non-destructive: creates the hud bar skeleton once if index.html lacked it. */
function ensureHudBar(overlay: HTMLElement): HTMLElement {
  let hudBar = qs<HTMLElement>(overlay, "#hud-bar");
  if (!hudBar) {
    hudBar = buildHudBarSkeleton();
    overlay.insertBefore(hudBar, overlay.firstChild);
  }
  return hudBar;
}

function ensureContainers(overlay: HTMLElement): {
  hudBar: HTMLElement;
  nameScreen: HTMLElement;
  menuScreen: HTMLElement;
  roomScreen: HTMLElement;
  toastEl: HTMLElement;
} {
  let nameScreen = qs<HTMLElement>(overlay, "#screen-name");
  let menuScreen = qs<HTMLElement>(overlay, "#screen-menu");
  let roomScreen = qs<HTMLElement>(overlay, "#screen-room");
  let toastEl = qs<HTMLElement>(overlay, "#toast");
  // fallback: create if missing
  if (!nameScreen || !menuScreen || !roomScreen) {
    clearChildren(overlay);
    const hudBar = buildHudBarSkeleton();
    nameScreen = createEl("div", { id: "screen-name", className: "screen" });
    menuScreen = createEl("div", { id: "screen-menu", className: "screen" });
    roomScreen = createEl("div", { id: "screen-room", className: "screen" });
    toastEl = createEl("div", { id: "toast" });
    const errorEl = createEl("div", { id: "error" });
    overlay.append(
      hudBar,
      nameScreen,
      menuScreen,
      roomScreen,
      toastEl,
      errorEl,
    );
  } else if (!toastEl) {
    toastEl = createEl("div", { id: "toast" });
    overlay.append(toastEl);
  }
  return {
    hudBar: ensureHudBar(overlay),
    nameScreen: nameScreen!,
    menuScreen: menuScreen!,
    roomScreen: roomScreen!,
    toastEl: toastEl!,
  };
}

function renderNameScreen(
  container: HTMLElement,
  state: UIState,
  handlers: UIHandlers,
): void {
  clearChildren(container);
  const title = createEl("h2", { text: "Enter your name" });
  const input = createInput("Display name", {
    id: "name-input",
    value: "",
  }) as HTMLInputElement;
  input.maxLength = MAX_NAME_LENGTH;
  const submit = createButton(
    "Continue",
    () => {
      handlers.onSubmitName(input.value);
    },
    { id: "name-submit" },
  );

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter") handlers.onSubmitName(input.value);
  };
  input.addEventListener("keydown", onKey);

  container.append(title, input, submit);
  if (state.error) {
    const err = createEl("div", {
      id: "name-error",
      className: "error",
      text: state.error,
    });
    err.style.color = "#b00020";
    container.append(err);
  }
}

function renderMenuScreen(
  container: HTMLElement,
  state: UIState,
  handlers: UIHandlers,
): void {
  if (state.screen !== "named") return;
  clearChildren(container);
  const title = createEl("h2", { text: `Welcome, ${state.name}` });
  const createBtn = createButton("Create room", () => handlers.onCreateRoom(), {
    id: "create-room-btn",
  });

  const joinHeader = createEl("h3", { text: "Join by code" });
  const codeInput = createInput("CODE", {
    id: "code-input",
    value: state.codeInput,
  }) as HTMLInputElement;
  // uppercase filtered to shared alphabet
  codeInput.maxLength = ROOM_CODE_LENGTH;
  codeInput.style.textTransform = "uppercase";
  codeInput.addEventListener("input", () => {
    const filtered = filterCodeInput(codeInput.value);
    if (filtered !== codeInput.value) codeInput.value = filtered;
    handlers.onSetCodeInput(filtered);
  });

  // initialize filtered display
  codeInput.value = filterCodeInput(state.codeInput);

  const joinBtn = createButton(
    "Join",
    () => handlers.onJoinRoom(codeInput.value),
    {
      id: "join-btn",
      disabled: codeInput.value.length !== ROOM_CODE_LENGTH,
    },
  );

  // enable/disable reacts to input — re-evaluate on input
  codeInput.addEventListener("input", () => {
    joinBtn.disabled = codeInput.value.length !== ROOM_CODE_LENGTH;
  });

  container.append(title, createBtn, joinHeader, codeInput, joinBtn);

  if (state.error) {
    const err = createEl("div", {
      id: "menu-error",
      className: "error",
      text: state.error,
    });
    err.style.color = "#b00020";
    container.append(err);
  }
}

// ── Top HUD bar (roster / phase / floor / code / elevators) ─────────────────

const PHASE_LABELS: Record<string, string> = {
  waiting: "WAITING",
  playing: "SHIFT",
  results: "RESULTS",
};

export function renderHudBar(
  hudBar: HTMLElement,
  state: UIState,
): void {
  if (state.screen !== "inRoom") return;
  const view = state.view;

  const phaseChip = qs<HTMLElement>(hudBar, "#hud-phase");
  const floorChip = qs<HTMLElement>(hudBar, "#hud-floor");
  const codeChip = qs<HTMLElement>(hudBar, "#hud-code");
  const elevatorsChip = qs<HTMLElement>(hudBar, "#hud-elevators");
  const rosterHost = qs<HTMLElement>(hudBar, "#hud-roster");
  if (!phaseChip || !floorChip || !codeChip || !elevatorsChip || !rosterHost) {
    return;
  }

  clearChildren(rosterHost);

  // Roster chips (swatch + name + fired badge)
  const roster = createEl("ul", { className: "roster" });
  for (const p of view?.players ?? []) {
    const li = createEl("li");
    if (p.fired || p.spectator) li.classList.add("fired");
    li.append(
      createSwatch(AVATAR_COLORS[p.colorIndex % AVATAR_COLORS.length] ?? "#888"),
      createEl("span", { text: p.name }),
    );
    if (p.fired || p.spectator) {
      const badge = createEl("span", {
        className: "spectator-badge",
        text: "(Fired)",
      });
      badge.style.fontSize = "11px";
      badge.style.opacity = "0.7";
      li.append(badge);
    }
    roster.append(li);
  }
  rosterHost.append(roster);

  phaseChip.textContent =
    PHASE_LABELS[view?.phase ?? "waiting"] ?? "…";
  const floor = view?.myFloor ?? 0;
  floorChip.textContent = `Floor: ${floor === 0 ? "LOBBY" : `${floor}F`}`;
  codeChip.textContent = `Code: ${view?.roomCode ?? state.code}`;
  codeChip.classList.add("code-mono");
  elevatorsChip.textContent = elevatorsText(view);
}

function elevatorsText(view: RoomStateView | null): string {
  if (!view?.elevatorsView) return "";
  const parts: string[] = [];
  for (const shaft of ["A", "B"] as const) {
    const car = view.elevatorsView[shaft];
    parts.push(car ? `${shaft}:F${car.floor} ${car.state}` : `${shaft}:?`);
  }
  return parts.join(" · ");
}

function renderChannelControls(
  state: UIState,
  handlers: UIHandlers,
): HTMLElement {
  if (state.screen !== "inRoom") return createEl("div");
  const view = state.view;
  const container = createEl("div", {
    id: "channel-controls",
    className: "channel-controls",
  });
  const ME = view?.mySessionId ?? "";
  const me = view?.players.find((p) => p.id === ME);
  const roomId = view?.roomsView ? findInsideRoom(view.roomsView) : null;

  if (!roomId || !me) {
    container.textContent = "Stand in a room to prep or sabotage.";
    return container;
  }

  const isSaboteur = view?.myRole === "saboteur";
  const roomState = view?.roomsView[roomId];

  const row = createEl("div", { className: "channel-row" });
  // Staff/saboteur real prep
  const prepBtn = createEl("button", {
    id: "channel-prep-btn",
    className: "channel-btn",
    text:
      isSaboteur && roomState === "prepped"
        ? "Hold to sabotage (E)"
        : "Hold to prep (E)",
  });
  // Keep keyboard focus on the canvas — movement/hold-E stay responsive.
  prepBtn.addEventListener("mousedown", (e) => e.preventDefault());
  prepBtn.addEventListener("mousedown", () =>
    handlers.onStartChannel(isSaboteur ? "unprep" : "prep", roomId),
  );
  prepBtn.addEventListener("mouseup", () => handlers.onCancelChannel());
  prepBtn.addEventListener("mouseleave", () => handlers.onCancelChannel());
  prepBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    handlers.onStartChannel(isSaboteur ? "unprep" : "prep", roomId);
  });
  prepBtn.addEventListener("touchend", () => handlers.onCancelChannel());
  row.append(prepBtn);

  // Saboteur fake prep
  if (isSaboteur) {
    const fakeBtn = createEl("button", {
      id: "channel-fake-btn",
      className: "channel-btn channel-fake",
      text: "Hold fake prep (Shift+E)",
    });
    fakeBtn.addEventListener("mousedown", (e) => e.preventDefault());
    fakeBtn.addEventListener("mousedown", () =>
      handlers.onStartChannel("fake", roomId),
    );
    fakeBtn.addEventListener("mouseup", () => handlers.onCancelChannel());
    fakeBtn.addEventListener("mouseleave", () => handlers.onCancelChannel());
    fakeBtn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      handlers.onStartChannel("fake", roomId);
    });
    fakeBtn.addEventListener("touchend", () => handlers.onCancelChannel());
    row.append(fakeBtn);
  }

  container.append(row);
  return container;
}

function findInsideRoom(
  roomsView: Record<string, string | null>,
): string | null {
  for (const [roomId, state] of Object.entries(roomsView)) {
    if (state !== null) return roomId;
  }
  return null;
}

function renderResultsBanner(view: RoomStateView | null): HTMLElement | null {
  if (!view || view.phase !== "results") return null;
  const banner = createEl("div", {
    id: "results-banner",
    className: "results-banner",
  });
  const winner = view.winner;
  const title = createEl("h1", {
    className: "results-title",
    text:
      winner === "staff"
        ? "STAFF WIN"
        : winner === "saboteur"
          ? "SABOTEUR WIN"
          : "ROUND OVER",
  });
  if (winner === "staff") title.classList.add("staff-win");
  if (winner === "saboteur") title.classList.add("saboteur-win");

  const reveal = view.traitorReveal;
  const traitorLine = createEl("div", {
    className: "results-traitor",
    text: reveal
      ? `Saboteur: ${reveal.name} (${reveal.sessionId.slice(0, 6)})`
      : "Saboteur reveal unavailable",
  });

  const timelineHeading = createEl("h3", {
    className: "recap-heading",
    text: "Round Timeline",
  });

  const timeline = createEl("ol", {
    id: "recap-timeline",
    className: "recap-timeline",
  });

  const playerNames = new Map<string, string>();
  for (const p of view.players) {
    playerNames.set(p.id, p.name);
  }
  if (reveal) {
    playerNames.set(reveal.sessionId, reveal.name);
  }

  const getPlayerName = (id: string): string => {
    if (!id) return "";
    return playerNames.get(id) ?? id.slice(0, 6);
  };

  for (const event of view.recapEvents) {
    const li = createEl("li", {
      className: `recap-event recap-${event.type}`,
    });
    li.dataset.type = event.type;

    let eventText = "";
    const timeStr =
      event.timestamp > 0
        ? new Date(event.timestamp).toLocaleTimeString()
        : "";
    const actor = getPlayerName(event.actorSessionId);
    const target = getPlayerName(event.targetSessionId);

    switch (event.type) {
      case "prep":
        eventText = `PREP · ${actor} completed room ${event.roomId}`;
        break;
      case "unprep":
      case "sabotage":
        eventText = `SABOTAGE · ${actor || "Saboteur"} sabotaged room ${event.roomId}`;
        break;
      case "call":
        eventText = `ELEVATOR CALL · ${actor} called Shaft ${event.shaft || "A"}`;
        break;
      case "ride":
        eventText = `ELEVATOR RIDE · ${actor} rode Shaft ${event.shaft || "A"}`;
        break;
      case "catch":
      case "walk-in":
        eventText = `CAUGHT IN ACT · ${actor} caught ${target || "Saboteur"} in room ${event.roomId}`;
        break;
      case "accusation": {
        const verdict = event.valid ? "CORRECT" : "WRONG";
        eventText = `ACCUSATION · ${actor} accused ${target} (${verdict})`;
        break;
      }
      default: {
        const detail = event.roomId || target || actor || "round";
        eventText = `${event.type.toUpperCase()} · ${detail}`;
        break;
      }
    }

    li.textContent = timeStr ? `${timeStr} · ${eventText}` : eventText;
    timeline.append(li);
  }

  if (view.recapEvents.length === 0) {
    const emptyLi = createEl("li", {
      className: "recap-empty",
      text: "No events recorded",
    });
    timeline.append(emptyLi);
  }

  banner.append(title, traitorLine, timelineHeading, timeline);
  return banner;
}

// Accusation UI lives in main.ts (hold-E on window level) and the channel-bar
// progress indicator; nearby-player HTML buttons were removed to stop viewport
// obstruction and focus stealing.

function renderRoomScreen(
  container: HTMLElement,
  state: UIState,
  handlers: UIHandlers,
): void {
  if (state.screen !== "inRoom") return;
  clearChildren(container);

  const view = state.view;
  const me = view?.players.find((player) => player.id === view.mySessionId);
  const isSpectator = me?.spectator === true || me?.fired === true;
  const phase = view?.phase ?? "waiting";
  const isHost = !!view && view.mySessionId === view.hostSessionId;

  if (isSpectator) {
    container.append(
      createEl("div", {
        id: "spectator-banner",
        className: "spectator-banner",
        text: "SPECTATOR · Full building view",
      }),
    );
  }

  // Host-only pre-round cluster; roster/phase/floor/code/elevators live in the
  // HUD bar above (#hud-bar), not here.
  if (!isSpectator && isHost && phase === "waiting") {
    const playerCount = view?.players.length ?? 0;
    const canStart = playerCount >= MIN_PLAYERS;
    const panel = createEl("div", { id: "lobby-panel" });
    const hostBtn = createButton(
      "Start round",
      () => handlers.onStartRound(),
      { id: "host-start-btn", disabled: !canStart },
    );
    if (!canStart) hostBtn.title = `Need at least ${MIN_PLAYERS} players`;
    const countHint = createEl("div", {
      id: "player-count-hint",
      className: "hint",
      text: `${playerCount} player${playerCount === 1 ? "" : "s"} (need ${MIN_PLAYERS} to start)`,
    });
    panel.append(hostBtn, countHint);
    container.append(panel);
  }

  // Results overlay: winner banner + traitor reveal + chronological timeline
  const banner = renderResultsBanner(view);
  if (banner) {
    const overlay = createEl("div", {
      id: "results-overlay",
      className: "results-overlay",
    });
    overlay.append(banner);
    container.append(overlay);
  }

  // In-room work channels as a mouse fallback for hold-E (bottom-left dock).
  if (!isSpectator && phase === "playing") {
    container.append(renderChannelControls(state, handlers));
  }

  if (state.error) {
    const err = createEl("div", {
      id: "room-error",
      className: "error",
      text: state.error,
    });
    err.style.color = "#b00020";
    container.append(err);
  }
}

export function renderOverlay(
  overlay: HTMLElement,
  state: UIState,
  handlers: UIHandlers,
): void {
  const { hudBar, nameScreen, menuScreen, roomScreen, toastEl } =
    ensureContainers(overlay);

  // control visibility
  nameScreen.hidden = state.screen !== "idle";
  menuScreen.hidden = state.screen !== "named";
  roomScreen.hidden = state.screen !== "inRoom";
  const inRoom = state.screen === "inRoom";
  hudBar.hidden = !inRoom;
  if (inRoom) renderHudBar(hudBar, state);

  // clear toast/error areas
  clearChildren(toastEl);
  const errorEl = qs<HTMLElement>(overlay, "#error");
  if (errorEl) clearChildren(errorEl);

  // populate each screen (even hidden ones for accessibility, but only visible one matters)
  renderNameScreen(nameScreen, state, handlers);
  if (state.screen === "named") {
    renderMenuScreen(menuScreen, state, handlers);
  } else if (state.screen === "inRoom") {
    renderRoomScreen(roomScreen, state, handlers);
  } else {
    // ensure other containers are empty when not active
    clearChildren(menuScreen);
    clearChildren(roomScreen);
  }

  // global toast/error mirroring state.error
  if (state.error) {
    const globalErr = qs<HTMLElement>(overlay, "#error");
    if (globalErr) globalErr.textContent = state.error;
    toastEl.textContent = state.error;
    toastEl.style.color = "#b00020";
  } else {
    const globalErr = qs<HTMLElement>(overlay, "#error");
    if (globalErr) globalErr.textContent = "";
    toastEl.textContent = "";
  }
}

