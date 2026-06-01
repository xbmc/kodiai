import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CHECK_REVIEW_DETAILS_ARCHITECTURE_IDS,
  evaluateReviewDetailsArchitecture,
  renderReviewDetailsArchitectureReport,
} from "./check-review-details-architecture.ts";

describe("check review details architecture", () => {
  test("passes when candidate formatters are split and assembly stays section-oriented", () => {
    const report = evaluateReviewDetailsArchitecture({
      files: {
        "src/lib/review-details-candidate-formatting.ts": [
          "export { formatReviewCandidateFindingDetailsLine } from './review-details-candidate-finding-formatting.ts';",
          "export { formatReviewCandidatePublicationDetailsLine } from './review-details-candidate-publication-formatting.ts';",
          "export { formatCandidatePublicationBridgeLine } from './review-details-candidate-bridge-formatting.ts';",
          "export { formatCandidateVerificationPublicationEvidenceLine } from './review-details-candidate-verification-formatting.ts';",
        ].join("\n"),
        "src/lib/review-details-candidate-publication-formatting.ts": [
          "import type { ReviewCandidatePublicationRuntimeDetailsSummary } from '../review-orchestration/review-candidate-publication-runtime.ts';",
          "export function formatReviewCandidatePublicationDetailsLine(summary?: ReviewCandidatePublicationRuntimeDetailsSummary | null) {",
          "  return summary ? [] : [];",
          "}",
        ].join("\n"),
        "src/lib/review-details-formatting.ts": [
          "function formatCoreReviewDetailsSection() { return []; }",
          "function formatPublicationDiagnosticsSection() { return []; }",
          "function formatLargePrTriageSection() { return []; }",
          "export function formatReviewDetailsSummary() {",
          "  return [",
          "    ...formatPublicationDiagnosticsSection(),",
          "    ...formatCoreReviewDetailsSection(),",
          "    ...formatLargePrTriageSection(),",
          "  ].join('\\n');",
          "}",
        ].join("\n"),
      },
      generatedAt: "2026-06-01T15:50:00.000Z",
    });

    expect(report.check_ids).toEqual(CHECK_REVIEW_DETAILS_ARCHITECTURE_IDS);
    expect(report.overallPassed).toBe(true);
    expect(renderReviewDetailsArchitectureReport(report)).toContain("Review Details architecture gate: PASS");
  });

  test("fails with stable check ids when ownership collapses back into ad hoc formatting", () => {
    const report = evaluateReviewDetailsArchitecture({
      files: {
        "src/lib/review-details-candidate-formatting.ts": "function formatCandidatePublicationBridgeLine() {}",
        "src/lib/review-details-candidate-publication-formatting.ts": "const record = value as Record<string, unknown>;",
        "src/lib/review-details-formatting.ts": "export function formatReviewDetailsSummary() { if (largePRTriage.mentionOnlyFiles.length) return ''; }",
      },
      generatedAt: "2026-06-01T15:50:00.000Z",
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({ id: "CANDIDATE-FORMATTER-OWNERSHIP", passed: false }),
      expect.objectContaining({ id: "TYPED-CANDIDATE-PUBLICATION", passed: false }),
      expect.objectContaining({ id: "SECTION-ORIENTED-ASSEMBLY", passed: false }),
    ]);
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["check:review-details-architecture"]).toBe(
      "bun scripts/check-review-details-architecture.ts",
    );
  });
});
