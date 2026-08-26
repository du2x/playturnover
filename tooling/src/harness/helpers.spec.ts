import { describe, it, expect, afterEach } from "vitest";
import { createRoomAndJoin, disconnect } from "./helpers.js";
import type { HarnessClient } from "./clients.js";

describe("harness helpers", () => {
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

  it("spawns 4 clients and verifies roster contains 4 names", async () => {
    result = await createRoomAndJoin(4, ["A", "B", "C", "D"]);
    expect(result.clients).toHaveLength(4);
    expect(result.roomId).toBeTruthy();
    expect(result.url).toBeTruthy();

    const names = new Set<string>();
    const host = result.clients[0]!;
    const state = (host.room as unknown as { state: { players: Map<string, { name: string }> } }).state;
    const raw = state.players as unknown as { forEach: (cb: (v: { name: string }) => void) => void };
    if (raw && typeof raw.forEach === "function") {
      raw.forEach((p) => names.add(p.name));
    } else {
      for (const v of Object.values(state.players as unknown as Record<string, { name: string }>)) {
        names.add(v.name);
      }
    }
    expect(names.size).toBe(4);
    expect(names.has("A")).toBe(true);
    expect(names.has("B")).toBe(true);
    expect(names.has("C")).toBe(true);
    expect(names.has("D")).toBe(true);
  }, 20000);
});
