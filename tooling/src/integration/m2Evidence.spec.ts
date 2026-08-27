import { afterEach, describe, expect, it } from "vitest";
import {
  createRoomAndJoin,
  disconnect,
  getElevatorCar,
  getRoomState,
  startRound,
  waitForPhase,
} from "../harness/helpers.js";
import type { HarnessClient } from "../harness/clients.js";

describe("m2 evidence contracts", () => {
  let result: {
    clients: HarnessClient[];
    roomId: string;
    url: string;
    close: () => Promise<void>;
  } | null = null;

  afterEach(async () => {
    if (!result) return;
    for (const current of result.clients) disconnect(current);
    await result.close();
    result = null;
  });

  it("replicates permanent-card, freshness, coverage, and both elevator panel state", async () => {
    result = await createRoomAndJoin(4, ["A", "B", "C", "D"]);
    await startRound(result.clients[0]!);
    await waitForPhase(result.clients, "playing");

    for (const current of result.clients) {
      const room = getRoomState(current, "1-0") as unknown as {
        doorCard?: { present: boolean; text: string };
        freshness?: string | null;
        trashedAtTime?: number;
      } | null;
      expect(room?.doorCard).toEqual({ present: false, text: "" });
      expect(room?.freshness ?? null).toBeNull();
      expect(room?.trashedAtTime).toBe(0);
      const state = (
        current.room as unknown as { state: { coveragePercent?: number } }
      ).state;
      expect(state.coveragePercent).toBe(0);
      expect(getElevatorCar(current, "A")?.floor).toBe(0);
      expect(getElevatorCar(current, "B")?.floor).toBe(0);
    }
  }, 20000);
});
