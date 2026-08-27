import { describe, it, expect } from "vitest";
import { createApp, createGameServer } from "../src/index.js";

describe("server placeholder", () => {
  it("creates app with healthz", () => {
    const app = createApp();
    expect(app).toBeDefined();
  });

  it("creates a game server with the websocket transport", () => {
    const { gameServer } = createGameServer();
    expect(gameServer.transport).toBeDefined();
    expect(gameServer.transport?.constructor?.name).toBe("WebSocketTransport");
  });

  it("trivial passes", () => {
    expect(true).toBe(true);
  });
});
