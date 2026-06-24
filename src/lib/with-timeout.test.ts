import { describe, test, expect } from "bun:test";
import { withTimeout } from "./with-timeout.ts";

describe("withTimeout", () => {
  test("returns the value when work wins the race", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1_000);
    expect(result).toEqual({ timedOut: false, value: "ok" });
  });

  test("reports a timeout when work is too slow", async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 1_000));
    const result = await withTimeout(slow, 5);
    expect(result).toEqual({ timedOut: true });
  });

  test("swallows a late rejection from the losing work", async () => {
    // A handler that rejects after we have already timed out must not surface as
    // an unhandledRejection. The test passes if no unhandled rejection is thrown.
    const rejectsLate = new Promise<string>((_resolve, reject) =>
      setTimeout(() => reject(new Error("too late")), 5),
    );
    const result = await withTimeout(rejectsLate, 1);
    expect(result).toEqual({ timedOut: true });
    // Give the losing promise time to reject so a missing catch would surface.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
