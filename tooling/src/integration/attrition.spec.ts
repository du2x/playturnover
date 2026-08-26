import { describe, it, expect, afterEach } from "vitest";
import {
  createRoomAndJoin,
  startRound,
  waitForPhase,
  collectRoles,
  disconnect,
} from "../harness/helpers.js";
import type { HarnessClient } from "../harness/clients.js";

describe("m1 attrition win (V-12)", () => {
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

  it("two staff disconnects leave 1 staff + saboteur -> immediate saboteur win", async () => {
    result = await createRoomAndJoin(4, ["A", "B", "C", "D"]);
    const clients = result.clients;

    const rolesPromise = collectRoles(clients);
    await startRound(clients[0]!);
    await waitForPhase(clients, "playing", 5000);
    const roles = await rolesPromise;

    // disconnect exactly two staff players, keeping the saboteur connected
    const staffClients = clients.filter((cl) => roles.get(cl.sessionId!) === "staff");
    expect(staffClients).toHaveLength(3);
    disconnect(staffClients[0]!);
    disconnect(staffClients[1]!);

    // only saboteur + 1 staff remain -> attrition triggers before the timer
    const remaining = clients.filter((cl) => cl.room !== null);
    expect(remaining).toHaveLength(2);
    await waitForPhase(remaining, "results", 5000);

    const state = (remaining[0]!.room as unknown as { state: { winner: string | null; phase: string } }).state;
    expect(state.phase).toBe("results");
    expect(state.winner).toBe("saboteur");
  });
});
