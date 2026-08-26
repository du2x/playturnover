import { describe, it, expect } from "vitest";
import { TOOLING_PLACEHOLDER, placeholder } from "../src/index.js";

describe("tooling placeholder", () => {
  it("exports placeholder", () => {
    expect(TOOLING_PLACEHOLDER).toBe("tooling-placeholder");
    expect(placeholder()).toBe("tooling-placeholder");
  });
});
