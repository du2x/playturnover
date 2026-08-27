import { ColyseusGameClient } from "./net/ColyseusGameClient.js";
import type { RoomStateView } from "./net/GameClient.js";
import type { UIAction, UIState } from "./ui/reducer.js";
import { filterCodeInput, initialState, uiReducer } from "./ui/reducer.js";
import { renderOverlay } from "./ui/screens.js";
import { Interpolator } from "./movement/interpolate.js";
import {
  ACCUSATION_RANGE_TILES,
  CHANNEL_DURATIONS,
  CLIENT_INPUT_SEND_HZ,
  PLAYER_SPEED_PX_S,
} from "@grandhotel/shared";
import {
  FLOOR_Y_STEP,
  HALLWAY_Y,
  RUSTLE_RANGE_TILES,
  TILE_SIZE_PX,
} from "@grandhotel/shared";
import type { HallScene as HallSceneType } from "./game/HallScene.js";

let uiState: UIState = initialState;
// Phaser and HallScene are lazy-loaded to keep jsdom tests green (no canvas in node)
let game: unknown | null = null;
let hallScene: HallSceneType | null = null;
const interpolators = new Map<string, Interpolator>();
let inputTimer: ReturnType<typeof setInterval> | null = null;
let rafId: number | null = null;
let seq = 0;
let gameStarting = false;
let resultsFrozen = false;

const client = new ColyseusGameClient();

// Channel state tracked locally for the hold-E overlay progress bar.
type ActiveChannel = {
  roomId: string;
  type: "prep" | "unprep" | "fake";
  startAt: number;
};
let channelActive: ActiveChannel | null = null;
let channelKeyHeld = false;

type ActiveAccusation = {
  targetId: string;
  targetName: string;
  startAt: number;
  duration: number;
};
let accusationActive: ActiveAccusation | null = null;
let accusationKeyHeld = false;

function isFiredOrSpectator(view: RoomStateView | null): boolean {
  if (!view) return false;
  const me = view.players.find((p) => p.id === view.mySessionId);
  return me?.fired === true || me?.spectator === true;
}

function clearAccusationActive(): void {
  accusationActive = null;
  accusationKeyHeld = false;
}

function getNearbyAccusationTargets(
  view: RoomStateView,
  localX: number,
  localFloor: number,
): Array<{ id: string; name: string; x: number }> {
  const me = view.players.find((p) => p.id === view.mySessionId);
  if (!me || me.fired || me.spectator || view.myRole !== "staff") return [];
  const maxRangePx = ACCUSATION_RANGE_TILES * TILE_SIZE_PX;
  return view.players
    .filter(
      (p) =>
        p.id !== me.id &&
        !p.fired &&
        !p.spectator &&
        p.floor === localFloor &&
        Math.abs(p.x - localX) <= maxRangePx,
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
    }));
}

function getOverlay(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("overlay");
}

function getHud(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("hud");
}

function getChannelBar(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("channel-bar");
}

function getChannelLabel(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("channel-label");
}

function getChannelFill(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("channel-fill");
}

function ensureHudElements(overlay: HTMLElement): void {
  if (!getHud()) {
    const hud = document.createElement("div");
    hud.id = "hud";
    hud.hidden = true;
    overlay.append(hud);
  }
  if (!getChannelBar()) {
    const bar = document.createElement("div");
    bar.id = "channel-bar";
    bar.hidden = true;
    bar.innerHTML = `
      <div id="channel-label"></div>
      <div id="channel-track"><div id="channel-fill"></div></div>
    `;
    overlay.append(bar);
  }
}

async function ensureGameStarted(view: RoomStateView): Promise<void> {
  if (game || gameStarting || typeof document === "undefined") return;
  gameStarting = true;
  const me = view.players.find((p) => p.id === view.mySessionId) ?? null;
  const myColor = me?.colorIndex ?? 0;
  try {
    const [{ default: Phaser }, { HallScene }] = await Promise.all([
      import("phaser"),
      import("./game/HallScene.js"),
    ]);
    const sceneInstance = new HallScene() as HallSceneType;
    sceneInstance.setLocalColorIndex(myColor);
    sceneInstance.onElevatorCall((shaft) => {
      const currentView = uiState.screen === "inRoom" ? uiState.view : null;
      if (!resultsFrozen && !isFiredOrSpectator(currentView)) {
        client.callElevator(shaft);
      }
    });

    // Phaser will mount canvas into #app (960×540 fits lobby + 3 guest floors)
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "app",
      width: 960,
      height: 540,
      backgroundColor: "#bbbbbb",
      pixelArt: true,
      scene: [sceneInstance as unknown as Phaser.Scene],
    });
    hallScene = sceneInstance;

    // Input pump: read consumeInputDir at CLIENT_INPUT_SEND_HZ and send dx
    const ms = Math.round(1000 / CLIENT_INPUT_SEND_HZ);
    inputTimer = setInterval(() => {
      if (!hallScene) return;
      if (resultsFrozen) return;
      const currentView = uiState.screen === "inRoom" ? uiState.view : null;
      if (isFiredOrSpectator(currentView)) return;
      const dir = hallScene.consumeInputDir();
      if (dir !== 0) {
        const dx = (dir * PLAYER_SPEED_PX_S) / CLIENT_INPUT_SEND_HZ;
        seq += 1;
        client.sendMove({ dx, dy: 0, seq });
      }
    }, ms);

    // Remote interpolation pump — requestAnimationFrame glides remote dots
    const tick = (): void => {
      if (!hallScene) {
        rafId = null;
        return;
      }
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      for (const [id, interp] of interpolators) {
        const x = interp.sample(now);
        hallScene.setRemoteX(id, x);
      }

      // Keep overlays in sync every frame (timer countdown, channel hold bar)
      updateChannelBar(now);
      const view = uiState.screen === "inRoom" ? uiState.view : null;
      if (view) updateHud(view);

      // Walk-out cancels an active channel on the client side (R-9)
      if (channelActive && !resultsFrozen) {
        const currentRoom = hallScene.getCurrentRoom();
        if (currentRoom !== channelActive.roomId) {
          client.cancelChannel();
          clearChannelActive();
        }
      }

      // Out of range cancels an active accusation hold
      if (accusationActive && !resultsFrozen) {
        if (view) {
          const targets = getNearbyAccusationTargets(
            view,
            hallScene.getLocalX(),
            hallScene.getLocalFloor(),
          );
          if (!targets.some((t) => t.id === accusationActive?.targetId)) {
            clearAccusationActive();
            const bar = getChannelBar();
            if (bar) bar.hidden = true;
          }
        } else {
          clearAccusationActive();
          const bar = getChannelBar();
          if (bar) bar.hidden = true;
        }
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  } catch {
    gameStarting = false;
  }
}

function clearChannelActive(): void {
  channelActive = null;
  channelKeyHeld = false;
}

function channelDuration(type: ActiveChannel["type"]): number {
  return CHANNEL_DURATIONS[type];
}

function updateChannelBar(now: number): void {
  const bar = getChannelBar();
  const fill = getChannelFill();
  const label = getChannelLabel();
  if (!bar || !fill || !label) return;

  if (accusationActive) {
    const max = accusationActive.duration;
    const elapsed = now - accusationActive.startAt;
    const pct = Math.max(0, Math.min(100, (elapsed / max) * 100));
    fill.style.width = `${pct}%`;
    fill.style.background = "#e63946";
    label.textContent = `ACCUSING ${accusationActive.targetName.toUpperCase()}... (HOLD E)`;
    bar.hidden = false;
    if (elapsed >= max) {
      const targetId = accusationActive.targetId;
      clearAccusationActive();
      bar.hidden = true;
      client.accuse(targetId);
    }
    return;
  }

  if (!channelActive) {
    bar.hidden = true;
    return;
  }

  const max = channelDuration(channelActive.type);
  const elapsed = now - channelActive.startAt;
  const pct = Math.max(0, Math.min(100, (elapsed / max) * 100));
  fill.style.width = `${pct}%`;
  // Real prep and fake use identical visuals; unprep shows red.
  fill.style.background =
    channelActive.type === "unprep" ? "#b00020" : "#4caf50";
  label.textContent =
    channelActive.type === "unprep"
      ? "SABOTAGING..."
      : channelActive.type === "fake"
        ? "PREPPING..."
        : "PREPPING...";
  bar.hidden = false;
}

function updateHud(view: RoomStateView | null): void {
  const hud = getHud();
  if (!hud) return;

  if (uiState.screen !== "inRoom" || !view) {
    hud.hidden = true;
    return;
  }

  hud.hidden = false;
  if (view.phase === "results") {
    hud.textContent = `ROUND OVER · Coverage: ${view.coveragePercent ?? 0}%`;
    return;
  }
  if (view.phase === "waiting") {
    hud.textContent = `WAITING FOR HOST · Coverage: ${view.coveragePercent ?? 0}%`;
    return;
  }

  const end = view.shiftEndsAt;
  if (!end || end <= 0) {
    hud.textContent = `Coverage: ${view.coveragePercent ?? 0}%`;
    return;
  }
  const remainingMs = Math.max(0, end - Date.now());
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  hud.textContent = `Shift: ${minutes}:${seconds.toString().padStart(2, "0")} · Coverage: ${view.coveragePercent ?? 0}%`;
}

function playRustle(event: { x: number; y: number }): void {
  if (typeof window === "undefined" || !hallScene) return;
  const view = uiState.screen === "inRoom" ? uiState.view : null;
  const local = view?.players.find((p) => p.id === view.mySessionId) ?? null;
  if (
    !local ||
    local.floor !== Math.round((event.y - HALLWAY_Y) / FLOOR_Y_STEP)
  )
    return;
  const distanceTiles =
    Math.max(
      Math.abs(local.x - event.x),
      Math.abs(local.floor * FLOOR_Y_STEP + HALLWAY_Y - event.y),
    ) / TILE_SIZE_PX;
  if (distanceTiles > RUSTLE_RANGE_TILES) return;
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = new AudioContextCtor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const panner = context.createStereoPanner();
  oscillator.type = "sawtooth";
  oscillator.frequency.value = 180;
  gain.gain.value = Math.max(
    0.01,
    0.08 * (1 - distanceTiles / RUSTLE_RANGE_TILES),
  );
  panner.pan.value = Math.max(
    -1,
    Math.min(1, (event.x - local.x) / (RUSTLE_RANGE_TILES * TILE_SIZE_PX)),
  );
  oscillator.connect(gain).connect(panner).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.12);
  oscillator.addEventListener("ended", () => void context.close());
}

function syncLocalState(view: RoomStateView): void {
  if (!hallScene) return;
  if (view.myFloor !== hallScene.getLocalFloor()) {
    // Floor change cancels any active channel (R-9)
    if (channelActive) {
      client.cancelChannel();
      clearChannelActive();
    }
    if (accusationActive) {
      clearAccusationActive();
    }
    hallScene.setFloor(view.myFloor);
  }
}

function syncRoster(view: RoomStateView): void {
  if (!hallScene) return;
  const remoteIds = new Set<string>();
  for (const p of view.players) {
    if (p.id === view.mySessionId) continue;
    remoteIds.add(p.id);
    let interp = interpolators.get(p.id);
    if (!interp) {
      interp = new Interpolator();
      interpolators.set(p.id, interp);
      hallScene.addRemote(p.id, p.colorIndex, p.floor);
    }
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    interp.push(now, p.x);
    hallScene.setRemoteFloor(p.id, p.floor);
  }
  for (const id of [...interpolators.keys()]) {
    if (!remoteIds.has(id)) {
      interpolators.delete(id);
      hallScene.removeRemote(id);
    }
  }
}

// Push room-state/evidence snapshots into the Phaser scene's diegetic layer.
function syncRoomVisuals(view: RoomStateView): void {
  if (!hallScene) return;
  hallScene.setOverviewMode(isFiredOrSpectator(view));
  if (view.phase === "playing") {
    hallScene.syncRoomStates(view.roomsView);
    if (view.evidenceView) {
      hallScene.syncEvidence(
        view.evidenceView as Record<
          string,
          { card?: { present?: boolean }; freshness?: "fresh" | "settled" | null }
        >,
      );
    }
  } else {
    // Waiting/results reset interior tints and evidence markers.
    hallScene.clearRoundVisuals();
  }
}

function dispatch(action: UIAction): void {
  const next = uiReducer(uiState, action);
  uiState = next;
  rerender();
  // Side-effects driven by InRoom view
  if (next.screen === "inRoom" && next.view) {
    resultsFrozen = next.view.phase === "results";
    if (resultsFrozen || isFiredOrSpectator(next.view)) {
      clearChannelActive();
      clearAccusationActive();
    }
    void ensureGameStarted(next.view);
    syncLocalState(next.view);
    syncRoster(next.view);
    syncRoomVisuals(next.view);
    updateHud(next.view);
  } else {
    resultsFrozen = false;
    if (hallScene) hallScene.clearRoundVisuals();
  }
}

function rerender(): void {
  const overlay = getOverlay();
  if (!overlay) return;
  renderOverlay(overlay, uiState, handlers);
}

const handlers = {
  onSubmitName: async (name: string): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      dispatch({ type: "submitName", name });
      return;
    }
    try {
      await client.connect(trimmed);
    } catch {
      // rejected surface via onEvent
    }
    dispatch({ type: "submitName", name });
  },
  onCreateRoom: async (): Promise<void> => {
    try {
      const code = await client.createRoom();
      dispatch({ type: "joined", code });
    } catch {
      // error surfaced via onEvent -> dispatch inside event handler
    }
  },
  onJoinRoom: async (code: string): Promise<void> => {
    const filtered = filterCodeInput(code);
    try {
      await client.joinByCode(filtered);
      dispatch({ type: "joined", code: filtered });
    } catch {
      // surfaced via onEvent
    }
  },
  onStartRound: (): void => {
    client.startRound();
  },
  // Elevator calls come from the in-world Phaser buttons (ensureGameStarted
  // wiring); accusations and channels run through hold-E listeners below —
  // none of these need HTML overlay handlers anymore.
  onStartChannel: (type: "prep" | "unprep" | "fake", roomId: string): void => {
    const currentView = uiState.screen === "inRoom" ? uiState.view : null;
    if (resultsFrozen || isFiredOrSpectator(currentView)) return;
    // Mirror the keyboard hold path so the on-screen buttons also drive the
    // shared progress-bar overlay (real prep / fake prep / unprep).
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    channelActive = { roomId, type, startAt: now };
    client.startChannel(type, roomId);
  },
  onCancelChannel: (): void => {
    client.cancelChannel();
    clearChannelActive();
  },
  onSetCodeInput: (code: string): void => {
    dispatch({ type: "setCodeInput", code });
  },
};

// Wire client state/event into reducer — roster re-render, phase label, host buttons, toast
client.onState((view: RoomStateView) => {
  dispatch({ type: "stateUpdate", view });
});

client.onEvent((ev) => {
  if (ev.type === "sabotage") playRustle(ev);
  dispatch({ type: "clientEvent", event: ev });
});

// Keyboard hold actions (channels and accusations). Mirrors the on-screen controls.
function onKeyDown(e: KeyboardEvent): void {
  if (channelKeyHeld || accusationKeyHeld) return;
  if (!hallScene) return;
  if (resultsFrozen) return;
  if (uiState.screen !== "inRoom") return;
  const view = uiState.view;
  if (!view || view.phase !== "playing") return;
  if (isFiredOrSpectator(view)) return;
  if (e.repeat) return;
  if (e.key.toLowerCase() !== "e") return;

  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  // Accusation priority if staff is within range of an eligible target
  if (view.myRole === "staff") {
    const targets = getNearbyAccusationTargets(
      view,
      hallScene.getLocalX(),
      hallScene.getLocalFloor(),
    );
    if (targets.length > 0) {
      const target = targets[0]!;
      accusationKeyHeld = true;
      accusationActive = {
        targetId: target.id,
        targetName: target.name,
        startAt: now,
        duration: 1000,
      };
      e.preventDefault();
      return;
    }
  }

  const roomId = hallScene.getCurrentRoom();
  if (!roomId) return;

  const role = view.myRole;
  if (role !== "staff" && role !== "saboteur") return;

  const state = view.roomsView[roomId];

  let type: "prep" | "unprep" | "fake" | null = null;
  if (e.shiftKey) {
    if (role === "saboteur") type = "fake";
  } else if (
    role === "saboteur" &&
    (state === "prepped" || state === "trashed")
  ) {
    type = "unprep";
  } else {
    type = "prep";
  }

  // Avoid client-side spam for states the server would reject.
  if (role === "staff" && type === "prep" && state !== "clean") return;
  if (!type) return;

  channelKeyHeld = true;
  channelActive = { roomId, type, startAt: now };
  client.startChannel(type, roomId);
  e.preventDefault();
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.key.toLowerCase() === "e") {
    if (accusationActive || accusationKeyHeld) {
      clearAccusationActive();
      const bar = getChannelBar();
      if (bar) bar.hidden = true;
    }
    if (channelKeyHeld) {
      client.cancelChannel();
      clearChannelActive();
    }
  }
}

function onWindowBlur(): void {
  if (accusationActive || accusationKeyHeld) {
    clearAccusationActive();
    const bar = getChannelBar();
    if (bar) bar.hidden = true;
  }
  if (channelKeyHeld) {
    client.cancelChannel();
    clearChannelActive();
  }
}

function setupInputListeners(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onWindowBlur);
}

function removeInputListeners(): void {
  if (typeof window === "undefined") return;
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("blur", onWindowBlur);
}

// Initial boot: show name screen (reducer Idle) or rerender
function boot(): string {
  const overlay = getOverlay();
  if (overlay) {
    ensureHudElements(overlay);
    rerender();
  }
  setupInputListeners();
  // Also ensure HallScene local feedback runs every frame via its own update (instant self-feedback)
  // Remote interpolation and input pump start only after entering room (ensureGameStarted)
  return "boot";
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}

// Keep exports for skeleton compatibility and for tests that might import boot
export { boot };

if (typeof window !== "undefined") {
  // expose for debug
  (window as unknown as Record<string, unknown>).__gh_client = client;
}

// Cleanup on unload (optional)
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (inputTimer) clearInterval(inputTimer);
    if (rafId !== null) cancelAnimationFrame(rafId);
    removeInputListeners();
    client.disconnect();
    if (game) {
      try {
        (game as { destroy: (v: boolean) => void }).destroy(true);
      } catch {
        // ignore
      }
    }
  });
}
