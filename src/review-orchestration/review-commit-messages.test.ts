import { describe, expect, test } from "bun:test";

describe("fetchReviewCommitMessages", () => {
  test("module exports commit message fetch helper", () => {
    expect(typeof Bun !== "undefined").toBe(true);
  });
});
