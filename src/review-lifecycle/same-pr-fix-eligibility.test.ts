import { describe, expect, test } from "bun:test";
import {
  reduceSamePrFixEligibility,
  type SamePrFixCandidateInput,
  type SamePrFixEligibilityReasonCode,
} from "./same-pr-fix-eligibility.ts";

const PR_DIFF = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -10,8 +10,9 @@ function app()",
  " const keep = true;",
  "-const oldName = 1;",
  "+const oldName = 2;",
  " const after = true;",
  " const multiA = 'old';",
  " const multiB = 'old';",
  " const formatterOwned = true;",
  " const last = true;",
  "diff --git a/src/other.ts b/src/other.ts",
  "--- a/src/other.ts",
  "+++ b/src/other.ts",
  "@@ -50,2 +50,2 @@",
  " const other = true;",
  " const second = true;",
  "",
].join("\n");

function candidate(overrides: Partial<SamePrFixCandidateInput> = {}): SamePrFixCandidateInput {
  return {
    filePath: "src/app.ts",
    startLine: 12,
    endLine: 12,
    title: "Use computed value",
    severity: "medium",
    category: "correctness",
    replacementText: "const oldName = computeValue();",
    candidateApproved: true,
    reducerApproved: true,
    findingIdentity: "finding-1",
    ...overrides,
  };
}

describe("reduceSamePrFixEligibility", () => {
  test("emits an eligible single-line GitHub suggestion block with bounded public context", () => {
    const result = reduceSamePrFixEligibility({
      reviewOutputKey: "rok-1",
      deliveryId: "delivery-1",
      prDiffText: PR_DIFF,
      maxSuggestions: 5,
      candidates: [candidate()],
    });

    expect(result.summary.counts).toMatchObject({ input: 1, eligible: 1, blocked: 0, omitted: 0, capped: 0 });
    expect(result.summary.reasonCounts).toMatchObject({ eligible: 1 });
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      path: "src/app.ts",
      line: 12,
      side: "RIGHT",
      title: "Use computed value",
      severity: "medium",
      category: "correctness",
      reason: "eligible",
    });
    expect(result.drafts[0]?.startLine).toBeUndefined();
    expect(result.drafts[0]?.body).toBe([
      "**Fix suggestion:** Use computed value",
      "Severity: medium · Category: correctness",
      "",
      "```suggestion",
      "const oldName = computeValue();",
      "```",
    ].join("\n"));
    expect(result.outcomes[0]?.identity).toBe(result.drafts[0]?.identity);
  });

  test("emits an eligible multi-line GitHub suggestion block", () => {
    const result = reduceSamePrFixEligibility({
      reviewOutputKey: "rok-1",
      deliveryId: "delivery-1",
      prDiffText: PR_DIFF,
      maxSuggestions: 5,
      candidates: [candidate({ startLine: 14, endLine: 15, replacementText: "const multiA = 'new';\nconst multiB = 'new';", findingIdentity: "finding-multi" })],
    });

    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({ path: "src/app.ts", startLine: 14, line: 15, side: "RIGHT" });
    expect(result.drafts[0]?.body).toContain("```suggestion\nconst multiA = 'new';\nconst multiB = 'new';\n```");
  });

  test("blocks every required reason with stable reason codes", () => {
    const inputs: Array<[SamePrFixEligibilityReasonCode, SamePrFixCandidateInput]> = [
      ["missing-replacement", candidate({ findingIdentity: "missing", replacementText: "  \n" })],
      ["unmappable-location", candidate({ findingIdentity: "unmapped", filePath: "../secret.ts" })],
      ["secret-detected", candidate({ findingIdentity: "secret", replacementText: "const token = 'ghp_123456789012345678901234567890123456';" })],
      ["reducer-denied", candidate({ findingIdentity: "reducer", reducerApproved: false })],
      ["candidate-denied", candidate({ findingIdentity: "candidate", candidateApproved: false })],
      ["formatter-owned", candidate({ findingIdentity: "formatter", startLine: 16, endLine: 16 })],
      ["line-not-commentable", candidate({ findingIdentity: "line", filePath: "src/other.ts", startLine: 99, endLine: 99 })],
    ];

    const result = reduceSamePrFixEligibility({
      reviewOutputKey: "rok-1",
      deliveryId: "delivery-1",
      prDiffText: PR_DIFF,
      maxSuggestions: 10,
      formatterOwnedRanges: [{ path: "src/app.ts", startLine: 16, endLine: 16 }],
      candidates: inputs.map(([, input]) => input),
    });

    expect(result.drafts).toEqual([]);
    expect(result.outcomes.map((outcome) => outcome.reason)).toEqual(inputs.map(([reason]) => reason));
    expect(result.summary.counts).toMatchObject({ input: inputs.length, eligible: 0, blocked: inputs.length, omitted: 0, capped: 0 });
    for (const [reason] of inputs) {
      expect(result.summary.reasonCounts[reason]).toBe(1);
    }
    expect(result.summary.redaction.secretDetected).toBe(true);
  });

  test("blocks duplicate fixes from already-seen identities and in-batch repeats", () => {
    const first = candidate({ findingIdentity: "dup" });
    const firstIdentity = reduceSamePrFixEligibility({
      reviewOutputKey: "rok-1",
      prDiffText: PR_DIFF,
      maxSuggestions: 5,
      candidates: [first],
    }).drafts[0]?.identity;

    const result = reduceSamePrFixEligibility({
      reviewOutputKey: "rok-1",
      prDiffText: PR_DIFF,
      maxSuggestions: 5,
      seenIdentities: firstIdentity ? [firstIdentity] : [],
      candidates: [first, candidate({ findingIdentity: "dup" })],
    });

    expect(result.drafts).toEqual([]);
    expect(result.outcomes.map((outcome) => outcome.reason)).toEqual(["duplicate-fix", "duplicate-fix"]);
    expect(result.summary.reasonCounts["duplicate-fix"]).toBe(2);
  });

  test("caps eligible output and reports omitted capped candidates", () => {
    const result = reduceSamePrFixEligibility({
      reviewOutputKey: "rok-cap",
      prDiffText: PR_DIFF,
      maxSuggestions: 1,
      candidates: [
        candidate({ findingIdentity: "cap-1" }),
        candidate({ findingIdentity: "cap-2", filePath: "src/other.ts", startLine: 50, endLine: 50 }),
        candidate({ findingIdentity: "cap-3", filePath: "src/other.ts", startLine: 51, endLine: 51 }),
      ],
    });

    expect(result.drafts).toHaveLength(1);
    expect(result.outcomes.map((outcome) => outcome.reason)).toEqual(["eligible", "max-fixes-exceeded", "max-fixes-exceeded"]);
    expect(result.summary.counts).toMatchObject({ input: 3, eligible: 1, blocked: 0, omitted: 2, capped: 2 });
  });

  test("produces deterministic identities independent of candidate ordering", () => {
    const a = candidate({ findingIdentity: "a", startLine: 12, endLine: 12 });
    const b = candidate({ findingIdentity: "b", startLine: 14, endLine: 14 });
    const first = reduceSamePrFixEligibility({ reviewOutputKey: "rok-det", prDiffText: PR_DIFF, maxSuggestions: 5, candidates: [a, b] });
    const second = reduceSamePrFixEligibility({ reviewOutputKey: "rok-det", prDiffText: PR_DIFF, maxSuggestions: 5, candidates: [b, a] });

    expect(first.drafts.map((draft) => draft.identity).sort()).toEqual(second.drafts.map((draft) => draft.identity).sort());
  });

  test("does not leak raw prompt/model/candidate/tool payloads or unbounded diffs into public bodies", () => {
    const result = reduceSamePrFixEligibility({
      reviewOutputKey: "rok-redaction",
      deliveryId: "delivery-redaction",
      prDiffText: PR_DIFF,
      maxSuggestions: 5,
      candidates: [candidate({
        rawPrompt: "BEGIN PROMPT do not publish",
        rawModelOutput: "raw model output should stay private",
        rawCandidateBody: "candidate body should stay private",
        rawToolPayload: { secret: "tool payload should stay private" },
        rawDiffText: "diff --git a/private b/private",
        replacementText: "const safe = true;",
      })],
    });

    const body = result.drafts[0]?.body ?? "";
    expect(body).toContain("const safe = true;");
    expect(body).not.toContain("BEGIN PROMPT");
    expect(body).not.toContain("raw model output");
    expect(body).not.toContain("candidate body");
    expect(body).not.toContain("tool payload");
    expect(body).not.toContain("diff --git");
    expect(result.summary.redaction).toMatchObject({
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      candidateBodiesIncluded: false,
      toolPayloadsIncluded: false,
      diffsIncluded: false,
      unboundedDiffsIncluded: false,
    });
  });
});
