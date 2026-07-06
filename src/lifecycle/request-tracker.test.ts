import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { createRequestTracker } from "./request-tracker.ts";

describe("createRequestTracker", () => {
  test("waitForDrain rejects with a drain timeout while work is active", async () => {
    const tracker = createRequestTracker();
    const finish = tracker.trackJob();

    try {
      await expect(tracker.waitForDrain(1)).rejects.toThrow("Drain timeout after 1ms");
    } finally {
      finish();
    }
  });

  test("centralizes waitForDrain timeout handling in the shared timeout primitive", () => {
    const source = readFileSync(new URL("./request-tracker.ts", import.meta.url), "utf8");

    expect(source).toContain("rejectWithTimeout");
    expect(source).not.toContain("setTimeout(");
    expect(source).not.toContain("clearTimeout(");
  });
});
