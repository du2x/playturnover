import Phaser from "phaser";
import type { ElevatorShaft, TrashFreshness } from "@grandhotel/shared";
import {
  AVATAR_BODY_SIZE_PX,
  AVATAR_COLORS,
  AVATAR_LABEL_FONT_SIZE_PX,
  ELEVATOR_A_X,
  ELEVATOR_B_X,
  ELEVATOR_RIDE_MS,
  FLOOR_COUNT,
  FLOOR_Y_STEP,
  HALLWAY_MAX_X,
  HALLWAY_MIN_X,
  HALLWAY_Y,
  LOBBY_CENTER,
  ROOM_COUNT,
  ROOM_GAP,
  ROOM_WIDTH,
  ROOMS_PER_FLOOR,
} from "@grandhotel/shared";
import { getAllRoomIds, getHallBounds, getRoomAt, getRoomRect, isInsideRoom } from "@grandhotel/shared";
import { step } from "../movement/horizontal.js";
import {
  deriveAvatarVisuals,
  FLOOR_TINT_HEXES,
  MARKER_COLORS,
  parseHexColor,
} from "./avatarIdentity.js";

interface RemoteAvatar {
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

/**
 * Hall hallway scene.
 * - Key "Hall"
 * - No bodies, pass-through only (techstack §6).
 * - Draws lobby + 3 guest floors: hallway strips, room rects, elevator shafts.
 * - Handles cursor-keys + WASD, integrates via `step` with dt capped at 100ms, sets x directly.
 * - Avatar has floor property; y only changes via setFloor() teleport.
 */
export class HallScene extends Phaser.Scene {
  private hallwayRects: Phaser.GameObjects.Rectangle[] = [];
  private floorLabels: Phaser.GameObjects.Text[] = [];
  private roomRects: Phaser.GameObjects.Rectangle[] = [];
  private roomDoorLines: Phaser.GameObjects.Line[] = [];
  private elevatorShafts: Phaser.GameObjects.Rectangle[] = [];
  private elevatorCallButtons: Phaser.GameObjects.Rectangle[] = [];
  private localRect?: Phaser.GameObjects.Rectangle;
  private localLabel?: Phaser.GameObjects.Text;
  private localName = "";
  private remotes = new Map<string, RemoteAvatar>();
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private spaceKey?: Phaser.Input.Keyboard.Key;
  // ── Elevator car visuals ─────────────────────────────────────────────────
  // Cars slide continuously between floor strips; riders render inside.
  private elevatorCars = new Map<
    ElevatorShaft,
    { rect: Phaser.GameObjects.Rectangle; displayFloor: number; syncedOnce?: boolean }
  >();
  private latestCarFloors: Record<ElevatorShaft, number> = { A: 0, B: 0 };
  private localRideShaft?: ElevatorShaft;
  private localRideStartedAt = -Infinity;
  private localPendingFloor?: number;
  private localX: number;
  private localFloor = 0;
  private localColorIndex = 0;
  private elevatorButtonCallback?: (shaft: "A" | "B") => void;
  // ── Room-state / evidence visuals (diegetic layer) ────────────────────────
  private roomStateOverlays = new Map<string, Phaser.GameObjects.Rectangle>();
  private trashIndicators = new Map<string, Phaser.GameObjects.Rectangle>();
  private doorCardIndicators = new Map<string, Phaser.GameObjects.Rectangle>();
  private latestRoomStates: Record<string, string | null> = {};
  private latestFreshness: Record<string, TrashFreshness> = {};
  private doorCards = new Map<string, boolean>();
  // Spectators/fired players see the full building (PRD FR-20): disable the
  // FR-10 interior gating when true.
  private overviewMode = false;

  /** Enables full-building interior visibility (spectator overview). */
  setOverviewMode(on: boolean): void {
    this.overviewMode = on;
  }

  constructor() {
    super({ key: "Hall" });
    this.localX = LOBBY_CENTER.x;
  }

  preload(): void {
    // no assets
  }

  create(): void {
    this.renderBuilding();
    this.setupInput();
    this.spawnLocalAvatar();
  }

  private renderBuilding(): void {
    // Render hallway strips for lobby (floor 0) + 3 guest floors
    for (let floor = 0; floor <= FLOOR_COUNT; floor++) {
      const bounds = getHallBounds(floor);
      const width = bounds.maxX - bounds.minX;
      const height = 40;

      // Per-floor tinted hallway strip (lobby 0 + guest floors)
      const rect = this.add.rectangle(
        (bounds.minX + bounds.maxX) / 2,
        bounds.y,
        width,
        height,
        FLOOR_TINT_HEXES[floor],
      );
      this.hallwayRects.push(rect);

      // Subtle floor line
      this.add.rectangle(
        (bounds.minX + bounds.maxX) / 2,
        bounds.y + height / 2,
        width,
        2,
        0x666666,
      );

      // Floor label
      const labelText = floor === 0 ? "LOBBY" : `${floor}F`;
      const label = this.add.text(
        bounds.minX + 10,
        bounds.y - 20,
        labelText,
        { fontSize: "14px", color: "#aaaaaa", fontFamily: "monospace" },
      );
      this.floorLabels.push(label);

      // Render rooms on guest floors (1-3)
      if (floor >= 1) {
        const perFloor = ROOMS_PER_FLOOR[floor - 1] ?? 8;
        for (let idx = 0; idx < perFloor; idx++) {
          const roomId = `${floor}-${idx}`;
          const roomRect = getRoomRect(roomId);
          
          // Room rectangle (slightly darker gray)
          const roomGfx = this.add.rectangle(
            (roomRect.xMin + roomRect.xMax) / 2,
            roomRect.y,
            roomRect.xMax - roomRect.xMin,
            40,
            0x777777,
          );
          roomGfx.setStrokeStyle(1, 0x555555);
          this.roomRects.push(roomGfx);

          // Door line (vertical line at room center x, spanning hallway height).
          // Brightened + thickened for readability (M4.2.2) — hit-areas and
          // state logic untouched.
          const doorX = (roomRect.xMin + roomRect.xMax) / 2;
          const doorLine = this.add.line(
            0, 0,
            doorX, roomRect.y - 20,
            doorX, roomRect.y + 20,
            0xeeeeee,
          );
          doorLine.setLineWidth(3);
          this.roomDoorLines.push(doorLine);

          // State tint overlay — drawn on top of the room rect, hidden until
          // the local avatar is inside the room (FR-10: state readable from
          // inside only). Clean renders as no tint.
          const stateOverlay = this.add.rectangle(
            (roomRect.xMin + roomRect.xMax) / 2,
            roomRect.y,
            roomRect.xMax - roomRect.xMin,
            40,
            0x777777,
            0,
          );
          this.roomStateOverlays.set(roomId, stateOverlay);

          // Trash freshness marker (interior cue, same FR-10 gating).
          const trashMarker = this.add.rectangle(
            doorX + 18,
            roomRect.y + 12,
            10, 6,
            MARKER_COLORS.roomTrashed,
            0,
          );
          this.trashIndicators.set(roomId, trashMarker);

          // Door status card marker — permanent door evidence (FR-11),
          // visible from the hallway next to the door.
          const cardMarker = this.add.rectangle(
            doorX - 14,
            roomRect.y - 14,
            12, 7,
            MARKER_COLORS.doorCard,
            0,
          );
          this.doorCardIndicators.set(roomId, cardMarker);
        }
      }

      // Render elevator shafts (both floors)
      // Shaft A (west)
      const shaftARect = this.add.rectangle(
        ELEVATOR_A_X,
        bounds.y,
        36,
        40,
        0x555555,
      );
      shaftARect.setStrokeStyle(2, 0x333333);
      this.elevatorShafts.push(shaftARect);

      // Shaft A label (presentation only, M4.2.2)
      const shaftALabel = this.add.text(
        ELEVATOR_A_X,
        bounds.y,
        "A",
        { fontSize: "14px", color: "#eeeeee", fontFamily: "monospace" },
      );
      shaftALabel.setOrigin(0.5);

      // Shaft B (east)
      const shaftBRect = this.add.rectangle(
        ELEVATOR_B_X,
        bounds.y,
        36,
        40,
        0x555555,
      );
      shaftBRect.setStrokeStyle(2, 0x333333);
      this.elevatorShafts.push(shaftBRect);

      // Shaft B label (presentation only, M4.2.2)
      const shaftBLabel = this.add.text(
        ELEVATOR_B_X,
        bounds.y,
        "B",
        { fontSize: "14px", color: "#eeeeee", fontFamily: "monospace" },
      );
      shaftBLabel.setOrigin(0.5);

      // Elevator call buttons (clickable rects above each shaft)
      const buttonWidth = 40;
      const buttonHeight = 16;
      const buttonY = bounds.y - 40;

      // Button for shaft A
      const btnA = this.add.rectangle(
        ELEVATOR_A_X,
        buttonY,
        buttonWidth,
        buttonHeight,
        MARKER_COLORS.elevatorButton,
      );
      btnA.setInteractive({ useHandCursor: true });
      btnA.on("pointerdown", () => this.emitElevatorCall("A"));
      this.elevatorCallButtons.push(btnA);

      // Button for shaft B
      const btnB = this.add.rectangle(
        ELEVATOR_B_X,
        buttonY,
        buttonWidth,
        buttonHeight,
        MARKER_COLORS.elevatorButton,
      );
      btnB.setInteractive({ useHandCursor: true });
      btnB.on("pointerdown", () => this.emitElevatorCall("B"));
      this.elevatorCallButtons.push(btnB);
    }

    // One car per shaft, sliding vertically between floor strips. Created
    // after shafts/buttons but before avatars, so riders render on top.
    for (const shaft of ["A", "B"] as const) {
      const rect = this.add.rectangle(
        shaft === "A" ? ELEVATOR_A_X : ELEVATOR_B_X,
        HALLWAY_Y,
        28,
        34,
        0x1f1f1f,
      );
      rect.setStrokeStyle(2, 0xdddddd);
      this.elevatorCars.set(shaft, {
        rect,
        displayFloor: 0,
      });
    }
  }

  private emitElevatorCall(shaft: "A" | "B"): void {
    if (this.elevatorButtonCallback) {
      this.elevatorButtonCallback(shaft);
    }
  }

  /** Nearest shaft to the local avatar (server still enforces interact radius). */
  getNearestShaft(): "A" | "B" {
    return Math.abs(this.localX - ELEVATOR_A_X) <=
      Math.abs(this.localX - ELEVATOR_B_X)
      ? "A"
      : "B";
  }

  private setupInput(): void {
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = {
        W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
      this.spaceKey = this.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.SPACE,
      );
    }
  }

  /**
   * Creates one enlarged labeled avatar (M4.2.2): AVATAR_BODY_SIZE_PX square
   * filled with the player color plus a non-interactive Text initial. No
   * physics bodies — plain GameObjects moved by direct x/y assignment.
   */
  private createAvatarBody(
    x: number,
    y: number,
    name: string,
    colorIndex: number,
  ): RemoteAvatar {
    const visuals = deriveAvatarVisuals(name, colorIndex);
    const rect = this.add.rectangle(
      x,
      y,
      AVATAR_BODY_SIZE_PX,
      AVATAR_BODY_SIZE_PX,
      parseHexColor(visuals.colorHex),
    );
    const label = this.add.text(x, y, visuals.initial, {
      fontSize: `${AVATAR_LABEL_FONT_SIZE_PX}px`,
      color: "#ffffff",
      fontFamily: "monospace",
    });
    label.setOrigin(0.5);
    return { rect, label };
  }

  private spawnLocalAvatar(): void {
    const bounds = getHallBounds(this.localFloor);
    const body = this.createAvatarBody(
      this.localX,
      bounds.y,
      this.localName,
      this.localColorIndex,
    );
    this.localRect = body.rect;
    this.localLabel = body.label;
    // No body ever — plain GameObject, x/y set directly
  }

  override update(_time: number, delta: number): void {
    const dtSec = Math.min(delta, 100) / 1000;
    this.animateElevatorCars(dtSec);
    const dir = this.localRideShaft ? 0 : this.getInputDir();
    this.localX = step(this.localX, dir, dtSec, this.localFloor);
    if (this.spaceKey && Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.emitElevatorCall(this.getNearestShaft());
    }
    const rideEntry =
      this.localRideShaft && !this.localRideTimedOut(_time)
        ? (this.elevatorCars.get(this.localRideShaft) ?? null)
        : null;
    if (this.localRect && rideEntry) {
      // Rider stands inside the car while it travels.
      this.localRect.x = rideEntry.rect.x;
      this.localRect.y = rideEntry.rect.y - 2;
      if (this.localLabel) {
        this.localLabel.x = rideEntry.rect.x;
        this.localLabel.y = rideEntry.rect.y - 14;
      }
      this.trySettleLocalRide(_time);
    } else {
      if (this.localRideShaft && !rideEntry) {
        // Ride never landed (e.g. queued for a later cycle) — restore hallway
        // rendering rather than leaving the avatar stuck inside a car.
        this.cancelLocalRide();
      }
      if (this.localRect) {
        this.localRect.x = this.localX;
        // y only changes via setFloor() teleport
        const bounds = getHallBounds(this.localFloor);
        this.localRect.y = bounds.y;
        if (this.localLabel) {
          this.localLabel.x = this.localX;
          this.localLabel.y = bounds.y;
        }
      }
    }
    this.applyRoomVisuals();
  }

  /** Slides each car toward its authoritative floor, one strip per ride time. */
  private animateElevatorCars(dtSec: number): void {
    const floorsPerSec = 1000 / ELEVATOR_RIDE_MS;
    for (const [shaft, entry] of this.elevatorCars) {
      const target = this.latestCarFloors[shaft];
      const diff = target - entry.displayFloor;
      const maxStep = floorsPerSec * dtSec;
      entry.displayFloor =
        Math.abs(diff) <= maxStep
          ? target
          : entry.displayFloor + Math.sign(diff) * maxStep;
      entry.rect.y = HALLWAY_Y + entry.displayFloor * FLOOR_Y_STEP;
      entry.rect.setAlpha(Math.abs(diff) > 0.001 ? 1 : 0.85);
    }
  }

  private localRideTimedOut(nowMs: number): boolean {
    return nowMs - this.localRideStartedAt > ELEVATOR_RIDE_MS * 3;
  }

  private trySettleLocalRide(_nowMs?: number): void {
    if (this.localPendingFloor === undefined || !this.localRideShaft) return;
    const shaft = this.localRideShaft;
    const entry = this.elevatorCars.get(shaft);
    if (!entry || entry.displayFloor !== this.latestCarFloors[shaft]) return;
    const pending = this.localPendingFloor;
    this.cancelLocalRide();
    // Offboard exactly at the shaft, not the corridor center.
    this.applyLocalFloor(pending, shaft === "A" ? ELEVATOR_A_X : ELEVATOR_B_X);
  }

  private cancelLocalRide(): void {
    this.localRideShaft = undefined;
    this.localPendingFloor = undefined;
    this.localRideStartedAt = -Infinity;
  }

  /** Applies latest known room states/evidence with FR-10 visibility gating. */
  private applyRoomVisuals(): void {
    // Only the room the local avatar is standing in reveals its interior
    // (PRD FR-10 / pillar "information has travel cost") — unless the local
    // player is a spectator with full-building overview (FR-20).
    const revealAll = this.overviewMode;
    let currentRoom: string | null = null;
    try {
      currentRoom = this.getCurrentRoom();
    } catch {
      currentRoom = null;
    }
    for (const [roomId, overlay] of this.roomStateOverlays) {
      if (roomId !== currentRoom && !revealAll) {
        overlay.setAlpha(0);
        continue;
      }
      const state = this.latestRoomStates[roomId] ?? null;
      if (state === "prepped") {
        overlay.fillColor = MARKER_COLORS.roomPrepped;
        overlay.setAlpha(0.35);
      } else if (state === "trashed") {
        overlay.fillColor = MARKER_COLORS.roomTrashed;
        overlay.setAlpha(0.45);
      } else {
        overlay.setAlpha(0);
      }
    }
    for (const [roomId, marker] of this.trashIndicators) {
      if ((roomId !== currentRoom && !revealAll) || !this.latestFreshness[roomId]) {
        marker.setAlpha(0);
        continue;
      }
      marker.fillColor =
        this.latestFreshness[roomId] === "fresh"
          ? MARKER_COLORS.trashFresh
          : MARKER_COLORS.trashSettled;
      marker.setAlpha(1);
    }
    // Door cards are permanent hallway evidence — no interior gating.
    for (const [roomId, marker] of this.doorCardIndicators) {
      const evidenceHasCard = this.doorCards.get(roomId) === true;
      marker.setAlpha(evidenceHasCard ? 1 : 0);
    }
  }

  /**
   * Push the authoritative roomsView snapshot; visuals are applied on
   * the next scene update using local-position gating.
   */
  syncRoomStates(states: Record<string, string | null>): void {
    this.latestRoomStates = { ...states };
  }

  /** Push the evidenceView snapshot (card presence + trash freshness). */
  syncEvidence(
    evidence: Record<
      string,
      { card?: { present?: boolean }; freshness?: TrashFreshness | null }
    >,
  ): void {
    this.latestFreshness = {};
    for (const key of this.doorCards.keys()) this.doorCards.set(key, false);
    for (const [roomId, ev] of Object.entries(evidence)) {
      if (!ev) continue;
      this.latestFreshness[roomId] = ev.freshness ?? null;
      this.doorCards.set(roomId, ev.card?.present === true);
    }
  }

  /** Resets all room-state/evidence visuals (phase transitions). */
  clearRoundVisuals(): void {
    this.latestRoomStates = {};
    this.latestFreshness = {};
    this.doorCards.clear();
    this.applyRoomVisuals();
  }

  private getInputDir(): -1 | 0 | 1 {
    let left = false;
    let right = false;
    if (this.cursors) {
      left = left || this.cursors.left.isDown;
      right = right || this.cursors.right.isDown;
    }
    if (this.wasd) {
      left = left || this.wasd.A.isDown;
      right = right || this.wasd.D.isDown;
      // W/S are vertical, ignored for horizontal only — but WASD support per spec means A/D
    }
    if (left && !right) return -1;
    if (right && !left) return 1;
    return 0;
  }

  // ── Exposed API for net layer ────────────────────────────────────────────

  addRemote(id: string, colorIndex: number, floor = 0, name = ""): void {
    if (this.remotes.has(id)) return;
    const bounds = getHallBounds(floor);
    const x = (bounds.minX + bounds.maxX) / 2;
    const body = this.createAvatarBody(x, bounds.y, name, colorIndex);
    this.remotes.set(id, body);
  }

  setRemoteX(id: string, x: number): void {
    const r = this.remotes.get(id);
    if (r) {
      r.rect.x = x;
      r.label.x = x;
      // y stays at current floor's hallway y (floor tracked separately if needed)
    }
  }

  setRemoteFloor(id: string, floor: number): void {
    const r = this.remotes.get(id);
    if (r) {
      const bounds = getHallBounds(floor);
      r.rect.y = bounds.y;
      r.label.y = bounds.y;
    }
  }

  removeRemote(id: string): void {
    const r = this.remotes.get(id);
    if (r) {
      r.rect.destroy();
      r.label.destroy();
      this.remotes.delete(id);
    }
  }

  getLocalX(): number {
    return this.localX;
  }

  getLocalFloor(): number {
    return this.localFloor;
  }

  setLocalFloor(floor: number): void {
    if (this.localRideShaft) {
      // Authoritative floor arrived mid-ride; hold it until the car settles
      // visually, then apply (keeps the avatar inside the moving car).
      this.localPendingFloor = floor;
      return;
    }
    this.applyLocalFloor(floor);
  }

  private applyLocalFloor(floor: number, xOverride?: number): void {
    this.localFloor = floor;
    const bounds = getHallBounds(floor);
    this.localX =
      xOverride ?? bounds.minX + (bounds.maxX - bounds.minX) / 2; // hallway center
    if (this.localRect) {
      this.localRect.x = this.localX;
      this.localRect.y = bounds.y;
    }
    if (this.localLabel) {
      this.localLabel.x = this.localX;
      this.localLabel.y = bounds.y;
    }
  }

  /** Teleports local avatar to lobby center on floor change (called from elevator ride completion). */
  setFloor(floor: number): void {
    this.setLocalFloor(floor);
  }

  consumeInputDir(): -1 | 0 | 1 {
    return this.getInputDir();
  }

  /** Returns true if local avatar is inside the given room. */
  isInsideRoom(roomId: string): boolean {
    return isInsideRoom(this.localX, this.localFloor, roomId);
  }

  /** Returns the roomId the local avatar is currently inside, or null if in hallway. */
  getCurrentRoom(): string | null {
    return getRoomAt(this.localX, this.localFloor);
  }

  /** Set callback for elevator call button clicks. */
  onElevatorCall(callback: (shaft: "A" | "B") => void): void {
    this.elevatorButtonCallback = callback;
  }

  /** Push latest authoritative elevator car data (floor drives the visuals). */
  syncElevators(
    view: Record<ElevatorShaft, { floor: number; state: string }>,
  ): void {
    for (const shaft of ["A", "B"] as const) {
      const data = view[shaft];
      if (!data) continue;
      this.latestCarFloors[shaft] = data.floor;
      const entry = this.elevatorCars.get(shaft);
      if (entry && !entry.syncedOnce) {
        entry.displayFloor = data.floor;
        entry.syncedOnce = true;
      }
    }
  }

  /**
   * Marks the local avatar as riding the given shaft: rendered inside the
   * car until it settles at the destination (or the ride times out).
   */
  beginLocalRide(shaft: ElevatorShaft, nowMs?: number): void {
    this.localRideShaft = shaft;
    this.localRideStartedAt =
      nowMs ??
      (typeof performance !== "undefined" ? performance.now() : Date.now());
  }

  /** For tests: allow setting local color before create */
  setLocalColorIndex(idx: number): void {
    this.localColorIndex = idx;
    if (this.localRect) {
      this.localRect.fillColor = parseHexColor(
        deriveAvatarVisuals(this.localName, idx).colorHex,
      );
    }
  }

  /**
   * Sets the local player's display name so the avatar label shows the
   * initial (M4.2.2). Optional hook — existing callers work unchanged with
   * the "?" fallback until wired.
   */
  setLocalPlayerName(name: string): void {
    this.localName = name;
    if (this.localLabel && this.localRect) {
      this.localLabel.setText(
        deriveAvatarVisuals(name, this.localColorIndex).initial,
      );
    }
  }
}
