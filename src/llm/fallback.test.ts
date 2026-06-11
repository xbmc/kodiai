import { describe, expect, test } from "bun:test";
import { isFallbackTrigger, getFallbackReason } from "./fallback.ts";

describe("isFallbackTrigger", () => {
  test("treats AbortSignal.timeout()'s TimeoutError as a fallback trigger", () => {
    // AbortSignal.timeout aborts with a DOMException named "TimeoutError" whose
    // message ("The operation timed out.") does NOT contain "timeout" — the
    // name match is load-bearing.
    const err = new DOMException("The operation timed out.", "TimeoutError");
    expect(isFallbackTrigger(err)).toBeTrue();
    expect(getFallbackReason(err)).toBe("timeout");
  });

  test("treats AbortError and message timeouts as triggers", () => {
    expect(isFallbackTrigger(new DOMException("aborted", "AbortError"))).toBeTrue();
    expect(isFallbackTrigger(new Error("connection timeout"))).toBeTrue();
  });

  test("rate limits and 5xx trigger, plain errors do not", () => {
    const rateLimited = Object.assign(new Error("rate limited"), { status: 429 });
    const serverError = Object.assign(new Error("boom"), { statusCode: 503 });
    expect(isFallbackTrigger(rateLimited)).toBeTrue();
    expect(isFallbackTrigger(serverError)).toBeTrue();
    expect(isFallbackTrigger(new Error("validation failed"))).toBeFalse();
    expect(isFallbackTrigger("not an error")).toBeFalse();
  });
});
