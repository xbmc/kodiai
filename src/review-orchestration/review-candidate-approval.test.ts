import { describe, expect, test } from "bun:test";
import {
  createDegradedReviewCandidateFindingResult,
  createReviewCandidateFindingExecutionResult,
  type ReviewCandidateFinding,
  type ReviewCandidateFindingExecutionResult,
} from "./review-candidate-finding.ts";
import {
  createDegradedReviewReducerResult,
  type ProcessedReviewFinding,
  type ReviewReducerResult,
} from "./review-reducer.ts";
import {
  coordinateReviewCandidateApproval,
  toReviewCandidateApprovalDetailsSummary,
  type ReviewCandidateApprovalResult,
} from "./review-candidate-approval.ts";

const BASE_INPUT = {
  repo: "owner/repo",
  pullNumber: 42,
  reviewOutputKey: "review-output-abc123",
  deliveryId: "delivery-001",
};

describe("review candidate approval coordinator", () => {
  test("approves and rewrites joined visible reducer findings while exposing safe candidate references", () => {
    const candidates = candidateResult([
      candidateInput("src/approved.ts", "Approve candidate"),
      candidateInput("src/rewrite.ts", "Rewrite candidate"),
    ]);
    const approvedCandidate = candidates.findings[0]!;
    const rewrittenCandidate = candidates.findings[1]!;

    const reducer = reducerResult({
      findings: [
        reducerFinding(1, approvedCandidate, { candidateFingerprint: approvedCandidate.fingerprint }),
        reducerFinding(2, rewrittenCandidate, {
          candidateFingerprint: rewrittenCandidate.fingerprint,
          title: "Rewritten bounded title",
          originalTitle: rewrittenCandidate.title,
          filterAction: "rewritten",
        }),
      ],
      visibleFindings: [
        reducerFinding(1, approvedCandidate, { candidateFingerprint: approvedCandidate.fingerprint }),
        reducerFinding(2, rewrittenCandidate, {
          candidateFingerprint: rewrittenCandidate.fingerprint,
          title: "Rewritten bounded title",
          originalTitle: rewrittenCandidate.title,
          filterAction: "rewritten",
        }),
      ],
    });

    const result = coordinateReviewCandidateApproval({ candidates, reducer });

    expect(result.counts).toMatchObject({ approved: 1, rewritten: 1, suppressed: 0, deduped: 0, rejected: 0, fallbackDisallowed: 0 });
    expect(result.approvedCandidates).toEqual([
      { fingerprint: approvedCandidate.fingerprint, candidate: approvedCandidate, lifecycle: "approved" },
    ]);
    expect(result.rewrittenCandidates).toEqual([
      { fingerprint: rewrittenCandidate.fingerprint, candidate: rewrittenCandidate, lifecycle: "rewritten", reason: "reducer-rewritten" },
    ]);
    expect(lifecycleMap(result)).toEqual(new Map([
      [approvedCandidate.fingerprint, "approved"],
      [rewrittenCandidate.fingerprint, "rewritten"],
    ]));
  });

  test("suppresses filtered, low-confidence, deprioritized, and unjoined reducer findings without approving them", () => {
    const candidates = candidateResult([
      candidateInput("src/suppressed.ts", "Suppressed candidate"),
      candidateInput("src/low-confidence.ts", "Low confidence candidate"),
      candidateInput("src/deprioritized.ts", "Deprioritized candidate"),
      candidateInput("src/unjoined.ts", "Unjoined candidate"),
    ]);
    const [suppressedCandidate, lowConfidenceCandidate, deprioritizedCandidate, unjoinedCandidate] = candidates.findings;

    const reducer = reducerResult({
      findings: [
        reducerFinding(1, suppressedCandidate!, { candidateFingerprint: suppressedCandidate!.fingerprint, suppressed: true }),
        reducerFinding(2, lowConfidenceCandidate!, { candidateFingerprint: lowConfidenceCandidate!.fingerprint, confidence: 20 }),
        reducerFinding(3, deprioritizedCandidate!, { candidateFingerprint: deprioritizedCandidate!.fingerprint, deprioritized: true }),
        reducerFinding(4, unjoinedCandidate!, {}),
      ],
      visibleFindings: [],
      filteredInlineFindings: [
        reducerFinding(1, suppressedCandidate!, { candidateFingerprint: suppressedCandidate!.fingerprint, suppressed: true }),
        reducerFinding(2, lowConfidenceCandidate!, { candidateFingerprint: lowConfidenceCandidate!.fingerprint, confidence: 20 }),
        reducerFinding(3, deprioritizedCandidate!, { candidateFingerprint: deprioritizedCandidate!.fingerprint, deprioritized: true }),
        reducerFinding(4, unjoinedCandidate!, {}),
      ],
      lowConfidenceFindings: [
        reducerFinding(2, lowConfidenceCandidate!, { candidateFingerprint: lowConfidenceCandidate!.fingerprint, confidence: 20 }),
      ],
    });

    const result = coordinateReviewCandidateApproval({ candidates, reducer });

    expect(result.counts).toMatchObject({ approved: 0, suppressed: 4 });
    expect(result.approvedCandidates).toEqual([]);
    expect([...lifecycleMap(result).values()]).toEqual(["suppressed", "suppressed", "suppressed", "suppressed"]);
    expect(result.audit.map((event) => event.reason)).toEqual(expect.arrayContaining([
      "reducer-suppressed",
      "reducer-low-confidence",
      "reducer-deprioritized",
      "missing-candidate-join",
    ]));
  });

  test("dedupes duplicate normalized candidate fingerprints by base fingerprint", () => {
    const candidates = candidateResult([
      candidateInput("src/dup.ts", "Duplicate candidate"),
      candidateInput("src/dup.ts", "Duplicate candidate"),
    ]);
    const first = candidates.findings[0]!;
    const duplicate = candidates.findings[1]!;

    const reducer = reducerResult({
      findings: [reducerFinding(1, first, { candidateFingerprint: first.fingerprint })],
      visibleFindings: [reducerFinding(1, first, { candidateFingerprint: first.fingerprint })],
    });

    const result = coordinateReviewCandidateApproval({ candidates, reducer });

    expect(first.fingerprint).toMatch(/^rcf-[a-f0-9]{16}$/);
    expect(duplicate.fingerprint).toBe(`${first.fingerprint}-2`);
    expect(result.counts).toMatchObject({ approved: 1, deduped: 1 });
    expect(lifecycleMap(result).get(first.fingerprint)).toBe("approved");
    expect(lifecycleMap(result).get(duplicate.fingerprint)).toBe("deduped");
    expect(result.audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ lifecycle: "deduped", reason: "duplicate-candidate-fingerprint" }),
    ]));
  });

  test("projects candidate rejections, unavailable/degraded candidates, direct fallback disallowance, and reducer degradation as bounded non-approval evidence", () => {
    const rejectedCandidates = candidateResult([
      { filePath: "", title: "Missing path", body: "No path" },
      candidateInput("src/valid.ts", "Valid but no reducer match"),
    ]);
    const unavailableCandidates = createReviewCandidateFindingExecutionResult({ ...BASE_INPUT, mode: "unavailable", reason: "config disabled", candidates: [] });
    const degradedCandidates = createDegradedReviewCandidateFindingResult({ ...BASE_INPUT, reason: "normalization-error", inputCount: 1 });
    const degradedReducer = createDegradedReviewReducerResult({
      findings: [reducerFinding(99, rejectedCandidates.findings[0]!, { candidateFingerprint: rejectedCandidates.findings[0]!.fingerprint })],
      reason: "Reducer blew up with diff --git and sk-secret1234567890",
    });

    const rejected = coordinateReviewCandidateApproval({ candidates: rejectedCandidates, reducer: reducerResult(), fallbackPolicy: { allowDirectFallback: false, attemptedDirectFallback: true } });
    expect(rejected.counts).toMatchObject({ rejected: 1, fallbackDisallowed: 1, approved: 0 });
    expect(rejected.audit.map((event) => event.reason)).toEqual(expect.arrayContaining(["candidate-rejected", "direct-fallback-disallowed"]));

    const unavailable = coordinateReviewCandidateApproval({ candidates: unavailableCandidates, reducer: reducerResult() });
    expect(unavailable.counts.suppressed).toBe(1);
    expect(unavailable.audit).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "candidate-unavailable" })]));

    const degraded = coordinateReviewCandidateApproval({ candidates: degradedCandidates, reducer: reducerResult() });
    expect(degraded.counts.suppressed).toBe(1);
    expect(degraded.audit).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "candidate-degraded" })]));

    const reducerDegraded = coordinateReviewCandidateApproval({ candidates: rejectedCandidates, reducer: degradedReducer });
    expect(reducerDegraded.counts.approved).toBe(0);
    expect(reducerDegraded.audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "reducer-degraded-fail-open" }),
    ]));
  });

  test("serializes approval outcomes without raw candidate payloads while preserving approved and rewritten references", () => {
    const rawMarkers = [
      "Unsafe raw approval title",
      "Unsafe raw rewrite title",
      "Unsafe raw suppression title",
      "Unsafe raw dedupe title",
      "Unsafe raw rejection title",
      "Unsafe raw degraded title",
      "Body includes hidden prompt",
      "Evidence includes raw workspace",
      "src/approved-unsafe.ts",
      "src/rewrite-unsafe.ts",
      "src/suppressed-unsafe.ts",
      "src/dedupe-unsafe.ts",
      "src/rejected-unsafe.ts",
      "src/degraded-unsafe.ts",
      "/home/keith/src/kodiai",
      "BEGIN PROMPT",
      "diff --git",
      "TOKEN=abc123",
      "sk-live-secret-token",
    ];
    const unsafeCandidateInput = (filePath: string, title: string, overrides: Record<string, unknown> = {}) => candidateInput(filePath, title, {
      body: `${title}: Body includes hidden prompt BEGIN PROMPT diff --git TOKEN=abc123 sk-live-secret-token`,
      evidence: "Evidence includes raw workspace /home/keith/src/kodiai",
      ...overrides,
    });

    const joinedCandidates = unsafeCandidateResult([
      unsafeCandidateInput("src/approved-unsafe.ts", "Unsafe raw approval title"),
      unsafeCandidateInput("src/rewrite-unsafe.ts", "Unsafe raw rewrite title"),
      unsafeCandidateInput("src/suppressed-unsafe.ts", "Unsafe raw suppression title"),
      unsafeCandidateInput("src/dedupe-unsafe.ts", "Unsafe raw dedupe title"),
      unsafeCandidateInput("src/dedupe-unsafe.ts", "Unsafe raw dedupe title"),
    ]);
    const [approvedCandidate, rewrittenCandidate, suppressedCandidate, firstDedupedCandidate] = joinedCandidates.findings;
    const joined = coordinateReviewCandidateApproval({
      candidates: joinedCandidates,
      reducer: reducerResult({
        findings: [
          reducerFinding(1, approvedCandidate!, { candidateFingerprint: approvedCandidate!.fingerprint }),
          reducerFinding(2, rewrittenCandidate!, {
            candidateFingerprint: rewrittenCandidate!.fingerprint,
            title: "Bounded rewritten title",
            originalTitle: rewrittenCandidate!.title,
            filterAction: "rewritten",
          }),
          reducerFinding(3, suppressedCandidate!, { candidateFingerprint: suppressedCandidate!.fingerprint, suppressed: true }),
          reducerFinding(4, firstDedupedCandidate!, { candidateFingerprint: firstDedupedCandidate!.fingerprint }),
        ],
        visibleFindings: [
          reducerFinding(1, approvedCandidate!, { candidateFingerprint: approvedCandidate!.fingerprint }),
          reducerFinding(2, rewrittenCandidate!, {
            candidateFingerprint: rewrittenCandidate!.fingerprint,
            title: "Bounded rewritten title",
            originalTitle: rewrittenCandidate!.title,
            filterAction: "rewritten",
          }),
          reducerFinding(4, firstDedupedCandidate!, { candidateFingerprint: firstDedupedCandidate!.fingerprint }),
        ],
        filteredInlineFindings: [
          reducerFinding(3, suppressedCandidate!, { candidateFingerprint: suppressedCandidate!.fingerprint, suppressed: true }),
        ],
      }),
    });

    const rejected = coordinateReviewCandidateApproval({
      candidates: unsafeCandidateResult([unsafeCandidateInput("src/rejected-unsafe.ts", "Unsafe raw rejection title", { filePath: "" })]),
      reducer: reducerResult(),
    });
    const degradedCandidates = unsafeCandidateResult([unsafeCandidateInput("src/degraded-unsafe.ts", "Unsafe raw degraded title")]);
    const degraded = coordinateReviewCandidateApproval({
      candidates: degradedCandidates,
      reducer: createDegradedReviewReducerResult({
        findings: [],
        reason: "Reducer degraded with BEGIN PROMPT diff --git sk-live-secret-token",
      }),
    });

    const allOutcomes = [...joined.outcomes, ...rejected.outcomes, ...degraded.outcomes];
    expect(allOutcomes.map((outcome) => Object.keys(outcome).sort())).toEqual(allOutcomes.map(() => ["fingerprint", "lifecycle", "reason"]));
    for (const outcome of allOutcomes) {
      expect("candidate" in outcome).toBe(false);
    }

    const serializedOutcomes = JSON.stringify(allOutcomes);
    for (const marker of rawMarkers) {
      expect(serializedOutcomes).not.toContain(marker);
    }
    expect(joined.approvedCandidates).toEqual(expect.arrayContaining([
      { fingerprint: approvedCandidate!.fingerprint, candidate: approvedCandidate!, lifecycle: "approved" },
      { fingerprint: firstDedupedCandidate!.fingerprint, candidate: firstDedupedCandidate!, lifecycle: "approved" },
    ]));
    expect(joined.approvedCandidates).toHaveLength(2);
    expect(joined.rewrittenCandidates).toEqual([
      { fingerprint: rewrittenCandidate!.fingerprint, candidate: rewrittenCandidate!, lifecycle: "rewritten", reason: "reducer-rewritten" },
    ]);
    expect(JSON.stringify([...joined.approvedCandidates, ...joined.rewrittenCandidates])).toContain("Unsafe raw approval title");
    expect(JSON.stringify([...joined.approvedCandidates, ...joined.rewrittenCandidates])).toContain("Unsafe raw rewrite title");
  });

  test("keeps approval summaries bounded to lifecycle counts and reason codes without raw payload leaks", () => {
    const candidates = candidateResult([
      candidateInput("src/raw-secret.ts", "Raw candidate title must not leak", {
        body: "Body mentions diff --git, BEGIN PROMPT, /home/keith/src/kodiai, and sk-secret1234567890.",
      }),
      { filePath: "/home/keith/src/kodiai/src/unsafe.ts", title: "Unsafe workspace path", body: "Unsafe" },
    ]);
    const reducer = reducerResult();

    const result = coordinateReviewCandidateApproval({ candidates, reducer, fallbackPolicy: { allowDirectFallback: false, attemptedDirectFallback: true } });
    const summary = toReviewCandidateApprovalDetailsSummary(result);

    expect(summary.label).toBe("Review candidate approval");
    expect(summary.text.length).toBeLessThanOrEqual(260);
    expect(summary.text).toContain("Review candidate approval:");
    expect(summary.text).toContain("approved=0");
    expect(summary.text).toContain("rejected=2");
    expect(summary.text).toContain("fallbackDisallowed=1");
    expect(summary.text).toContain("reasons=");
    for (const unsafe of [
      "Raw candidate title",
      "src/raw-secret.ts",
      "src/unsafe.ts",
      "diff --git",
      "BEGIN PROMPT",
      "/home/keith/src/kodiai",
      "sk-secret1234567890",
      "Body mentions",
      "Unsafe workspace path",
    ]) {
      expect(summary.text).not.toContain(unsafe);
    }
  });
});

function lifecycleMap(result: ReviewCandidateApprovalResult): Map<string, string> {
  return new Map(result.outcomes.map((outcome) => [outcome.fingerprint, outcome.lifecycle]));
}

function candidateInput(filePath: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    filePath,
    startLine: 10,
    endLine: 12,
    severity: "major",
    category: "correctness",
    title,
    body: `${title} body is safe and grounded.`,
    ...overrides,
  };
}

function candidateResult(candidates: Parameters<typeof createReviewCandidateFindingExecutionResult>[0]["candidates"]): ReviewCandidateFindingExecutionResult {
  return createReviewCandidateFindingExecutionResult({ ...BASE_INPUT, artifactPresent: true, candidates });
}

function unsafeCandidateResult(candidates: Parameters<typeof createReviewCandidateFindingExecutionResult>[0]["candidates"]): ReviewCandidateFindingExecutionResult {
  return createReviewCandidateFindingExecutionResult({ ...BASE_INPUT, artifactPresent: true, candidates, unsafeTextDetector: () => false });
}

function reducerFinding(
  commentId: number,
  candidate: ReviewCandidateFinding,
  overrides: Partial<ProcessedReviewFinding> & { candidateFingerprint?: string } = {},
): ProcessedReviewFinding {
  return {
    commentId,
    filePath: candidate.filePath,
    title: candidate.title,
    severity: candidate.severity,
    category: candidate.category,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    suppressed: false,
    confidence: 90,
    ...overrides,
  };
}

function reducerResult(overrides: Partial<ReviewReducerResult> = {}): ReviewReducerResult {
  const findings = overrides.findings ?? [];
  const visibleFindings = overrides.visibleFindings ?? [];
  const filteredInlineFindings = overrides.filteredInlineFindings ?? [];
  const lowConfidenceFindings = overrides.lowConfidenceFindings ?? [];
  return {
    status: "ready",
    findings,
    visibleFindings,
    filteredInlineFindings,
    lowConfidenceFindings,
    suppressionMatchCounts: new Map(),
    filterRecords: [],
    counts: {
      input: findings.length,
      kept: visibleFindings.length,
      suppressed: filteredInlineFindings.filter((finding) => finding.suppressed).length,
      rewritten: visibleFindings.filter((finding) => finding.filterAction === "rewritten" || finding.filterAction === "guardrail-rewritten").length,
      deprioritized: filteredInlineFindings.filter((finding) => finding.deprioritized).length,
      lowConfidence: lowConfidenceFindings.length,
      auditEvents: 0,
      severityDemoted: 0,
      graphValidated: 0,
      graphUncertain: 0,
    },
    audit: [],
    detailsSummary: { label: "Review reducer", status: "ready", text: "Review reducer: ready" },
    ...overrides,
  };
}
