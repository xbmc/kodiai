import { describe, expect, test } from "bun:test";
import { isFeedbackSuppressionProtected } from "./safety-guard.ts";
import type { FindingSeverity, FindingCategory } from "../knowledge/types.ts";

describe("isFeedbackSuppressionProtected", () => {
  test("protects critical security", () => {
    expect(isFeedbackSuppressionProtected({ severity: "critical", category: "security" })).toBe(true);
  });

  test("protects critical style (all critical protected)", () => {
    expect(isFeedbackSuppressionProtected({ severity: "critical", category: "style" })).toBe(true);
  });

  test("protects critical correctness", () => {
    expect(isFeedbackSuppressionProtected({ severity: "critical", category: "correctness" })).toBe(true);
  });

  test("protects critical performance", () => {
    expect(isFeedbackSuppressionProtected({ severity: "critical", category: "performance" })).toBe(true);
  });

  test("protects critical documentation", () => {
    expect(isFeedbackSuppressionProtected({ severity: "critical", category: "documentation" })).toBe(true);
  });

  test("protects major security", () => {
    expect(isFeedbackSuppressionProtected({ severity: "major", category: "security" })).toBe(true);
  });

  test("protects major correctness", () => {
    expect(isFeedbackSuppressionProtected({ severity: "major", category: "correctness" })).toBe(true);
  });

  test("does NOT protect major style", () => {
    expect(isFeedbackSuppressionProtected({ severity: "major", category: "style" })).toBe(false);
  });

  test("does NOT protect major performance", () => {
    expect(isFeedbackSuppressionProtected({ severity: "major", category: "performance" })).toBe(false);
  });

  test("does NOT protect major documentation", () => {
    expect(isFeedbackSuppressionProtected({ severity: "major", category: "documentation" })).toBe(false);
  });

  test("does NOT protect medium security", () => {
    expect(isFeedbackSuppressionProtected({ severity: "medium", category: "security" })).toBe(false);
  });

  test("does NOT protect minor correctness", () => {
    expect(isFeedbackSuppressionProtected({ severity: "minor", category: "correctness" })).toBe(false);
  });

  test("does NOT protect medium style", () => {
    expect(isFeedbackSuppressionProtected({ severity: "medium", category: "style" })).toBe(false);
  });
});
