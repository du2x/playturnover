import { AVATAR_COLORS, MAX_NAME_LENGTH, ROOM_CODE_LENGTH, getAllRoomIds } from "@grandhotel/shared";
import { clearChildren, createButton, createEl, createInput, createSelect, createSwatch, qs } from "./dom.js";
import { filterCodeInput } from "./reducer.js";
import type { RoomStateView, UIState } from "./reducer.js";

export interface UIHandlers {
  onSubmitName: (name: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onStartRound: () => void;
  onCallElevator: (shaft: "A" | "B") => void;
  onRideElevator: (shaft: "A" | "B", destFloor: number) => void;
  onStartChannel: (type: "prep" | "unprep" | "fake", roomId: string) => void;
  onCancelChannel: () => void;
  onSetCodeInput: (code: string) => void;
  onDismissError?: () => void;
}

function ensureContainers(overlay: HTMLElement): {
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
    nameScreen = createEl("div", { id: "screen-name", className: "screen" });
    menuScreen = createEl("div", { id: "screen-menu", className: "screen" });
    roomScreen = createEl("div", { id: "screen-room", className: "screen" });
    toastEl = createEl("div", { id: "toast" });
    const errorEl = createEl("div", { id: "error" });
    overlay.append(nameScreen, menuScreen, roomScreen, toastEl, errorEl);
  } else if (!toastEl) {
    toastEl = createEl("div", { id: "toast" });
    overlay.append(toastEl);
  }
  return { nameScreen: nameScreen!, menuScreen: menuScreen!, roomScreen: roomScreen!, toastEl: toastEl! };
}

function renderNameScreen(container: HTMLElement, state: UIState, handlers: UIHandlers): void {
  clearChildren(container);
  const title = createEl("h2", { text: "Enter your name" });
  const input = createInput("Display name", { id: "name-input", value: "" }) as HTMLInputElement;
  input.maxLength = MAX_NAME_LENGTH;
  const submit = createButton("Continue", () => {
    handlers.onSubmitName(input.value);
  }, { id: "name-submit" });

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter") handlers.onSubmitName(input.value);
  };
  input.addEventListener("keydown", onKey);

  container.append(title, input, submit);
  if (state.error) {
    const err = createEl("div", { id: "name-error", className: "error", text: state.error });
    err.style.color = "#b00020";
    container.append(err);
  }
}

function renderMenuScreen(container: HTMLElement, state: UIState, handlers: UIHandlers): void {
  if (state.screen !== "named") return;
  clearChildren(container);
  const title = createEl("h2", { text: `Welcome, ${state.name}` });
  const createBtn = createButton("Create room", () => handlers.onCreateRoom(), { id: "create-room-btn" });

  const joinHeader = createEl("h3", { text: "Join by code" });
  const codeInput = createInput("CODE", { id: "code-input", value: state.codeInput }) as HTMLInputElement;
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

  const joinBtn = createButton("Join", () => handlers.onJoinRoom(codeInput.value), {
    id: "join-btn",
    disabled: codeInput.value.length !== ROOM_CODE_LENGTH,
  });

  // enable/disable reacts to input — re-evaluate on input
  codeInput.addEventListener("input", () => {
    joinBtn.disabled = codeInput.value.length !== ROOM_CODE_LENGTH;
  });

  container.append(title, createBtn, joinHeader, codeInput, joinBtn);

  if (state.error) {
    const err = createEl("div", { id: "menu-error", className: "error", text: state.error });
    err.style.color = "#b00020";
    container.append(err);
  }
}

function renderFloorIndicator(view: RoomStateView | null): HTMLElement {
  const floor = view?.myFloor ?? 0;
  const label = floor === 0 ? "LOBBY" : `${floor}F`;
  return createEl("div", { id: "floor-indicator", className: "floor-indicator", text: `Floor: ${label}` });
}

function renderRoomStateList(roomsView: Record<string, string | null>): HTMLElement {
  const list = createEl("ul", { id: "room-states", className: "room-states" });
  for (const roomId of getAllRoomIds()) {
    const state = roomsView[roomId];
    const li = createEl("li");
    const stateText = state === null ? "—" : state;
    li.textContent = `${roomId}: ${stateText}`;
    li.dataset.room = roomId;
    list.append(li);
  }
  return list;
}

function renderElevatorControls(handlers: UIHandlers): HTMLElement {
  const container = createEl("div", { id: "elevator-controls", className: "elevator-controls" });
  for (const shaft of ["A", "B"] as const) {
    const row = createEl("div", { className: "elevator-row" });
    const callBtn = createButton(`Call ${shaft}`, () => handlers.onCallElevator(shaft), {
      id: `call-elevator-${shaft}`,
      className: "elevator-call-btn",
    });
    const floorOptions = [
      { value: "0", label: "Lobby (0)" },
      { value: "1", label: "1F" },
      { value: "2", label: "2F" },
      { value: "3", label: "3F" },
    ];
    const select = createSelect(floorOptions, { id: `ride-floor-${shaft}`, value: "1" });
    const rideBtn = createButton(`Ride ${shaft}`, () => {
      handlers.onRideElevator(shaft, Number.parseInt(select.value, 10));
    }, { id: `ride-elevator-${shaft}`, className: "elevator-ride-btn" });
    row.append(createEl("span", { text: `Shaft ${shaft}: ` }), callBtn, select, rideBtn);
    container.append(row);
  }
  return container;
}

function renderChannelControls(state: UIState, handlers: UIHandlers): HTMLElement {
  if (state.screen !== "inRoom") return createEl("div");
  const view = state.view;
  const container = createEl("div", { id: "channel-controls", className: "channel-controls" });
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
    text: isSaboteur && roomState === "prepped" ? "Hold to sabotage (E)" : "Hold to prep (E)",
  });
  prepBtn.addEventListener("mousedown", () => handlers.onStartChannel(isSaboteur ? "unprep" : "prep", roomId));
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
    fakeBtn.addEventListener("mousedown", () => handlers.onStartChannel("fake", roomId));
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

function findInsideRoom(roomsView: Record<string, string | null>): string | null {
  for (const [roomId, state] of Object.entries(roomsView)) {
    if (state !== null) return roomId;
  }
  return null;
}

function renderResultsBanner(view: RoomStateView | null): HTMLElement | null {
  if (!view || view.phase !== "results") return null;
  const banner = createEl("div", { id: "results-banner", className: "results-banner" });
  const winner = view.winner;
  const title = createEl("h1", {
    className: "results-title",
    text: winner === "staff" ? "STAFF WIN" : winner === "saboteur" ? "SABOTEUR WIN" : "ROUND OVER",
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

  banner.append(title, traitorLine);
  return banner;
}

function renderRoomScreen(container: HTMLElement, state: UIState, handlers: UIHandlers): void {
  if (state.screen !== "inRoom") return;
  clearChildren(container);
  const header = createEl("h2", { text: `Room ${state.code}` });
  const phaseLabel = createEl("div", { id: "phase-label", className: "phase", text: `Phase: ${state.view?.phase ?? "waiting"}` });

  // roster list
  const roster = createEl("ul", { id: "roster", className: "roster" });
  const players = state.view?.players ?? [];
  for (const p of players) {
    const li = createEl("li");
    const swatch = createSwatch(AVATAR_COLORS[p.colorIndex % AVATAR_COLORS.length] ?? "#888");
    const nameSpan = createEl("span", { text: p.name });
    nameSpan.style.marginLeft = "6px";
    li.append(swatch, nameSpan);
    roster.append(li);
  }

  container.append(header, phaseLabel, roster, renderFloorIndicator(state.view));

  // code display also
  const codeDisplay = createEl("div", { id: "room-code", text: `Code: ${state.code}` });
  codeDisplay.style.fontFamily = "monospace";
  container.append(codeDisplay);

  // Host-only controls
  const isHost = !!state.view && state.view.mySessionId === state.view.hostSessionId;
  if (isHost) {
    const phase = state.view?.phase ?? "waiting";
    if (phase === "waiting") {
      const playerCount = state.view?.players.length ?? 0;
      const canStart = playerCount >= 4;
      const hostBtn = createButton("Start round", () => handlers.onStartRound(), {
        id: "host-start-btn",
        disabled: !canStart,
      });
      if (!canStart) hostBtn.title = "Need at least 4 players";
      container.append(hostBtn);
      const countHint = createEl("div", {
        id: "player-count-hint",
        text: `${playerCount} player${playerCount === 1 ? "" : "s"} (need 4 to start)`,
      });
      countHint.style.fontSize = "12px";
      container.append(countHint);
    } else if (phase === "playing") {
      // no host mid-round controls in M1
    }
  }

  // Results overlay v1: winner banner + traitor reveal only; no recap timeline
  const banner = renderResultsBanner(state.view);
  if (banner) {
    const overlay = createEl("div", { id: "results-overlay", className: "results-overlay" });
    overlay.append(banner);
    container.append(overlay);
  }

  container.append(renderElevatorControls(handlers));

  const roomStates = renderRoomStateList(state.view?.roomsView ?? {});
  container.append(roomStates);

  container.append(renderChannelControls(state, handlers));

  if (state.error) {
    const err = createEl("div", { id: "room-error", className: "error", text: state.error });
    err.style.color = "#b00020";
    container.append(err);
  }
  if (state.view) {
    const hostInfo = createEl("div", { id: "host-info", text: `You: ${state.view.mySessionId.slice(0, 6)} Host: ${state.view.hostSessionId.slice(0, 6)}` });
    hostInfo.style.fontSize = "10px";
    hostInfo.style.opacity = "0.6";
    container.append(hostInfo);
  }
}

export function renderOverlay(overlay: HTMLElement, state: UIState, handlers: UIHandlers): void {
  const { nameScreen, menuScreen, roomScreen, toastEl } = ensureContainers(overlay);

  // control visibility
  nameScreen.hidden = state.screen !== "idle";
  menuScreen.hidden = state.screen !== "named";
  roomScreen.hidden = state.screen !== "inRoom";

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

/**
 * Convenience: mount UI with reducer dispatch wiring.
 * Keeps DOM functions thin — pure render + event handlers delegating to caller.
 */
export function mountUI(
  overlay: HTMLElement,
  getState: () => UIState,
  dispatch: (action: import("./reducer.js").UIAction) => void,
  client: import("../net/GameClient.js").GameClient,
): { destroy: () => void; rerender: () => void } {
  const handlers: UIHandlers = {
    onSubmitName: (name: string) => {
      dispatch({ type: "submitName", name });
      const s = getState();
      // if now named, no further action; wiring to client happens externally via createRoom/join
    },
    onCreateRoom: async () => {
      const s = getState();
      if (s.screen !== "named") return;
      try {
        const code = await client.createRoom();
        dispatch({ type: "joined", code });
      } catch {
        // error already surfaced via onEvent
      }
    },
    onJoinRoom: async (code: string) => {
      try {
        await client.joinByCode(code);
        dispatch({ type: "joined", code: filterCodeInput(code) });
      } catch {
        // surfaced via onEvent
      }
    },
    onStartRound: () => {
      client.startRound();
    },
    onCallElevator: (shaft: "A" | "B") => {
      client.callElevator(shaft);
    },
    onRideElevator: (shaft: "A" | "B", destFloor: number) => {
      client.rideElevator(shaft, destFloor);
    },
    onStartChannel: (type: "prep" | "unprep" | "fake", roomId: string) => {
      client.startChannel(type, roomId);
    },
    onCancelChannel: () => {
      client.cancelChannel();
    },
    onSetCodeInput: (code: string) => {
      dispatch({ type: "setCodeInput", code });
    },
  };

  const rerender = (): void => {
    renderOverlay(overlay, getState(), handlers);
  };

  // subscribe to client events
  const unsubState = client.onState((view) => {
    dispatch({ type: "stateUpdate", view });
    rerender();
  });
  const unsubEvent = client.onEvent((ev) => {
    dispatch({ type: "clientEvent", event: ev });
    rerender();
  });

  // initial render
  rerender();

  return {
    rerender,
    destroy: () => {
      unsubState();
      unsubEvent();
    },
  };
}
