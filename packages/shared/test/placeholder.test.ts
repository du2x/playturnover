import { describe, it, expect } from "vitest";
import { PLACEHOLDER, placeholder } from "../src/index.js";

describe("shared placeholder", () => {
  it("exports placeholder", () => {
    expect(PLACEHOLDER).toBe("shared-placeholder");
    expect(placeholder()).toBe("shared-placeholder");
  });
});
