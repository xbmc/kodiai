import { describe, expect, test } from "bun:test";
import {
  AUTO_PROFILE_THRESHOLDS,
  resolveReviewProfile,
} from "./auto-profile.ts";

describe("resolveReviewProfile", () => {
  test("uses strict for 100 changed lines", () => {
    const result = resolveReviewProfile({
      keywordProfileOverride: null,
      manualProfile: null,
      linesChanged: 100,
    });

    expect(result).toEqual({
      selectedProfile: "strict",
      source: "auto",
      autoBand: "small",
      linesChanged: 100,
    });
  });

  test("uses balanced for 101 changed lines", () => {
    const result = resolveReviewProfile({
      keywordProfileOverride: null,
      manualProfile: null,
      linesChanged: 101,
    });

    expect(result).toEqual({
      selectedProfile: "balanced",
      source: "auto",
      autoBand: "medium",
      linesChanged: 101,
    });
  });

  test("uses balanced for 500 changed lines", () => {
    const result = resolveReviewProfile({
      keywordProfileOverride: null,
      manualProfile: null,
      linesChanged: 500,
    });

    expect(result).toEqual({
      selectedProfile: "balanced",
      source: "auto",
      autoBand: "medium",
      linesChanged: 500,
    });
  });

  test("uses minimal for 501 changed lines", () => {
    const result = resolveReviewProfile({
      keywordProfileOverride: null,
      manualProfile: null,
      linesChanged: 501,
    });

    expect(result).toEqual({
      selectedProfile: "minimal",
      source: "auto",
      autoBand: "large",
      linesChanged: 501,
    });
  });

  test("manual profile overrides auto profile", () => {
    const result = resolveReviewProfile({
      keywordProfileOverride: null,
      manualProfile: "minimal",
      linesChanged: 40,
    });

    expect(result).toEqual({
      selectedProfile: "minimal",
      source: "manual",
      autoBand: null,
      linesChanged: 40,
    });
  });

  test("keyword profile overrides manual profile and auto profile", () => {
    const result = resolveReviewProfile({
      keywordProfileOverride: "strict",
      manualProfile: "minimal",
      linesChanged: 900,
    });

    expect(result).toEqual({
      selectedProfile: "strict",
      source: "keyword",
      autoBand: null,
      linesChanged: 900,
    });
  });

  test("exports expected threshold constants", () => {
    expect(AUTO_PROFILE_THRESHOLDS).toEqual({
      strictMax: 100,
      balancedMax: 500,
    });
  });
});
