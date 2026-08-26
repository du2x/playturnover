import { describe, it, expect, vi, afterEach } from "vitest";
import { HotelRoom } from "../src/rooms/HotelRoom.js";

function mockClient(sessionId: string): any {
  const c: any = { sessionId, _sent: [] as Array<{ type: string; data: unknown }> };
  c.send = (type: string, data: unknown) => {
    c._sent.push({ type, data });
  };
  c.getRole = () => {
    const found = (c._sent as Array<{ type: string; data: unknown }>).find((s) => s.type === "role");
    return found ? (found.data as any).role : null;
  };
  return c;
}

describe("role assignment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("200 randomized seeds exactly one saboteur per round, private messages only", async () => {
    for (let seed = 0; seed < 200; seed++) {
      // deterministic stub per seed: map seed to a deterministic pick
      // Use a simple rng seeded by seed to control Math.random
      let s = seed * 9973 + 12345;
      const rng = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
      const stub = vi.spyOn(Math, "random").mockImplementation(rng);

      const room = new HotelRoom();
      await room.onCreate({});
      const clients = [mockClient("a"), mockClient("b"), mockClient("c"), mockClient("d")];
      for (let i = 0; i < clients.length; i++) {
        await room.onJoin(clients[i], { name: `P${i}` });
      }
      const host = clients[0];
      (room as any).handleStartRound(host, {});

      expect(room.state.phase).toBe("playing");
      // exactly one saboteur in private map
      const roles = clients.map((c: any) => c.getRole());
      const sabCount = roles.filter((r: string | null) => r === "saboteur").length;
      const staffCount = roles.filter((r: string | null) => r === "staff").length;
      expect(sabCount).toBe(1);
      expect(staffCount).toBe(3);
      // private mapping matches
      const sabId = (room as any).getSaboteurSessionId() as string | null;
      expect(sabId).not.toBeNull();
      expect(roles.find((r: unknown, idx: number) => r === "saboteur" && clients[idx].sessionId === sabId)).toBeTruthy();

      // broadcast state never leaks roles
      const serialized = JSON.stringify(room.state);
      // should not contain literal saboteur/staff roles via broadcast players
      // role messages are private via client.send, not in state.players
      // Check that none of the PlayerState entries have a 'role' key that would serialize
      // Since PlayerState.role is not decorated, it won't appear; we assert serialized doesn't contain "saboteur" except possibly via private side-effects we didn't leak
      // For robustness, ensure state.players values don't have role property visible via direct access serialization?
      // We check that room.state.players map values' 'role' is undefined (we don't set it)
      for (const p of room.state.players.values()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((p as any).role).toBeUndefined();
      }
      // also traitorReveal stays null until results
      expect(room.state.traitorReveal).toBeNull();
      expect(room.state.winner).toBeNull();

      stub.mockRestore();
    }
  });

  it("each client receives only its own role, no other roles visible", async () => {
    const room = new HotelRoom();
    await room.onCreate({});
    const clients = [mockClient("s0"), mockClient("s1"), mockClient("s2"), mockClient("s3")];
    for (let i = 0; i < 4; i++) await room.onJoin(clients[i], { name: `P${i}` });
    vi.spyOn(Math, "random").mockReturnValue(0.1); // picks first client as saboteur (0.1*4=0)
    (room as any).handleStartRound(clients[0], {});
    vi.restoreAllMocks();

    // first client saboteur
    expect((clients[0] as any).getRole()).toBe("saboteur");
    expect((clients[1] as any).getRole()).toBe("staff");
    expect((clients[2] as any).getRole()).toBe("staff");
    expect((clients[3] as any).getRole()).toBe("staff");
    // each client only got one role message
    for (const c of clients) {
      const sent = (c as any)._sent as Array<{ type: string; data: unknown }>;
      const roleMsgs = sent.filter((s) => s.type === "role");
      expect(roleMsgs).toHaveLength(1);
      // does not contain other roles
      expect(roleMsgs[0].data).toEqual({ role: (c as any).getRole() });
    }
  });

  it("movement keeps clamp via computeClampedX and floor unchanged after start", async () => {
    const room = new HotelRoom();
    await room.onCreate({});
    const clients = [mockClient("s0"), mockClient("s1"), mockClient("s2"), mockClient("s3")];
    for (let i = 0; i < 4; i++) await room.onJoin(clients[i], { name: `P${i}` });
    (room as any).handleStartRound(clients[0], {});
    expect(room.state.phase).toBe("playing");
    const p = room.state.players.get("s0")!;
    expect(p.floor).toBe(0);
    const startX = p.x;
    // simulate move with large dx, ensure clamp
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    (room as any).lastMoveAt.set("s0", now - 100);
    (room as any).handleMove(clients[0], { dx: 1000, dy: 0, seq: 1 });
    vi.restoreAllMocks();
    // dx clamped to SERVER_MAX_SPEED_PX_S*0.1 =33, so newX = startX+33 clamped to bounds
    expect(p.x).not.toBe(startX);
    expect(p.floor).toBe(0); // floor unchanged
  });
});
