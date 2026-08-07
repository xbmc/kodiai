import { describe, expect, it } from "bun:test";
import {
  buildDiffGroundingIndex,
  enforceDiffGrounding,
  isDiffTruncated,
  DIFF_GROUNDING_DOWNGRADE_TARGET,
} from "./diff-grounding.ts";
import type { FindingSeverity } from "../knowledge/types.ts";

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
    expect(result?.groundingChecked).toBe(true);
    expect(result?.groundingVerified).toBe(true);
    expect(result?.groundingDowngraded).toBe(false);
    expect(result?.groundingReason).toBe("grounded");
  });

  it("passes through a critical finding whose full range is inside the diff hunk", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "major", startLine: 10, endLine: 12 })],
      diffLineIndex,
    });
    expect(result?.severity).toBe("major");
    expect(result?.groundingDowngraded).toBe(false);
  });

  it("downgrades a critical finding whose cited line is outside every hunk in its file", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 500, endLine: 500 })],
      diffLineIndex,
    });
    expect(result?.severity).toBe(DIFF_GROUNDING_DOWNGRADE_TARGET);
    expect(result?.preGroundingSeverity).toBe("critical");
    expect(result?.groundingChecked).toBe(true);
    expect(result?.groundingVerified).toBe(false);
    expect(result?.groundingDowngraded).toBe(true);
    expect(result?.groundingReason).toBe("line-outside-diff");
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
    expect(result?.groundingDowngraded).toBe(false);
    expect(result?.groundingReason).toBe("grounded");
  });

  it("fails open when the collected diff was truncated (a missing line proves nothing)", () => {
    const truncatedDiff = `${SAMPLE_DIFF}\n[Full diff truncated at 2097152 bytes]\n`;
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 500, endLine: 500 })],
      diffLineIndex: buildDiffGroundingIndex(truncatedDiff),
      diffTruncated: isDiffTruncated(truncatedDiff),
    });
    expect(result?.severity).toBe("critical");
    expect(result?.groundingDowngraded).toBe(false);
    expect(result?.groundingReason).toBe("diff-truncated");
  });

  it("fails open on a finding citing a file that never appears in the diff (ambiguous, not necessarily hallucinated)", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/other.cpp", severity: "critical", startLine: 5, endLine: 5 })],
      diffLineIndex,
    });
    expect(result?.groundingDowngraded).toBe(false);
    expect(result?.groundingReason).toBe("file-not-in-diff");
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
    expect(result?.groundingChecked).toBe(false);
    expect(result?.groundingDowngraded).toBe(false);
    expect(result?.groundingReason).toBe("not-applicable");
  });

  it("does not check findings without an explicit line citation", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/other.cpp", severity: "critical" })],
      diffLineIndex,
    });
    expect(result?.severity).toBe("critical");
    expect(result?.groundingChecked).toBe(false);
    expect(result?.groundingReason).toBe("not-applicable");
  });

  it("fails open (never downgrades) when no diff text was collected for the review", () => {
    const diffLineIndex = buildDiffGroundingIndex(undefined);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 999, endLine: 999 })],
      diffLineIndex,
    });
    expect(result?.severity).toBe("critical");
    expect(result?.groundingChecked).toBe(false);
    expect(result?.groundingVerified).toBe(true);
    expect(result?.groundingDowngraded).toBe(false);
    expect(result?.groundingReason).toBe("no-diff-available");
  });

  it("treats startLine-only citations as a single-line range", () => {
    const diffLineIndex = buildDiffGroundingIndex(SAMPLE_DIFF);
    const [result] = enforceDiffGrounding({
      findings: [makeFinding({ filePath: "src/foo.cpp", severity: "critical", startLine: 11 })],
      diffLineIndex,
    });
    expect(result?.groundingDowngraded).toBe(false);
    expect(result?.groundingReason).toBe("grounded");
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
