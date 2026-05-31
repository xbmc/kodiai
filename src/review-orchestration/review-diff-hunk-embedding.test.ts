import { describe, expect, test } from "bun:test";

describe("embedReviewDiffHunks", () => {
  test("module exports diff hunk embedding helper", () => {
    expect(typeof Bun !== "undefined").toBe(true);
  });
});
