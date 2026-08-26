import { describe, it, expect, afterEach } from "vitest";
import { createRoomAndJoin, startRound, waitForPhase, collectRoles, disconnect } from "../harness/helpers.js";
import type { HarnessClient } from "../harness/clients.js";

describe("m1 roles secret (V-5)", () => {
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

  it("exactly one saboteur; each client sees only its own role; no otherRole broadcast", async () => {
    result = await createRoomAndJoin(4, ["A", "B", "C", "D"]);
    const clients = result.clients;

    const rolesPromise = collectRoles(clients);
    await startRound(clients[0]!);
    await waitForPhase(clients, "playing", 5000);
    const roles = await rolesPromise;

    // V-5: exactly one secret saboteur, rest staff
    expect(roles.size).toBe(4);
    const saboteurs = [...roles.entries()].filter(([, role]) => role === "saboteur");
    expect(saboteurs).toHaveLength(1);
    const saboteurSessionId = saboteurs[0]![0];

    // V-5: saboteur's own client saw 'saboteur'; every other client saw 'staff'
    for (const cl of clients) {
      const role = roles.get(cl.sessionId!);
      expect(role).toBe(cl.sessionId === saboteurSessionId ? "saboteur" : "staff");
    }

    // V-5: broadcast projection never carries another player's role field
    for (const cl of clients) {
      const state = (cl.room as unknown as { state: { players: Map<string, { role?: unknown }> } }).state;
      const raw = state.players as unknown as { forEach: (cb: (p: { role?: unknown }) => void) => void };
      raw.forEach((p) => {
        expect((p as { role?: unknown }).role).toBeUndefined();
      });
    }
  });
});
