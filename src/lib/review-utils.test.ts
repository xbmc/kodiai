import { describe, it, expect } from "bun:test";
import { formatReviewDetailsSummary } from "./review-utils.ts";
import type { ReviewFirstPassPayload } from "./review-first-pass.ts";
import { projectContributorExperienceContract } from "../contributor/experience-contract.ts";

const BOUNDED_TIMEOUT_FIRST_PASS: ReviewFirstPassPayload = {
  state: "bounded-first-pass",
  boundedReason: "timeout",
  evidenceSource: "checkpoint",
  coveredScope: { reviewedFiles: 1, totalFiles: 3 },
  remainingScope: { remainingFiles: 2, totalFiles: 3 },
  findingCount: 2,
  publication: { eligible: true, hasPublishedOutput: false },
  continuationPending: true,
  zeroEvidenceFailure: false,
};

const BASE_PARAMS = {
  reviewOutputKey: "test-key-001",
  filesReviewed: 3,
  linesAdded: 50,
  linesRemoved: 10,
  findingCounts: { critical: 0, major: 1, medium: 2, minor: 0 },
  profileSelection: {
    selectedProfile: "balanced" as const,
    source: "auto" as const,
    linesChanged: 60,
    autoBand: null,
  },
  contributorExperience: projectContributorExperienceContract({
    source: "author-cache",
    tier: "regular",
  }).reviewDetails,
};

describe("formatReviewDetailsSummary", () => {
  it("renders bounded first-pass diagnostics from the normalized contract", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewFirstPass: BOUNDED_TIMEOUT_FIRST_PASS,
    });

    expect(result).toContain("- Bounded first-pass: timeout via checkpoint evidence");
    expect(result).toContain("- Covered scope: 1/3 changed files");
    expect(result).toContain("- Remaining scope: 2/3 changed files");
    expect(result).toContain("- First-pass findings captured: 2");
    expect(result).toContain("- Publication eligibility: eligible");
    expect(result).toContain("- Continuation state: follow-up review pending for remaining scope");
  });

  it("renders zero-evidence hard failure explicitly instead of bounded success", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewFirstPass: {
        state: "zero-evidence-failure",
        boundedReason: "max-turns",
        evidenceSource: "none",
        publication: { eligible: false, hasPublishedOutput: false },
        continuationPending: false,
        zeroEvidenceFailure: true,
      },
    });

    expect(result).toContain("- Constrained outcome: zero-evidence hard failure after max-turns");
    expect(result).toContain("- Publication eligibility: ineligible");
    expect(result).toContain("- Continuation state: stopped after first pass; no follow-up review is pending");
    expect(result).not.toContain("- Bounded first-pass:");
    expect(result).not.toContain("- Covered scope:");
  });

  it("degrades truthfully when remaining scope is missing instead of implying exhaustive coverage", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewFirstPass: {
        ...BOUNDED_TIMEOUT_FIRST_PASS,
        remainingScope: undefined,
        continuationPending: true,
      },
    });

    expect(result).toContain("- Covered scope: 1/3 changed files");
    expect(result).toContain("- Remaining scope: not confirmed from structured evidence");
    expect(result).toContain("- Continuation state: follow-up review pending; remaining scope still unconfirmed");
  });

  it("degrades truthfully when covered scope is missing instead of inventing reviewed coverage", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewFirstPass: {
        ...BOUNDED_TIMEOUT_FIRST_PASS,
        coveredScope: undefined,
        remainingScope: { remainingFiles: 2, totalFiles: 3 },
        continuationPending: false,
      },
    });

    expect(result).not.toContain("- Covered scope:");
    expect(result).toContain("- Remaining scope: 2/3 changed files");
    expect(result).toContain("- Continuation state: stopped after first pass; 2/3 files remain unreviewed");
  });

  it("renders contributor-experience contract wording without raw tier leakage", () => {
    const cases = [
      {
        projection: projectContributorExperienceContract({
          source: "contributor-profile",
          tier: "established",
        }).reviewDetails,
        expected:
          "- Contributor experience: profile-backed (using linked contributor profile guidance)",
      },
      {
        projection: projectContributorExperienceContract({
          source: "author-cache",
          tier: "regular",
        }).reviewDetails,
        expected:
          "- Contributor experience: coarse-fallback (using coarse fallback signals only)",
      },
      {
        projection: projectContributorExperienceContract({
          source: "none",
          tier: null,
        }).reviewDetails,
        expected:
          "- Contributor experience: generic-unknown (no reliable contributor signal available)",
      },
      {
        projection: projectContributorExperienceContract({
          source: "contributor-profile",
          tier: "senior",
          optedOut: true,
        }).reviewDetails,
        expected:
          "- Contributor experience: generic-opt-out (contributor-specific guidance disabled by opt-out)",
      },
      {
        projection: projectContributorExperienceContract({
          source: "github-search",
          tier: "regular",
          degraded: true,
          degradationPath: "search-api-rate-limit",
        }).reviewDetails,
        expected:
          "- Contributor experience: generic-degraded (fallback signals unavailable: search-api-rate-limit)",
      },
    ];

    for (const testCase of cases) {
      const result = formatReviewDetailsSummary({
        ...BASE_PARAMS,
        contributorExperience: testCase.projection,
      });

      expect(result).toContain(testCase.expected);
      expect(result).not.toContain("- Author tier:");
      expect(result).not.toContain("developing guidance");
      expect(result).not.toContain("established contributor guidance");
      expect(result).not.toContain("senior contributor guidance");
    }
  });

  it("renders usage line when usageLimit is present", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      usageLimit: {
        utilization: 0.75,
        rateLimitType: "seven_day",
        resetsAt: 1735000000,
      },
    });

    expect(result).toContain("25% of seven_day limit remaining");
    expect(result).toContain("resets ");

    const resultWithout = formatReviewDetailsSummary({ ...BASE_PARAMS });
    expect(resultWithout).not.toContain("Claude Code usage");
  });

  it("renders token line when tokenUsage is present", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      tokenUsage: {
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.0123,
      },
    });

    expect(result).toContain("in /");
    expect(result).toContain("out");
    expect(result).toContain("0.0123");
  });

  it("uses a provided completedAt timestamp instead of regenerating wall clock time", () => {
    const completedAt = "2026-04-22T20:15:00.000Z";
    const first = formatReviewDetailsSummary({ ...BASE_PARAMS, completedAt });
    const second = formatReviewDetailsSummary({ ...BASE_PARAMS, completedAt });

    expect(first).toContain(`- Review completed: ${completedAt}`);
    expect(second).toContain(`- Review completed: ${completedAt}`);
    expect(first).toBe(second);
  });

  it("omits usage and token lines when fields absent", () => {
    const result = formatReviewDetailsSummary({ ...BASE_PARAMS });

    expect(result).not.toContain("Claude Code usage:");
    expect(result).not.toContain("Tokens:");
  });

  it("renders timeout progress from analyzed evidence instead of generic reviewed totals", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      timeoutProgress: {
        analyzedFiles: 1,
        totalFiles: 3,
        findingCount: 2,
        retryState: "scheduled reduced-scope retry",
      },
    });

    expect(result).toContain("- Analyzed progress before timeout: 1/3 changed files");
    expect(result).toContain("- Findings captured before timeout: 2 total");
    expect(result).toContain("- Retry state: scheduled reduced-scope retry");
    expect(result).not.toContain("- Files reviewed: 3");
    expect(result).not.toContain("- Findings: 0 critical, 1 major, 2 medium, 0 minor");
  });

  it("renders timeout budget lines when timeout progress includes split budgets", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      timeoutProgress: {
        analyzedFiles: 1,
        totalFiles: 3,
        findingCount: 2,
        retryState: "scheduled reduced-scope retry",
      },
      timeoutBudget: {
        remoteRuntimeBudgetSeconds: 423,
        infraOverheadBudgetSeconds: 180,
        totalTimeoutSeconds: 603,
      },
    });

    expect(result).toContain("- Timeout budget: remote runtime 423s + infra overhead 180s = total 603s");
  });

  it("keeps shared bounded first-pass wording visible when timeout retry metadata is present", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewFirstPass: BOUNDED_TIMEOUT_FIRST_PASS,
      timeoutProgress: {
        analyzedFiles: 1,
        totalFiles: 3,
        findingCount: 2,
        retryState: "scheduled reduced-scope retry",
      },
    });

    expect(result).toContain("- Bounded first-pass: timeout via checkpoint evidence");
    expect(result).toContain("- Covered scope: 1/3 changed files");
    expect(result).toContain("- Remaining scope: 2/3 changed files");
    expect(result).toContain("- Continuation state: follow-up review pending for remaining scope");
    expect(result).toContain("- Retry state: scheduled reduced-scope retry");
  });

  it("degrades truthfully on timeout metadata when bounded scope fields are missing", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewFirstPass: {
        ...BOUNDED_TIMEOUT_FIRST_PASS,
        coveredScope: undefined,
        remainingScope: undefined,
        continuationPending: true,
      },
      timeoutProgress: {
        analyzedFiles: 1,
        totalFiles: 3,
        findingCount: 2,
        retryState: "retry skipped after timeout",
      },
    });

    expect(result).toContain("- Bounded first-pass: timeout via checkpoint evidence");
    expect(result).toContain("- Remaining scope: not confirmed from structured evidence");
    expect(result).toContain("- Continuation state: follow-up review pending; remaining scope still unconfirmed");
    expect(result).not.toContain("- Covered scope:");
    expect(result).toContain("- Retry state: retry skipped after timeout");
  });

  it("renders total wall-clock time and the six required phases in stable order", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      phaseTimingSummary: {
        totalDurationMs: 2500,
        phases: [
          { name: "publication", status: "completed", durationMs: 400 },
          { name: "remote runtime", status: "completed", durationMs: 1200 },
          { name: "executor handoff", status: "completed", durationMs: 50 },
          { name: "retrieval/context assembly", status: "completed", durationMs: 300 },
          { name: "workspace preparation", status: "completed", durationMs: 200 },
          { name: "queue wait", status: "completed", durationMs: 350 },
        ],
      },
    });

    expect(result).toContain("- Total wall-clock: 2.5s");
    expect(result).toContain("- Phase timings:");

    const orderedLines = [
      "queue wait: 350ms",
      "workspace preparation: 200ms",
      "retrieval/context assembly: 300ms",
      "executor handoff: 50ms",
      "remote runtime: 1.2s",
      "publication: 400ms",
    ];

    let lastIndex = -1;
    for (const line of orderedLines) {
      const nextIndex = result.indexOf(line);
      expect(nextIndex).toBeGreaterThan(lastIndex);
      lastIndex = nextIndex;
    }
  });

  it("omits total wall-clock when the summary duration is invalid instead of rendering an epoch-sized value", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      phaseTimingSummary: {
        totalDurationMs: Number.POSITIVE_INFINITY,
        phases: [
          { name: "queue wait", status: "completed", durationMs: 350 },
        ],
      },
    });

    expect(result).not.toContain("- Total wall-clock:");
    expect(result).toContain("queue wait: 350ms");
  });

  it("renders degraded and unavailable wording for malformed or missing phase timings instead of throwing", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      phaseTimingSummary: {
        totalDurationMs: 3100,
        phases: [
          { name: "publication", status: "degraded", durationMs: 120, detail: "captured before publication completed" },
          { name: "remote runtime", status: "completed", durationMs: 800 },
          { name: "executor handoff", status: "completed", durationMs: 50 },
          { name: "workspace preparation", status: "bogus", durationMs: 200 } as never,
          { name: "queue wait", status: "completed", durationMs: Number.NaN } as never,
        ],
      },
    });

    expect(result).toContain("queue wait: unavailable (invalid phase timing data)");
    expect(result).toContain("workspace preparation: unavailable (invalid phase timing data)");
    expect(result).toContain("retrieval/context assembly: unavailable (phase timing unavailable)");
    expect(result).toContain("executor handoff: 50ms");
    expect(result).toContain("remote runtime: 800ms");
    expect(result).toContain("publication: 120ms (degraded: captured before publication completed)");
  });

  it("renders requested versus effective bounded-review lines without duplicating the old profile line", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewBoundedness: {
        requestedProfile: {
          selectedProfile: "strict",
          source: "keyword",
          autoBand: null,
          linesChanged: 100,
        },
        effectiveProfile: {
          selectedProfile: "strict",
          source: "keyword",
          autoBand: null,
          linesChanged: 100,
        },
        reasonCodes: [
          "large-pr-triage",
          "timeout-auto-reduction-skipped-explicit-profile",
        ],
        disclosureRequired: true,
        disclosureSentence:
          "Requested strict review; effective review remained strict and covered 50/60 changed files via large-PR triage (30 full, 20 abbreviated; 10 not reviewed).",
        largePR: {
          fullCount: 30,
          abbreviatedCount: 20,
          reviewedCount: 50,
          totalFiles: 60,
          notReviewedCount: 10,
        },
        timeout: {
          riskLevel: "high",
          dynamicTimeoutSeconds: 900,
          shouldReduceScope: true,
          reductionApplied: false,
          reductionSkippedReason: "explicit-profile",
        },
      } as never,
    });

    expect(result).toContain("- Requested profile: strict (keyword override)");
    expect(result).toContain("- Effective profile: strict");
    expect(result).toContain(
      "- Bounded review: covered 50/60 changed files via large-PR triage (30 full, 20 abbreviated; 10 not reviewed)",
    );
    expect(result).toContain("- Timeout auto-reduction: skipped (explicit profile)");
    expect(result).not.toContain("- Profile: balanced (auto, lines changed: 60)");
  });

  it("keeps small unbounded reviews quiet by retaining the existing single profile line", () => {
    const result = formatReviewDetailsSummary({
      ...BASE_PARAMS,
      reviewBoundedness: {
        requestedProfile: {
          selectedProfile: "strict",
          source: "auto",
          autoBand: "small",
          linesChanged: 60,
        },
        effectiveProfile: {
          selectedProfile: "strict",
          source: "auto",
          autoBand: "small",
          linesChanged: 60,
        },
        reasonCodes: [],
        disclosureRequired: false,
        disclosureSentence: null,
        largePR: null,
        timeout: {
          riskLevel: "low",
          dynamicTimeoutSeconds: 600,
          shouldReduceScope: false,
          reductionApplied: false,
          reductionSkippedReason: null,
        },
      } as never,
    });

    expect(result).toContain("- Profile: balanced (auto, lines changed: 60)");
    expect(result).not.toContain("- Requested profile:");
    expect(result).not.toContain("- Effective profile:");
    expect(result).not.toContain("- Bounded review:");
  });
});
