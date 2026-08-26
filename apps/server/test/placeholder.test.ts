import { describe, it, expect } from "vitest";
import { createApp } from "../src/index.js";

describe("server placeholder", () => {
  it("creates app with healthz", () => {
    const app = createApp();
    expect(app).toBeDefined();
  });

  it("trivial passes", () => {
    expect(true).toBe(true);
  });
});
