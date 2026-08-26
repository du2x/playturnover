import { describe, it, expect } from "vitest";
import { boot } from "../src/main.js";

describe("client placeholder", () => {
  it("boot returns boot", () => {
    expect(boot()).toBe("boot");
  });

  it("trivial passes", () => {
    expect(true).toBe(true);
  });
});
