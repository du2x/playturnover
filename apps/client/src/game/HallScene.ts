import Phaser from "phaser";
import {
  AVATAR_COLORS,
  ELEVATOR_A_X,
  ELEVATOR_B_X,
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

function parseHexColor(hex: string): number {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return Number.parseInt(h, 16);
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
  private remotes = new Map<string, Phaser.GameObjects.Rectangle>();
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private localX: number;
  private localFloor = 0;
  private localColorIndex = 0;
  private elevatorButtonCallback?: (shaft: "A" | "B") => void;

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

      // Gray hallway strip
      const rect = this.add.rectangle(
        (bounds.minX + bounds.maxX) / 2,
        bounds.y,
        width,
        height,
        0x888888,
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

          // Door line (vertical line at room center x, spanning hallway height)
          const doorX = (roomRect.xMin + roomRect.xMax) / 2;
          const doorLine = this.add.line(
            0, 0,
            doorX, roomRect.y - 20,
            doorX, roomRect.y + 20,
            0x444444,
          );
          doorLine.setLineWidth(2);
          this.roomDoorLines.push(doorLine);
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
        0x448844,
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
        0x448844,
      );
      btnB.setInteractive({ useHandCursor: true });
      btnB.on("pointerdown", () => this.emitElevatorCall("B"));
      this.elevatorCallButtons.push(btnB);
    }
  }

  private emitElevatorCall(shaft: "A" | "B"): void {
    if (this.elevatorButtonCallback) {
      this.elevatorButtonCallback(shaft);
    }
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
    }
  }

  private spawnLocalAvatar(): void {
    const localColor = parseHexColor(
      AVATAR_COLORS[this.localColorIndex % AVATAR_COLORS.length],
    );
    const bounds = getHallBounds(this.localFloor);
    this.localRect = this.add.rectangle(this.localX, bounds.y, 16, 16, localColor);
    // No body ever — plain GameObject, x/y set directly
  }

  override update(_time: number, delta: number): void {
    const dtSec = Math.min(delta, 100) / 1000;
    const dir = this.getInputDir();
    this.localX = step(this.localX, dir, dtSec, this.localFloor);
    if (this.localRect) {
      this.localRect.x = this.localX;
      // y only changes via setFloor() teleport
      const bounds = getHallBounds(this.localFloor);
      this.localRect.y = bounds.y;
    }
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

  addRemote(id: string, colorIndex: number, floor = 0): void {
    if (this.remotes.has(id)) return;
    const color = parseHexColor(
      AVATAR_COLORS[colorIndex % AVATAR_COLORS.length],
    );
    const bounds = getHallBounds(floor);
    const x = (bounds.minX + bounds.maxX) / 2;
    const rect = this.add.rectangle(x, bounds.y, 16, 16, color);
    this.remotes.set(id, rect);
  }

  setRemoteX(id: string, x: number): void {
    const r = this.remotes.get(id);
    if (r) {
      r.x = x;
      // y stays at current floor's hallway y (floor tracked separately if needed)
    }
  }

  setRemoteFloor(id: string, floor: number): void {
    const r = this.remotes.get(id);
    if (r) {
      const bounds = getHallBounds(floor);
      r.y = bounds.y;
    }
  }

  removeRemote(id: string): void {
    const r = this.remotes.get(id);
    if (r) {
      r.destroy();
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
    this.localFloor = floor;
    const bounds = getHallBounds(floor);
    this.localX = bounds.minX + (bounds.maxX - bounds.minX) / 2; // center of hallway
    if (this.localRect) {
      this.localRect.x = this.localX;
      this.localRect.y = bounds.y;
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

  /** For tests: allow setting local color before create */
  setLocalColorIndex(idx: number): void {
    this.localColorIndex = idx;
    if (this.localRect) {
      this.localRect.fillColor = parseHexColor(
        AVATAR_COLORS[idx % AVATAR_COLORS.length],
      );
    }
  }
}
