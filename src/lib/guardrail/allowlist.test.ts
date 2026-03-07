import { describe, expect, test } from "bun:test";
import {
  isAllowlistedClaim,
  GENERAL_PROGRAMMING_ALLOWLIST,
} from "./allowlist.ts";

describe("GENERAL_PROGRAMMING_ALLOWLIST", () => {
  test("has expected categories", () => {
    expect(GENERAL_PROGRAMMING_ALLOWLIST).toHaveProperty("nullSafety");
    expect(GENERAL_PROGRAMMING_ALLOWLIST).toHaveProperty("injection");
    expect(GENERAL_PROGRAMMING_ALLOWLIST).toHaveProperty("concurrency");
    expect(GENERAL_PROGRAMMING_ALLOWLIST).toHaveProperty("resources");
    expect(GENERAL_PROGRAMMING_ALLOWLIST).toHaveProperty("bounds");
    expect(GENERAL_PROGRAMMING_ALLOWLIST).toHaveProperty("errorHandling");
    expect(GENERAL_PROGRAMMING_ALLOWLIST).toHaveProperty("typing");
    expect(GENERAL_PROGRAMMING_ALLOWLIST).toHaveProperty("codeSmells");
  });

  test("each category is a non-empty array of strings", () => {
    for (const [, phrases] of Object.entries(GENERAL_PROGRAMMING_ALLOWLIST)) {
      expect(Array.isArray(phrases)).toBe(true);
      expect(phrases.length).toBeGreaterThan(0);
      for (const phrase of phrases) {
        expect(typeof phrase).toBe("string");
      }
    }
  });
});

describe("isAllowlistedClaim", () => {
  test("null pointer dereference is allowlisted", () => {
    expect(isAllowlistedClaim("This could cause a null pointer dereference")).toBe(true);
  });

  test("version reference is NOT allowlisted", () => {
    expect(isAllowlistedClaim("This method was introduced in v3.2.1")).toBe(false);
  });

  test("error handling recommendation is allowlisted", () => {
    expect(isAllowlistedClaim("Consider adding error handling for uncaught exceptions")).toBe(true);
  });

  test("race condition warning is allowlisted", () => {
    expect(isAllowlistedClaim("This could cause a race condition")).toBe(true);
  });

  test("SQL injection warning is allowlisted", () => {
    expect(isAllowlistedClaim("This input is vulnerable to SQL injection")).toBe(true);
  });

  test("memory leak warning is allowlisted", () => {
    expect(isAllowlistedClaim("This could lead to a memory leak")).toBe(true);
  });

  test("case insensitive matching", () => {
    expect(isAllowlistedClaim("THIS COULD CAUSE A NULL POINTER DEREFERENCE")).toBe(true);
  });

  test("empty string is not allowlisted", () => {
    expect(isAllowlistedClaim("")).toBe(false);
  });

  test("specific external knowledge is not allowlisted", () => {
    expect(isAllowlistedClaim("This API was deprecated in React 18")).toBe(false);
  });
});
