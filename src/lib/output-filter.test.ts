import { describe, expect, it } from "bun:test";
import {
  filterExternalClaims,
  formatSuppressedFindingsSection,
  type FilterableFinding,
} from "./output-filter.ts";
import type { FindingClaimClassification } from "./claim-classifier.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(
  overrides: Partial<FilterableFinding> & { title: string; commentId: number },
): FilterableFinding {
  return {
    severity: "medium",
    category: "correctness",
    filePath: "src/example.ts",
    ...overrides,
  };
}

function makeClassification(
  summaryLabel: FindingClaimClassification["summaryLabel"],
  claims: Array<{ text: string; label: "diff-grounded" | "external-knowledge" | "inferential"; evidence?: string }>,
): FindingClaimClassification {
  return {
    summaryLabel,
    claims: claims.map((c) => ({
      text: c.text,
      label: c.label,
      evidence: c.evidence,
      confidence: 0.9,
    })),
  };
}

// ---------------------------------------------------------------------------
// filterExternalClaims
// ---------------------------------------------------------------------------

describe("filterExternalClaims", () => {
  it("passes through primarily-diff-grounded findings unchanged", () => {
    const findings = [
      makeFinding({
        title: "This removes the old handler. The new handler uses streams.",
        commentId: 1,
        claimClassification: makeClassification("primarily-diff-grounded", [
          { text: "This removes the old handler.", label: "diff-grounded" },
          { text: "The new handler uses streams.", label: "diff-grounded" },
        ]),
      }),
    ];

    const result = filterExternalClaims(findings);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe("This removes the old handler. The new handler uses streams.");
    expect(result.rewriteCount).toBe(0);
    expect(result.suppressionCount).toBe(0);
    expect(result.filtered).toHaveLength(0);
  });

  it("suppresses primarily-external findings entirely", () => {
    const findings = [
      makeFinding({
        title: "Library X version 3.0 introduced a breaking change in the API.",
        commentId: 2,
        claimClassification: makeClassification("primarily-external", [
          {
            text: "Library X version 3.0 introduced a breaking change in the API.",
            label: "external-knowledge",
            evidence: "Version number not in diff",
          },
        ]),
      }),
    ];

    const result = filterExternalClaims(findings);
    expect(result.findings).toHaveLength(0);
    expect(result.suppressionCount).toBe(1);
    expect(result.rewriteCount).toBe(0);
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].action).toBe("suppressed");
    expect(result.filtered[0].originalTitle).toBe(
      "Library X version 3.0 introduced a breaking change in the API.",
    );
    expect(result.filtered[0].classificationEvidence).toContain("Version number not in diff");
  });

  it("rewrites mixed findings by removing external-knowledge sentences", () => {
    const findings = [
      makeFinding({
        title: "This adds a new dependency on libfoo. Libfoo version 2.0 was released last month and has known CVE issues. The import statement is correct.",
        commentId: 3,
        claimClassification: makeClassification("mixed", [
          { text: "This adds a new dependency on libfoo.", label: "diff-grounded" },
          {
            text: "Libfoo version 2.0 was released last month and has known CVE issues.",
            label: "external-knowledge",
            evidence: "Release date is external knowledge",
          },
          { text: "The import statement is correct.", label: "diff-grounded" },
        ]),
      }),
    ];

    const result = filterExternalClaims(findings);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toContain("This adds a new dependency on libfoo.");
    expect(result.findings[0].title).toContain("The import statement is correct.");
    expect(result.findings[0].title).not.toContain("Libfoo version 2.0");
    expect(result.findings[0].title).toContain("\u2139\uFE0F Some claims removed (unverifiable)");
    expect(result.rewriteCount).toBe(1);
    expect(result.suppressionCount).toBe(0);
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].action).toBe("rewritten");
    expect(result.filtered[0].rewrittenTitle).toBeDefined();
  });

  it("keeps inferential sentences in rewritten output", () => {
    const findings = [
      makeFinding({
        title: "This removes error handling around the database call. This could cause unhandled promise rejections at runtime. The library documentation says this is safe since version 4.0.",
        commentId: 4,
        claimClassification: makeClassification("mixed", [
          { text: "This removes error handling around the database call.", label: "diff-grounded" },
          { text: "This could cause unhandled promise rejections at runtime.", label: "inferential" },
          {
            text: "The library documentation says this is safe since version 4.0.",
            label: "external-knowledge",
            evidence: "Library behavior assertion",
          },
        ]),
      }),
    ];

    const result = filterExternalClaims(findings);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toContain("This removes error handling around the database call.");
    expect(result.findings[0].title).toContain("This could cause unhandled promise rejections at runtime.");
    expect(result.findings[0].title).not.toContain("The library documentation says");
  });

  it("suppresses mixed findings that become too short after rewriting", () => {
    const findings = [
      makeFinding({
        title: "Bad. The CVE-2024-1234 vulnerability was patched in version 3.2.1 which introduced a new API surface.",
        commentId: 5,
        claimClassification: makeClassification("mixed", [
          { text: "Bad.", label: "diff-grounded" },
          {
            text: "The CVE-2024-1234 vulnerability was patched in version 3.2.1 which introduced a new API surface.",
            label: "external-knowledge",
            evidence: "CVE reference",
          },
        ]),
      }),
    ];

    const result = filterExternalClaims(findings);
    expect(result.findings).toHaveLength(0);
    expect(result.suppressionCount).toBe(1);
    expect(result.rewriteCount).toBe(0);
    expect(result.filtered[0].action).toBe("suppressed");
  });

  it("passes through findings with no claimClassification (fail-open)", () => {
    const findings = [
      makeFinding({
        title: "Missing error handling in the callback.",
        commentId: 6,
      }),
    ];

    const result = filterExternalClaims(findings);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe("Missing error handling in the callback.");
    expect(result.rewriteCount).toBe(0);
    expect(result.suppressionCount).toBe(0);
  });

  it("passes through findings with empty claims array (fail-open)", () => {
    const findings = [
      makeFinding({
        title: "Some finding text here.",
        commentId: 7,
        claimClassification: { summaryLabel: "primarily-diff-grounded", claims: [] },
      }),
    ];

    const result = filterExternalClaims(findings);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe("Some finding text here.");
  });

  it("returns empty result for empty findings array", () => {
    const result = filterExternalClaims([]);
    expect(result.findings).toHaveLength(0);
    expect(result.filtered).toHaveLength(0);
    expect(result.rewriteCount).toBe(0);
    expect(result.suppressionCount).toBe(0);
  });

  it("handles multiple findings with mixed labels independently", () => {
    const findings = [
      makeFinding({
        title: "Good diff-grounded finding with enough words to pass the threshold easily.",
        commentId: 10,
        claimClassification: makeClassification("primarily-diff-grounded", [
          { text: "Good diff-grounded finding with enough words to pass the threshold easily.", label: "diff-grounded" },
        ]),
      }),
      makeFinding({
        title: "External knowledge claim about library behavior that is not in the diff.",
        commentId: 11,
        claimClassification: makeClassification("primarily-external", [
          {
            text: "External knowledge claim about library behavior that is not in the diff.",
            label: "external-knowledge",
            evidence: "Library behavior",
          },
        ]),
      }),
      makeFinding({
        title: "This changes the config format substantially. The old format was deprecated in version 2.0.",
        commentId: 12,
        claimClassification: makeClassification("mixed", [
          { text: "This changes the config format substantially.", label: "diff-grounded" },
          {
            text: "The old format was deprecated in version 2.0.",
            label: "external-knowledge",
            evidence: "Version reference",
          },
        ]),
      }),
    ];

    const result = filterExternalClaims(findings);
    // First finding passes through
    expect(result.findings.some((f) => f.commentId === 10)).toBe(true);
    // Second finding suppressed
    expect(result.findings.some((f) => f.commentId === 11)).toBe(false);
    // Third finding: "This changes the config format substantially." has 6 words — below 10-word threshold, so suppressed
    expect(result.findings.some((f) => f.commentId === 12)).toBe(false);
    expect(result.suppressionCount).toBe(2);
    expect(result.rewriteCount).toBe(0);
  });

  it("does not mutate input findings", () => {
    const original = makeFinding({
      title: "External claim about library version numbers and release dates.",
      commentId: 20,
      claimClassification: makeClassification("primarily-external", [
        {
          text: "External claim about library version numbers and release dates.",
          label: "external-knowledge",
        },
      ]),
    });
    const titleBefore = original.title;

    filterExternalClaims([original]);

    expect(original.title).toBe(titleBefore);
    expect(original.claimClassification?.summaryLabel).toBe("primarily-external");
  });

  it("calls logger.info for each suppressed/rewritten finding", () => {
    const logs: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const logger = {
      info: (obj: Record<string, unknown>, msg: string) => {
        logs.push({ obj, msg });
      },
    };

    const findings = [
      makeFinding({
        title: "External knowledge about API behavior.",
        commentId: 30,
        claimClassification: makeClassification("primarily-external", [
          { text: "External knowledge about API behavior.", label: "external-knowledge", evidence: "API behavior" },
        ]),
      }),
    ];

    filterExternalClaims(findings, logger);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].obj).toHaveProperty("commentId", 30);
    expect(logs[0].obj).toHaveProperty("action", "suppressed");
  });
});

// ---------------------------------------------------------------------------
// formatSuppressedFindingsSection
// ---------------------------------------------------------------------------

describe("formatSuppressedFindingsSection", () => {
  it("returns empty string when no suppressed findings", () => {
    const result = formatSuppressedFindingsSection([]);
    expect(result).toBe("");
  });

  it("returns empty string when only rewritten findings (no suppressed)", () => {
    const result = formatSuppressedFindingsSection([
      {
        commentId: 1,
        originalTitle: "Some rewritten finding",
        action: "rewritten",
        rewrittenTitle: "Rewritten version",
        reason: "External claims removed",
        classificationEvidence: ["evidence"],
      },
    ]);
    expect(result).toBe("");
  });

  it("returns collapsed details section for suppressed findings", () => {
    const result = formatSuppressedFindingsSection([
      {
        commentId: 1,
        originalTitle: "Library X has a known vulnerability in version 3.0",
        action: "suppressed",
        reason: "Finding primarily depends on external knowledge",
        classificationEvidence: ["Version number not in diff"],
      },
      {
        commentId: 2,
        originalTitle: "CVE-2024-5678 affects this dependency",
        action: "suppressed",
        reason: "CVE reference is external knowledge",
        classificationEvidence: ["CVE reference"],
      },
    ]);

    expect(result).toContain("<details>");
    expect(result).toContain("</details>");
    expect(result).toContain("Filtered findings");
    expect(result).toContain("2 findings removed");
    expect(result).toContain("Library X has a known vulnerability in version 3.0");
    expect(result).toContain("CVE-2024-5678 affects this dependency");
  });

  it("truncates long titles to 80 characters", () => {
    const longTitle = "A".repeat(120);
    const result = formatSuppressedFindingsSection([
      {
        commentId: 1,
        originalTitle: longTitle,
        action: "suppressed",
        reason: "External knowledge",
        classificationEvidence: [],
      },
    ]);

    // Should contain truncated title (80 chars + "...")
    expect(result).not.toContain(longTitle);
    expect(result).toContain("...");
  });
});
