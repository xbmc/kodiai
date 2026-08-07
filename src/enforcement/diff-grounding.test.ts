import { describe, expect, it } from "bun:test";
import {
  buildDiffGroundingIndex,
  enforceDiffGrounding,
  isDiffTruncated,
  DIFF_GROUNDING_DOWNGRADE_TARGET,
} from "./diff-grounding.ts";
import type { FindingSeverity } from "../knowledge/types.ts";
import type { GateAdjustedFinding } from "./gate-outcome.ts";

/** Read this gate's recorded outcome off a result finding. */
function outcome(result: GateAdjustedFinding | undefined) {
  const o = result?.gateOutcomes?.find((entry) => entry.gate === "diff-grounding");
  return {
    checked: o?.checked,
    verified: o?.verified,
    downgraded: o?.from !== undefined,
    reason: o?.reason,
    from: o?.from,
  };
}

// A realistic unified diff hunk touching src/foo.cpp lines 10-13 (post-change
// numbering), with one leading context line at 9.
const SAMPLE_DIFF = [
  "diff --git a/src/foo.cpp b/src/foo.cpp",
  "index 1111111..2222222 100644",
  "--- a/src/foo.cpp",
  "+++ b/src/foo.cpp",
  "@@ -8,3 +9,5 @@ void Foo::Bar()",
  " context line 9",
  "+added line 10",
  "+added line 11",
  " context line 12",
  " context line 13",
].join("\n");

function makeFinding(overrides: {
  filePath: string;
  severity: FindingSeverity;
  startLine?: number;
  endLine?: number;
}) {
  return {
    filePath: overrides.filePath,
    severity: overrides.severity,
    ...(overrides.startLine !== undefined ? { startLine: overrides.startLine } : {}),
    ...(overrides.endLine !== undefined ? { endLine: overrides.endLine } : {}),
  };
}

// ---------------------------------------------------------------------------
// buildDiffGroundingIndex
// ---------------------------------------------------------------------------
describe("buildDiffGroundingIndex", () => {
  it("indexes context and added lines for a file touched by the diff", () => {
    const index = buildDiffGroundingIndex(SAMPLE_DIFF);
    const lines = index.get("src/foo.cpp");
    expect(lines).toBeDefined();
    expect(lines?.has(9)).toBe(true);
    expect(lines?.has(10)).toBe(true);
    expect(lines?.has(11)).toBe(true);
    expect(lines?.has(12)).toBe(true);
    expect(lines?.has(13)).toBe(true);
    expect(lines?.has(14)).toBe(false);
  });

  it("returns an empty index for empty/missing diff text", () => {
    expect(buildDiffGroundingIndex("").size).toBe(0);
    expect(buildDiffGroundingIndex(null).size).toBe(0);
    expect(buildDiffGroundingIndex(undefined).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// enforceDiffGrounding
// ---------------------------------------------------------------------------
describe("enforceDiffGrounding", () => {
  it("passes through a critical finding whose line is inside the diff hunk", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 10, endLine: 10 })],
      diffLineIndex,
    });
    expect(result?.severity).toBe("critical");
    expect(outcome(result).checked).toBe(true);
    expect(outcome(result).verified).toBe(true);
    expect(outcome(result).downgraded).toBe(false);
    expect(outcome(result).reason).toBe("grounded");
  });

  it("passes through a critical finding whose full range is inside the diff hunk", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "major", startLine: 10, endLine: 12 })],
      diffLineIndex,
    });
    expect(result?.severity).toBe("major");
    expect(outcome(result).downgraded).toBe(false);
  });

  it("downgrades a critical finding whose cited line is outside every hunk in its file", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 500, endLine: 500 })],
      diffLineIndex,
    });
    expect(result?.severity).toBe(DIFF_GROUNDING_DOWNGRADE_TARGET);
    expect(outcome(result).from).toBe("critical");
    expect(outcome(result).checked).toBe(true);
    expect(outcome(result).verified).toBe(false);
    expect(outcome(result).downgraded).toBe(true);
    expect(outcome(result).reason).toBe("line-outside-diff");
  });

  it("keeps a major finding whose range partially spills outside the hunk", () => {
    // A finding about a whole function legitimately spans past the hunk that
    // changed it -- the trailing lines are unchanged context the diff never
    // carried. One diff-visible line in the range proves the citation is real,
    // so this must not be treated as a fabricated citation.
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "major", startLine: 12, endLine: 20 })],
      diffLineIndex,
    });
    expect(result?.severity).toBe("major");
    expect(outcome(result).downgraded).toBe(false);
    expect(outcome(result).reason).toBe("grounded");
  });

  it("checks a single-line citation where GitHub supplied only endLine (start_line: null)", () => {
    // extractFindingsFromReviewComments maps GitHub's null start_line to
    // undefined, so most real findings arrive endLine-only. Requiring both
    // bounds silently skipped the gate for exactly those.
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: undefined, endLine: 500 })],
      diffLineIndex,
    });
    expect(outcome(result).checked).toBe(true);
    expect(outcome(result).reason).toBe("line-outside-diff");
    expect(result?.severity).toBe(DIFF_GROUNDING_DOWNGRADE_TARGET);
  });

  it("grounds an endLine-only citation that does fall inside a hunk", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: undefined, endLine: 10 })],
      diffLineIndex,
    });
    expect(outcome(result).reason).toBe("grounded");
    expect(result?.severity).toBe("critical");
  });

  it("fails open when the collected diff was truncated (a missing line proves nothing)", () => {
    const truncatedDiff = `${SAMPLE_DIFF}\n[Full diff truncated at 2097152 bytes]\n`;
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 500, endLine: 500 })],
      diffLineIndex: buildDiffGroundingIndex(truncatedDiff),
      diffTruncated: isDiffTruncated(truncatedDiff),
    });
    expect(result?.severity).toBe("critical");
    expect(outcome(result).downgraded).toBe(false);
    expect(outcome(result).reason).toBe("diff-truncated");
  });

  it("fails open on a finding citing a file that never appears in the diff (ambiguous, not necessarily hallucinated)", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/other.cpp", severity: "critical", startLine: 5, endLine: 5 })],
      diffLineIndex,
    });
    expect(outcome(result).downgraded).toBe(false);
    expect(outcome(result).reason).toBe("file-not-in-diff");
    expect(result?.severity).toBe("critical");
  });

  it("never drops a finding -- downgraded findings remain in the output array", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const result = enforceDiffGrounding({
      findings: [
        makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 10, endLine: 10 }),
        makeFinding({ filePath: "src/other.cpp", severity: "critical", startLine: 5, endLine: 5 }),
      ],
      diffLineIndex,
    });
    expect(result).toHaveLength(2);
  });

  it("does not check minor/medium findings (leaves them ungrounded but unchanged)", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/other.cpp", severity: "minor", startLine: 999, endLine: 999 })],
      diffLineIndex,
    });
    expect(result?.severity).toBe("minor");
    expect(outcome(result).checked).toBe(false);
    expect(outcome(result).downgraded).toBe(false);
    expect(outcome(result).reason).toBe("not-applicable");
  });

  it("does not check findings without an explicit line citation", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/other.cpp", severity: "critical" })],
      diffLineIndex,
    });
    expect(result?.severity).toBe("critical");
    expect(outcome(result).checked).toBe(false);
    expect(outcome(result).reason).toBe("not-applicable");
  });

  it("fails open (never downgrades) when no diff text was collected for the review", () => {
    const diffLineIndex = buildDiffGroundingIndex(undefined);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 999, endLine: 999 })],
      diffLineIndex,
    });
    expect(result?.severity).toBe("critical");
    expect(outcome(result).checked).toBe(false);
    expect(outcome(result).verified).toBe(true);
    expect(outcome(result).downgraded).toBe(false);
    expect(outcome(result).reason).toBe("no-diff-available");
  });

  it("treats startLine-only citations as a single-line range", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 11 })],
      diffLineIndex,
    });
    expect(outcome(result).downgraded).toBe(false);
    expect(outcome(result).reason).toBe("grounded");
  });

  it("preserves unrelated finding fields", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [{
        filePath: "src/other.cpp",
        severity: "critical" as FindingSeverity,
        startLine: 5,
        endLine: 5,
        title: "Some finding",
        category: "correctness",
      }],
      diffLineIndex,
    });
    expect(result?.title).toBe("Some finding");
    expect(result?.category).toBe("correctness");
  });
});
