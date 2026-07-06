import { describe, expect, test } from "bun:test";
import {
  buildReviewExecutionErrorFallbackBody,
  buildReviewHandlerFailureErrorBody,
  buildReviewRunErrorFallbackBody,
  buildReviewFailureFallbackBody,
  buildReviewTurnLimitFallbackBody,
} from "./review-fallback-body.ts";

describe("review fallback bodies", () => {
  test("formats turn-limit body with scheduled retry disclosure", () => {
    const body = buildReviewTurnLimitFallbackBody({ retryScheduled: true });

    expect(body).toContain("Kodiai ran out of steps while reviewing this PR");
    expect(body).toContain("A reduced-scope retry has been scheduled automatically.");
    expect(body).not.toContain("could not preserve enough structured evidence");
  });

  test("formats turn-limit body without retry disclosure when no retry was scheduled", () => {
    const body = buildReviewTurnLimitFallbackBody({ retryScheduled: false });

    expect(body).toContain("Kodiai could not preserve enough structured evidence");
    expect(body).toContain("failure diagnostics for operators");
  });

  test("formats generic review failure fallback body", () => {
    const body = buildReviewFailureFallbackBody();

    expect(body).toContain("Kodiai could not publish a trustworthy review result");
    expect(body).toContain("No code findings were published.");
    expect(body).toContain("Try a narrower review request if it repeats.");
  });

  test("formats top-level handler failure errors without leaking raw details", () => {
    const body = buildReviewHandlerFailureErrorBody(new Error("boom in /tmp/private-checkout"));

    expect(body).toContain("Kodiai could not complete the request");
    expect(body).toContain("failed before KodiAI could publish");
    expect(body).not.toContain("boom");
    expect(body).not.toContain("/tmp/private-checkout");
  });

  test("preserves generic detail for non-Error handler failures", () => {
    const body = buildReviewHandlerFailureErrorBody("string failure");

    expect(body).toContain("Kodiai could not complete the request");
    expect(body).toContain("failed before KodiAI could publish");
  });

  test("formats partial timeout review run errors with timeout budget details", () => {
    const body = buildReviewRunErrorFallbackBody({
      category: "timeout_partial",
      errorMessage: "raw timeout diagnostics",
      totalTimeoutSeconds: 900,
      complexityInfo: "high risk",
      timeoutEstimate: {
        remoteRuntimeBudgetSeconds: 720,
        infraOverheadBudgetSeconds: 180,
        totalTimeoutSeconds: 900,
      },
    });

    expect(body).toContain("Kodiai completed a partial review");
    expect(body).toContain("exceeded its execution time after KodiAI published partial output");
    expect(body).not.toContain("raw timeout diagnostics");
  });

  test("formats full timeout review run errors without timeout estimate", () => {
    const body = buildReviewRunErrorFallbackBody({
      category: "timeout",
      errorMessage: undefined,
      totalTimeoutSeconds: 600,
      complexityInfo: "unknown",
      timeoutEstimate: null,
    });

    expect(body).toContain("Kodiai timed out");
    expect(body).toContain("exceeded its execution time before KodiAI could publish");
    expect(body).not.toContain("Timed out after 600s");
  });

  test("formats non-timeout review run errors with generic fallback detail", () => {
    const body = buildReviewRunErrorFallbackBody({
      category: "internal_error",
      errorMessage: undefined,
      totalTimeoutSeconds: 600,
      complexityInfo: "unused",
      timeoutEstimate: null,
    });

    expect(body).toContain("Kodiai could not complete the request");
    expect(body).toContain("failed before KodiAI could publish");
  });

  test("selects turn-limit fallback body for exhausted turn budgets", () => {
    const body = buildReviewExecutionErrorFallbackBody({
      exhaustedTurnBudget: true,
      retryScheduled: true,
      category: "internal_error",
      errorMessage: "raw failure",
      totalTimeoutSeconds: 600,
      complexityInfo: "unused",
      timeoutEstimate: null,
    });

    expect(body).toContain("Kodiai ran out of steps while reviewing this PR");
    expect(body).toContain("A reduced-scope retry has been scheduled automatically.");
    expect(body).not.toContain("raw failure");
  });

  test("selects run-error fallback body for non-turn-budget errors", () => {
    const body = buildReviewExecutionErrorFallbackBody({
      exhaustedTurnBudget: false,
      retryScheduled: false,
      category: "timeout",
      errorMessage: "raw timeout",
      totalTimeoutSeconds: 600,
      complexityInfo: "medium risk",
      timeoutEstimate: null,
    });

    expect(body).toContain("Kodiai timed out");
    expect(body).toContain("exceeded its execution time before KodiAI could publish");
    expect(body).not.toContain("raw timeout");
  });
});
