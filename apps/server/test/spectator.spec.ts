import { describe, it, expect, vi, beforeEach } from "vitest";
import { getRoomRect, ELEVATOR_A_X, ELEVATOR_ARRIVE_MS } from "@grandhotel/shared";
import { HotelRoom } from "../src/rooms/HotelRoom.js";
import { VirtualClock } from "../src/time.js";

function mockClient(sessionId: string): any {
  const c: any = { sessionId, _sent: [] as Array<{ type: string; data: unknown }> };
  c.send = (type: string, data: unknown) => {
    c._sent.push({ type, data });
  };
  c.getSent = () => c._sent;
  return c;
}

async function setupGame(): Promise<{
  room: HotelRoom;
  clients: any[];
  clock: VirtualClock;
}> {
  const clock = new VirtualClock();
  const room = new HotelRoom(clock);
  await room.onCreate({});
  const clients = ["p0", "p1", "p2", "p3"].map(mockClient);
  for (let i = 0; i < clients.length; i++) {
    await room.onJoin(clients[i], { name: `Player_${i}` });
  }
  // Force p0 as saboteur
  vi.spyOn(Math, "random").mockReturnValue(0);
  (room as any).handleStartRound(clients[0], {});
  vi.restoreAllMocks();
  return { room, clients, clock };
}

function placePlayer(room: HotelRoom, sessionId: string, roomId: string): void {
  const rect = getRoomRect(roomId);
  const p = room.state.players.get(sessionId)!;
  p.floor = rect.floor;
  p.x = (rect.xMin + rect.xMax) / 2;
}

describe("spectator mode transition", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("spectator mode transition: fired player becomes spectator and cannot perform round actions", async () => {
    const { room, clients, clock } = await setupGame();
    const saboteur = clients[0]; // p0
    const accuser = clients[1]; // p1 (staff)
    const innocent = clients[2]; // p2 (staff)
    const bystander = clients[3]; // p3 (staff)

    // Place accuser and innocent near each other on floor 1
    placePlayer(room, accuser.sessionId, "1-1");
    placePlayer(room, innocent.sessionId, "1-1");

    // Accuser makes wrong accusation against innocent
    (room as any).handleAccusation(accuser, {
      targetSessionId: innocent.sessionId,
    });

    const firedAccuser = room.state.players.get(accuser.sessionId)!;
    expect(firedAccuser.fired).toBe(true);
    expect(firedAccuser.spectator).toBe(true);
    expect(room.state.phase).toBe("playing");

    const initialX = firedAccuser.x;
    const initialFloor = firedAccuser.floor;

    // 1. Movement is rejected
    (room as any).handleMove(accuser, { dx: 100, dy: 0, seq: 1 });
    expect(firedAccuser.x).toBe(initialX);

    // 2. Channel start is rejected
    const cleanRoomId = "1-1";
    (room as any).handleChannelStart(accuser, {
      type: "prep",
      roomId: cleanRoomId,
    });
    expect(firedAccuser.activeChannel).toBeNull();
    expect((room as any).getActiveChannel(accuser.sessionId)).toBeNull();

    // 3. Channel cancel is ignored
    (room as any).handleChannelCancel(accuser, {});
    expect(firedAccuser.activeChannel).toBeNull();

    // 4. Elevator call is rejected
    firedAccuser.x = ELEVATOR_A_X;
    (room as any).handleCallElevator(accuser, { shaft: "A" });
    const carA = room.state.elevators.get("A")!;
    expect(carA.state).toBe("idle");

    // 5. Elevator ride is rejected
    // Have active bystander call elevator A so it arrives and is boarding
    const bystanderPlayer = room.state.players.get(bystander.sessionId)!;
    bystanderPlayer.floor = 1;
    bystanderPlayer.x = ELEVATOR_A_X;
    (room as any).handleCallElevator(bystander, { shaft: "A" });
    expect(carA.state).toBe("arriving");
    await clock.advance(ELEVATOR_ARRIVE_MS);
    expect(carA.state).toBe("boarding");

    // Fired accuser tries to ride
    (room as any).handleRideElevator(accuser, { shaft: "A", destFloor: 2 });
    expect(carA.queue.includes(accuser.sessionId)).toBe(false);

    // 6. Accusation from spectator is rejected
    const initialRecapLength = room.state.recapEvents.length;
    (room as any).handleAccusation(accuser, {
      targetSessionId: saboteur.sessionId,
    });
    expect(room.state.recapEvents.length).toBe(initialRecapLength);
    expect(room.state.players.get(saboteur.sessionId)!.fired).toBe(false);

    // 7. Full-building visibility: spectator sees all room states
    const spectatorVisible = room.getVisibleRooms(accuser.sessionId);
    expect(Object.keys(spectatorVisible).length).toBe(24);

    // Active bystander outside rooms (e.g. in lobby floor 0) sees no rooms
    bystanderPlayer.floor = 0;
    bystanderPlayer.x = 480;
    const bystanderVisible = room.getVisibleRooms(bystander.sessionId);
    expect(Object.keys(bystanderVisible).length).toBe(0);
  });
});
