import type { ClientEvent, RoomStateView } from "../net/GameClient.js";
import { MAX_NAME_LENGTH, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@grandhotel/shared";

export type { RoomStateView, ClientEvent };
export type Phase = RoomStateView["phase"];

export type UIState =
  | { screen: "idle"; error?: string }
  | { screen: "named"; name: string; codeInput: string; error?: string }
  | { screen: "inRoom"; name: string; code: string; view: RoomStateView | null; error?: string };

export type BannerState =
  | { visible: false }
  | { visible: true; winner: RoomStateView["winner"]; traitorReveal: RoomStateView["traitorReveal"] };

/** Derives the results banner state from a RoomStateView. */
export function getBannerState(view: RoomStateView | null): BannerState {
  if (!view || view.phase !== "results") return { visible: false };
  return { visible: true, winner: view.winner, traitorReveal: view.traitorReveal };
}

export const initialState: UIState = { screen: "idle" };

export type UIAction =
  | { type: "submitName"; name: string }
  | { type: "setCodeInput"; code: string }
  | { type: "createRoom"; code: string }
  | { type: "joinRoom"; code: string }
  | { type: "joined"; code: string }
  | { type: "stateUpdate"; view: RoomStateView }
  | { type: "clientEvent"; event: ClientEvent }
  | { type: "dismissError" }
  | { type: "leave" }
  | { type: "clearRoleCache" };

export function filterCodeInput(input: string): string {
  const upper = input.toUpperCase();
  let out = "";
  for (const ch of upper) {
    if (ROOM_CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length >= ROOM_CODE_LENGTH) break;
  }
  return out;
}

export function isValidName(name: string): boolean {
  const t = name.trim();
  return t.length > 0 && t.length <= MAX_NAME_LENGTH;
}

export function isValidCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((c) => ROOM_CODE_ALPHABET.includes(c));
}

export function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case "submitName": {
      const trimmed = action.name.trim();
      if (!trimmed) {
        // stay idle, surface error
        return { ...state, screen: "idle", error: "Name required" } as UIState;
      }
      if (trimmed.length > MAX_NAME_LENGTH) {
        return { ...state, screen: "idle", error: "Name too long" } as UIState;
      }
      return { screen: "named", name: trimmed, codeInput: "", error: undefined };
    }
    case "setCodeInput": {
      if (state.screen !== "named") return state;
      const filtered = filterCodeInput(action.code);
      return { ...state, codeInput: filtered, error: undefined };
    }
    case "createRoom":
    case "joinRoom": {
      if (state.screen !== "named") return state;
      const code = action.code;
      return { screen: "inRoom", name: state.name, code, view: null, error: undefined };
    }
    case "joined": {
      if (state.screen === "inRoom") {
        return { ...state, code: action.code };
      }
      if (state.screen !== "named") return state;
      return { screen: "inRoom", name: state.name, code: action.code, view: null, error: undefined };
    }
    case "stateUpdate": {
      if (state.screen !== "inRoom") return state;
      return { ...state, view: action.view };
    }
    case "clientEvent": {
      const ev = action.event;
      if (ev.type === "rejected") {
        const msg = `Rejected: ${ev.reason}`;
        // keep screen, surface reason
        return { ...state, error: msg } as UIState;
      }
      if (ev.type === "error") {
        return { ...state, error: ev.message } as UIState;
      }
      // left -> optionally reset? keep error
      return state;
    }
    case "dismissError": {
      return { ...state, error: undefined } as UIState;
    }
    case "leave": {
      // go back to named, keep name if available
      if (state.screen === "inRoom") {
        return { screen: "named", name: state.name, codeInput: "", error: undefined };
      }
      if (state.screen === "named") return state;
      return { screen: "idle" };
    }
    case "clearRoleCache": {
      // UI signal only; role is cached in GameClient
      return state;
    }
    default:
      return state;
  }
}
