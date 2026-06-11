import { describe, expect, test } from "bun:test";
import { dedupeInflight } from "./inflight-dedupe.ts";

describe("dedupeInflight", () => {
  test("shares concurrent loads for the same key", async () => {
    const inflight = new Map<string, Promise<string>>();
    let loads = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = dedupeInflight(inflight, "key", async () => {
      loads++;
      await gate;
      return "value";
    });
    const second = dedupeInflight(inflight, "key", async () => {
      loads++;
      return "other";
    });

    release();
    await expect(Promise.all([first, second])).resolves.toEqual(["value", "value"]);
    expect(loads).toBe(1);
    expect(inflight.has("key")).toBe(false);
  });

  test("clears failed loads so later calls can retry", async () => {
    const inflight = new Map<string, Promise<string>>();

    await expect(dedupeInflight(inflight, "key", async () => {
      throw new Error("failed");
    })).rejects.toThrow("failed");

    await expect(dedupeInflight(inflight, "key", async () => "recovered")).resolves.toBe("recovered");
  });
});
