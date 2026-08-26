import { ColyseusGameClient } from "./net/ColyseusGameClient.js";
import type { RoomStateView } from "./net/GameClient.js";
import type { UIAction, UIState } from "./ui/reducer.js";
import { filterCodeInput, initialState, uiReducer } from "./ui/reducer.js";
import { renderOverlay } from "./ui/screens.js";
import { Interpolator } from "./movement/interpolate.js";
import { CLIENT_INPUT_SEND_HZ, PLAYER_SPEED_PX_S } from "@grandhotel/shared";
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

const client = new ColyseusGameClient();

function getOverlay(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("overlay");
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

    // Phaser will mount canvas into #app
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "app",
      width: 960,
      height: 240,
      backgroundColor: "#bbbbbb",
      pixelArt: true,
      scene: sceneInstance as unknown as Phaser.Scene,
    });
    hallScene = sceneInstance;

    // Input pump: read consumeInputDir at CLIENT_INPUT_SEND_HZ and send dx
    const ms = Math.round(1000 / CLIENT_INPUT_SEND_HZ);
    inputTimer = setInterval(() => {
      if (!hallScene) return;
      const dir = hallScene.consumeInputDir();
      if (dir !== 0) {
        const dx = dir * PLAYER_SPEED_PX_S / CLIENT_INPUT_SEND_HZ;
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
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      for (const [id, interp] of interpolators) {
        const x = interp.sample(now);
        hallScene.setRemoteX(id, x);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  } catch {
    gameStarting = false;
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
      hallScene.addRemote(p.id, p.colorIndex);
    }
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    interp.push(now, p.x);
  }
  for (const id of [...interpolators.keys()]) {
    if (!remoteIds.has(id)) {
      interpolators.delete(id);
      hallScene.removeRemote(id);
    }
  }
}

function dispatch(action: UIAction): void {
  const next = uiReducer(uiState, action);
  uiState = next;
  rerender();
  // Side-effects driven by InRoom view
  if (next.screen === "inRoom" && next.view) {
    void ensureGameStarted(next.view);
    syncRoster(next.view);
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
  onAdvancePhase: (): void => {
    client.advancePhase();
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
  dispatch({ type: "clientEvent", event: ev });
});

// Initial boot: show name screen (reducer Idle) or rerender
function boot(): string {
  const overlay = getOverlay();
  if (overlay) {
    // Keep import.meta.env.VITE_GAME_URL wiring intact — ColyseusGameClient reads it internally
    void import.meta;
    rerender();
  }
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

console.log("boot");
