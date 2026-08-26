import { AVATAR_COLORS } from "@grandhotel/shared";
import { clearChildren, createButton, createEl, createInput, createSwatch, qs } from "./dom.js";
import { filterCodeInput } from "./reducer.js";
import type { UIState } from "./reducer.js";

export interface UIHandlers {
  onSubmitName: (name: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onAdvancePhase: () => void;
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
  input.maxLength = 24;
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
  codeInput.maxLength = 4;
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
    disabled: codeInput.value.length !== 4,
  });

  // enable/disable reacts to input — re-evaluate on input
  codeInput.addEventListener("input", () => {
    joinBtn.disabled = codeInput.value.length !== 4;
  });

  container.append(title, createBtn, joinHeader, codeInput, joinBtn);

  if (state.error) {
    const err = createEl("div", { id: "menu-error", className: "error", text: state.error });
    err.style.color = "#b00020";
    container.append(err);
  }
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

  container.append(header, phaseLabel, roster);

  // code display also
  const codeDisplay = createEl("div", { id: "room-code", text: `Code: ${state.code}` });
  codeDisplay.style.fontFamily = "monospace";
  container.append(codeDisplay);

  // Host-only controls
  const isHost = !!state.view && state.view.mySessionId === state.view.hostSessionId;
  if (isHost) {
    const phase = state.view?.phase ?? "waiting";
    let label: string | null = null;
    if (phase === "waiting") label = "Start round";
    else if (phase === "playing") label = "Show results";
    // results: no button per spec (could hide)
    if (label) {
      const hostBtn = createButton(label, () => handlers.onAdvancePhase(), { id: "host-advance-btn" });
      container.append(hostBtn);
    }
  }

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
    onAdvancePhase: () => {
      client.advancePhase();
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
