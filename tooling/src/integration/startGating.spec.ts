import { describe, it, expect, afterEach } from "vitest";
import { LOBBY_CENTER } from "@grandhotel/shared";
import {
  createRoomAndJoin,
  startRound,
  waitForPhase,
  waitForRoster,
  makeClient,
  joinByCode,
  getPlayerState,
  disconnect,
} from "../harness/helpers.js";
import type { HarnessClient } from "../harness/clients.js";

describe("m1 start gating (V-4)", () => {
  let result: { clients: HarnessClient[]; roomId: string; url: string; close: () => Promise<void> } | null = null;

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

  it("3 clients rejected with need-4-players; 4 clients start -> playing in lobby", async () => {
    result = await createRoomAndJoin(3, ["A", "B", "C"]);
    const host = result.clients[0]!;

    // with 3 joined, host startRound is rejected and the error surfaces
    const errPromise = new Promise<unknown>((resolve) => {
      const room = host.room as unknown as { onMessage: (t: string, cb: (d: unknown) => void) => void };
      room.onMessage("error", (d) => resolve(d));
    });
    host.room!.send("startRound", {});
    const err = await errPromise;
    expect((err as { reason?: string }).reason).toBe("need-4-players");

    // phase stays waiting
    const state0 = host.room as unknown as { state: { phase: string } };
    expect(state0.state.phase).toBe("waiting");

    // 4th client joins
    const d = makeClient("D", result.url);
    result.clients.push(d);
    await joinByCode(d, result.roomId);
    await waitForRoster(result.clients, ["A", "B", "C", "D"], 5000);

    // with 4 joined, startRound succeeds
    await startRound(host);
    await waitForPhase(result.clients, "playing", 5000);

    // all 4 spawn at lobby gather-up position (LOBBY_CENTER, floor 0)
    for (const cl of result.clients) {
      const p = getPlayerState(cl, cl.sessionId!);
      expect(p).not.toBeNull();
      expect(p!.x).toBe(LOBBY_CENTER.x);
      expect(p!.floor).toBe(0);
    }
  });
});
