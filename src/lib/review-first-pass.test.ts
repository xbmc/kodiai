import { describe, expect, test } from "bun:test";

async function loadReviewFirstPassModule() {
  return await import("./review-first-pass.ts").catch(() => null);
}

describe("normalizeReviewFirstPass", () => {
  test("normalizes timeout plus checkpoint evidence into a publishable bounded first pass", async () => {
    const mod = await loadReviewFirstPassModule();

    expect(mod).not.toBeNull();

    const payload = mod!.normalizeReviewFirstPass({
      boundedness: {
        requestedProfile: {
          selectedProfile: "strict",
          source: "keyword",
          autoBand: null,
          linesChanged: 300,
        },
        effectiveProfile: {
          selectedProfile: "strict",
          source: "keyword",
          autoBand: null,
          linesChanged: 300,
        },
        reasonCodes: ["large-pr-triage", "timeout-auto-reduction-skipped-explicit-profile"],
        disclosureRequired: true,
        disclosureSentence: "Requested strict review; effective review remained strict and covered 3/5 changed files via large-PR triage (2 full, 1 abbreviated; 2 not reviewed).",
        largePR: {
          fullCount: 2,
          abbreviatedCount: 1,
          reviewedCount: 3,
          totalFiles: 5,
          notReviewedCount: 2,
        },
        timeout: {
          riskLevel: "high",
          dynamicTimeoutSeconds: 900,
          shouldReduceScope: true,
          reductionApplied: false,
          reductionSkippedReason: "explicit-profile",
        },
      },
      checkpoint: {
        reviewOutputKey: "review-1",
        repo: "owner/repo",
        prNumber: 42,
        filesReviewed: ["a.ts", "b.ts", "c.ts"],
        findingCount: 4,
        summaryDraft: "Partial review draft",
        totalFiles: 5,
      },
      outcome: {
        conclusion: "error",
        stopReason: "tool_use",
        failureSubtype: "error_timeout",
        isTimeout: true,
        published: false,
      },
    });

    expect(payload).toEqual({
      state: "bounded-first-pass",
      boundedReason: "timeout",
      evidenceSource: "checkpoint",
      coveredScope: {
        reviewedFiles: 3,
        totalFiles: 5,
      },
      remainingScope: {
        remainingFiles: 2,
        totalFiles: 5,
      },
      findingCount: 4,
      publication: {
        eligible: true,
        hasPublishedOutput: false,
      },
      continuationPending: true,
      zeroEvidenceFailure: false,
    });
  });

  test("normalizes max_turns plus structured checkpoint evidence without string parsing", async () => {
    const mod = await loadReviewFirstPassModule();

    expect(mod).not.toBeNull();

    const payload = mod!.normalizeReviewFirstPass({
      boundedness: {
        requestedProfile: {
          selectedProfile: "balanced",
          source: "auto",
          autoBand: "large",
          linesChanged: 800,
        },
        effectiveProfile: {
          selectedProfile: "minimal",
          source: "auto",
          autoBand: "large",
          linesChanged: 800,
        },
        reasonCodes: ["timeout-auto-reduced"],
        disclosureRequired: true,
        disclosureSentence: "Requested balanced review; timeout risk auto-reduced the effective review to minimal.",
        largePR: null,
        timeout: {
          riskLevel: "high",
          dynamicTimeoutSeconds: 600,
          shouldReduceScope: true,
          reductionApplied: true,
          reductionSkippedReason: null,
        },
      },
      checkpoint: {
        reviewOutputKey: "review-2",
        repo: "owner/repo",
        prNumber: 43,
        filesReviewed: ["only.ts"],
        findingCount: 0,
        summaryDraft: "In progress",
        totalFiles: 4,
      },
      outcome: {
        conclusion: "failure",
        stopReason: "max_turns",
        failureSubtype: "error_max_turns",
        isTimeout: false,
        published: false,
      },
    });

    expect(payload).toEqual({
      state: "bounded-first-pass",
      boundedReason: "max-turns",
      evidenceSource: "checkpoint",
      coveredScope: {
        reviewedFiles: 1,
        totalFiles: 4,
      },
      remainingScope: {
        remainingFiles: 3,
        totalFiles: 4,
      },
      findingCount: 0,
      publication: {
        eligible: true,
        hasPublishedOutput: false,
      },
      continuationPending: true,
      zeroEvidenceFailure: false,
    });
  });

  test("uses boundedness-only evidence for large-pr first pass when no checkpoint exists", async () => {
    const mod = await loadReviewFirstPassModule();

    expect(mod).not.toBeNull();

    const payload = mod!.normalizeReviewFirstPass({
      boundedness: {
        requestedProfile: {
          selectedProfile: "strict",
          source: "keyword",
          autoBand: null,
          linesChanged: 500,
        },
        effectiveProfile: {
          selectedProfile: "strict",
          source: "keyword",
          autoBand: null,
          linesChanged: 500,
        },
        reasonCodes: ["large-pr-triage"],
        disclosureRequired: true,
        disclosureSentence: "Requested strict review; effective review remained strict and covered 7/10 changed files via large-PR triage (4 full, 3 abbreviated; 3 not reviewed).",
        largePR: {
          fullCount: 4,
          abbreviatedCount: 3,
          reviewedCount: 7,
          totalFiles: 10,
          notReviewedCount: 3,
        },
        timeout: null,
      },
      checkpoint: null,
      outcome: {
        conclusion: "success",
        stopReason: "end_turn",
        failureSubtype: undefined,
        isTimeout: false,
        published: true,
      },
    });

    expect(payload).toEqual({
      state: "bounded-first-pass",
      boundedReason: "large-pr",
      evidenceSource: "boundedness",
      coveredScope: {
        reviewedFiles: 7,
        totalFiles: 10,
      },
      remainingScope: {
        remainingFiles: 3,
        totalFiles: 10,
      },
      findingCount: undefined,
      publication: {
        eligible: true,
        hasPublishedOutput: true,
      },
      continuationPending: true,
      zeroEvidenceFailure: false,
    });
  });

  test("classifies zero-evidence failure separately from bounded first-pass publication", async () => {
    const mod = await loadReviewFirstPassModule();

    expect(mod).not.toBeNull();

    const payload = mod!.normalizeReviewFirstPass({
      boundedness: null,
      checkpoint: null,
      outcome: {
        conclusion: "failure",
        stopReason: "max_turns",
        failureSubtype: "error_max_turns",
        isTimeout: false,
        published: false,
      },
    });

    expect(payload).toEqual({
      state: "zero-evidence-failure",
      boundedReason: "max-turns",
      evidenceSource: "none",
      coveredScope: undefined,
      remainingScope: undefined,
      findingCount: undefined,
      publication: {
        eligible: false,
        hasPublishedOutput: false,
      },
      continuationPending: false,
      zeroEvidenceFailure: true,
    });
  });

  test("omits unsupported scope data when checkpoint counts are malformed", async () => {
    const mod = await loadReviewFirstPassModule();

    expect(mod).not.toBeNull();

    const payload = mod!.normalizeReviewFirstPass({
      boundedness: {
        requestedProfile: {
          selectedProfile: "strict",
          source: "keyword",
          autoBand: null,
          linesChanged: 300,
        },
        effectiveProfile: {
          selectedProfile: "strict",
          source: "keyword",
          autoBand: null,
          linesChanged: 300,
        },
        reasonCodes: ["timeout-auto-reduction-skipped-explicit-profile"],
        disclosureRequired: false,
        disclosureSentence: null,
        largePR: null,
        timeout: {
          riskLevel: "high",
          dynamicTimeoutSeconds: 900,
          shouldReduceScope: true,
          reductionApplied: false,
          reductionSkippedReason: "explicit-profile",
        },
      },
      checkpoint: {
        reviewOutputKey: "review-3",
        repo: "owner/repo",
        prNumber: 44,
        filesReviewed: ["a.ts", "b.ts", "c.ts", "d.ts"],
        findingCount: 1,
        summaryDraft: "Bad counts",
        totalFiles: 3,
      },
      outcome: {
        conclusion: "error",
        stopReason: "tool_use",
        failureSubtype: "error_timeout",
        isTimeout: true,
        published: false,
      },
    });

    expect(payload).toEqual({
      state: "bounded-first-pass",
      boundedReason: "timeout",
      evidenceSource: "checkpoint",
      coveredScope: undefined,
      remainingScope: undefined,
      findingCount: 1,
      publication: {
        eligible: true,
        hasPublishedOutput: false,
      },
      continuationPending: true,
      zeroEvidenceFailure: false,
    });
  });

  test("returns null for unsupported stop reasons without bounded evidence", async () => {
    const mod = await loadReviewFirstPassModule();

    expect(mod).not.toBeNull();

    const payload = mod!.normalizeReviewFirstPass({
      boundedness: null,
      checkpoint: null,
      outcome: {
        conclusion: "failure",
        stopReason: "stop_sequence",
        failureSubtype: undefined,
        isTimeout: false,
        published: false,
      },
    });

    expect(payload).toBeNull();
  });
});
