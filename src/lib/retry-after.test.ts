import { describe, expect, test } from "bun:test";
import { capRetryDelayMs, parseRetryAfterDelayMs } from "./retry-after.ts";

describe("parseRetryAfterDelayMs", () => {
  test("parses finite non-negative seconds", () => {
    expect(parseRetryAfterDelayMs("0")).toBe(0);
    expect(parseRetryAfterDelayMs("2")).toBe(2000);
    expect(parseRetryAfterDelayMs(1.5)).toBe(1500);
  });

  test("rejects malformed retry-after values", () => {
    expect(parseRetryAfterDelayMs("abc")).toBeNull();
    expect(parseRetryAfterDelayMs("1abc")).toBeNull();
    expect(parseRetryAfterDelayMs("-1")).toBeNull();
    expect(parseRetryAfterDelayMs("")).toBeNull();
    expect(parseRetryAfterDelayMs(undefined)).toBeNull();
  });

  test("caps parsed retry-after delays to the caller budget", () => {
    expect(capRetryDelayMs(parseRetryAfterDelayMs("999"), 30_000)).toBe(30_000);
    expect(capRetryDelayMs(parseRetryAfterDelayMs("2"), 30_000)).toBe(2_000);
    expect(capRetryDelayMs(null, 30_000)).toBeNull();
  });
});
