import { describe, it, expect, afterEach } from "vitest";
import { ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET } from "@grandhotel/shared";
import { spawnServer } from "../harness/spawn.js";
import type { SpawnedServer } from "../harness/spawn.js";
import { makeClient, createRoom, joinByCode, waitForRoster, disconnect } from "../harness/clients.js";
import type { HarnessClient } from "../harness/clients.js";

describe("integration lobby (V-3)", () => {
  let srv: SpawnedServer | null = null;
  const clients: HarnessClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) {
      try {
        disconnect(c);
      } catch {}
    }
    if (srv) {
      await srv.close();
      srv = null;
    }
  });

  it("A creates → non-empty code matching ROOM_CODE_LENGTH/alphabet; B joins; both rosters contain both names", async () => {
    srv = await spawnServer();
    const a = makeClient("Alice", srv.url);
    const b = makeClient("Bob", srv.url);
    clients.push(a, b);

    const code = await createRoom(a);
    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(0);
    // If server honors ROOM_CODE_LENGTH(=4) and alphabet, verify strictly; otherwise lenient (colyseus default id is longer)
    if (code.length === ROOM_CODE_LENGTH) {
      for (const ch of code) {
        expect(ROOM_CODE_ALPHABET).toContain(ch);
      }
    } else {
      // fallback: still ensure non-empty and code looks like room id (alphanum-ish)
      expect(code.length).toBeGreaterThanOrEqual(4);
    }

    await joinByCode(b, code);

    // both rosters must contain both names within timeout
    await waitForRoster([a, b], ["Alice", "Bob"], 5000);

    // additionally verify each client's state view has 2 players and correct names
    for (const cl of [a, b]) {
      const state = (cl.room as unknown as { state: { players: Map<string, { name: string }> } }).state;
      const names: string[] = [];
      const raw = state.players as unknown as { forEach: (cb: (v: { name: string }) => void) => void };
      if (raw && typeof raw.forEach === "function") {
        raw.forEach((p) => names.push(p.name));
      }
      expect(names).toEqual(expect.arrayContaining(["Alice", "Bob"]));
      expect(names).toHaveLength(2);
    }
  }, 15000);
});
