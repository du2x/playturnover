import { describe, it, expect, afterEach } from "vitest";
import { ELEVATOR_A_X, ROOM_COUNT } from "@grandhotel/shared";
import {
  createRoomAndJoin,
  startRound,
  collectRoles,
  waitForPhase,
  waitForElevatorState,
  waitForPlayerFloor,
  waitForRoomState,
  moveToX,
  startChannel,
  cancelChannel,
  sendMove,
  callElevator,
  rideElevator,
  sendAccusation,
  getPlayerState,
  getXForPlayer,
  waitForPlayerFired,
  getServerRoom,
  getRecapEvents,
  disconnect,
} from "../harness/helpers.js";
import type { HarnessClient } from "../harness/clients.js";

describe("spectator mode and observability", () => {
  let result: {
    clients: HarnessClient[];
    roomId: string;
    url: string;
    close: () => Promise<void>;
  } | null = null;

  afterEach(async () => {
    if (result) {
      for (const c of result.clients) {
        try {
          disconnect(c);
        } catch {}
      }
      await result.close();
      result = null;
    }
  });

  it("spectator observability: fired player becomes spectator, cannot alter rule state, and retains full visibility", async () => {
    result = await createRoomAndJoin(4, ["P1", "P2", "P3", "P4"], {
      shiftLengthSOverride: 60,
    });
    const clients = result.clients;
    const roomId = result.roomId;

    const serverRoom = getServerRoom(roomId);
    expect(serverRoom).toBeDefined();

    const rolesPromise = collectRoles(clients);
    await startRound(clients[0]!);
    await waitForPhase(clients, "playing", 5000);
    const roles = await rolesPromise;

    const saboteur = clients.find((c) => roles.get(c.sessionId!) === "saboteur");
    const staffMembers = clients.filter((c) => roles.get(c.sessionId!) === "staff");
    expect(saboteur).toBeDefined();
    expect(staffMembers.length).toBe(3);

    const staff1 = staffMembers[0]!; // will become spectator
    const staff2 = staffMembers[1]!; // innocent target
    const staff3 = staffMembers[2]!; // innocent bystander in lobby
    const saboteurSessionId = saboteur!.sessionId!;

    // 1. staff1 and staff2 ride elevator A to floor 1
    await moveToX(staff1, ELEVATOR_A_X, { timeoutMs: 8000 });
    await moveToX(staff2, ELEVATOR_A_X, { timeoutMs: 8000 });
    callElevator(staff1, "A");
    await waitForElevatorState(staff1, "A", "boarding", 6000);
    rideElevator(staff1, "A", 1);
    await new Promise<void>((r) => setTimeout(r, 80));
    rideElevator(staff2, "A", 1);
    await waitForPlayerFloor(staff1, staff1.sessionId!, 1, 6000);
    await waitForPlayerFloor(staff2, staff2.sessionId!, 1, 6000);

    // 2. staff1 wrongly accuses staff2 on floor 1 -> staff1 is fired and becomes spectator
    await moveToX(staff1, 140, { timeoutMs: 8000 });
    await moveToX(staff2, 140, { timeoutMs: 8000 });
    sendAccusation(staff1, staff2.sessionId!);
    await waitForPlayerFired(staff2, staff1.sessionId!, 6000);

    // 3. Verify spectator state replicated across clients
    for (const c of clients) {
      const p1State = getPlayerState(c, staff1.sessionId!);
      expect(p1State).not.toBeNull();
      expect(p1State?.fired).toBe(true);
      expect(p1State?.spectator).toBe(true);

      const p2State = getPlayerState(c, staff2.sessionId!);
      expect(p2State?.fired).toBe(false);
      expect(p2State?.spectator).toBe(false);
    }

    const initialX = getXForPlayer(staff1, staff1.sessionId!) ?? 140;

    // 4. Action rejection: Movement is rejected for spectator
    sendMove(staff1, { dx: 150, dy: 0, seq: 1 });
    await new Promise<void>((r) => setTimeout(r, 200));
    const postMoveX = getXForPlayer(staff1, staff1.sessionId!);
    expect(postMoveX).toBe(initialX);

    // 5. Action rejection: Channel start (prep) is rejected for spectator
    startChannel(staff1, "prep", "1-0");
    await new Promise<void>((r) => setTimeout(r, 200));
    expect(getPlayerState(staff1, staff1.sessionId!)?.activeChannel).toBeNull();
    expect(serverRoom!.getActiveChannel(staff1.sessionId!)).toBeNull();

    // 6. Action rejection: Channel cancel is rejected / no-op
    cancelChannel(staff1);
    expect(getPlayerState(staff1, staff1.sessionId!)?.activeChannel).toBeNull();

    // 7. Action rejection: Accusation from spectator is rejected
    const recapCountBefore = getRecapEvents(staff1).length;
    sendAccusation(staff1, saboteurSessionId);
    await new Promise<void>((r) => setTimeout(r, 200));
    expect(getRecapEvents(staff1).length).toBe(recapCountBefore);
    expect(getPlayerState(staff1, saboteurSessionId)?.fired).toBe(false);

    // 8. Full-building visibility (R-5, V-4): spectator sees all 24 rooms
    const spectatorVisible = serverRoom!.getVisibleRooms(staff1.sessionId!);
    expect(Object.keys(spectatorVisible).length).toBe(ROOM_COUNT);

    // Active bystander in lobby (floor 0) sees 0 rooms
    const lobbyBystanderVisible = serverRoom!.getVisibleRooms(staff3.sessionId!);
    expect(Object.keys(lobbyBystanderVisible).length).toBe(0);

    // 9. Round proceeds and spectator receives full end-of-round state
    // Saboteur preps and then unpreps room 1-2
    await moveToX(saboteur!, ELEVATOR_A_X, { timeoutMs: 8000 });
    callElevator(saboteur!, "A");
    await waitForElevatorState(saboteur!, "A", "boarding", 6000);
    rideElevator(saboteur!, "A", 1);
    await waitForPlayerFloor(saboteur!, saboteurSessionId, 1, 6000);

    await moveToX(saboteur!, 332, { timeoutMs: 8000 }); // room 1-2
    startChannel(saboteur!, "prep", "1-2");
    await waitForRoomState(saboteur!, "1-2", "prepped", 8000);

    startChannel(saboteur!, "unprep", "1-2");
    await waitForRoomState(saboteur!, "1-2", "trashed", 8000);

    // staff2 accuses saboteur
    await moveToX(staff2, 332, { timeoutMs: 8000 });
    sendAccusation(staff2, saboteurSessionId);

    // Verify spectator client receives results phase, winner, and reveal
    await waitForPhase(clients, "results", 10000);

    const spectatorRoomState = (
      staff1.room as unknown as {
        state: {
          winner: string | null;
          phase: string;
          traitorReveal: { sessionId: string; name: string } | null;
        };
      }
    ).state;

    expect(spectatorRoomState.phase).toBe("results");
    expect(spectatorRoomState.winner).toBe("staff");
    expect(spectatorRoomState.traitorReveal?.sessionId).toBe(saboteurSessionId);
  }, 45000);
});
