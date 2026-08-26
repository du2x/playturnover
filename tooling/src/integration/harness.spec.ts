import { describe, it, expect, afterEach } from "vitest";
import { createRoomAndJoin, startRound, collectRoles, waitForPhase, disconnect } from "../harness/helpers.js";
import type { HarnessClient } from "../harness/clients.js";

describe("harness helpers integration (m1)", () => {
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

  it("spawns 4 clients, starts round, and collects exactly one saboteur", async () => {
    result = await createRoomAndJoin(4, ["A", "B", "C", "D"]);
    expect(result.clients).toHaveLength(4);

    const rolesPromise = collectRoles(result.clients);
    await startRound(result.clients[0]!);
    await waitForPhase(result.clients, "playing", 5000);

    const roles = await rolesPromise;
    expect(roles.size).toBe(4);
    const roleValues = [...roles.values()];
    expect(roleValues.filter((r) => r === "saboteur")).toHaveLength(1);
    expect(roleValues.filter((r) => r === "staff")).toHaveLength(3);
  }, 20000);

});
