import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("Review Details formatter architecture", () => {
  test("keeps candidate detail formatters split by ownership", async () => {
    const files = await Promise.all([
      Bun.file("src/lib/review-details-candidate-finding-formatting.ts").exists(),
      Bun.file("src/lib/review-details-candidate-publication-formatting.ts").exists(),
      Bun.file("src/lib/review-details-candidate-bridge-formatting.ts").exists(),
      Bun.file("src/lib/review-details-candidate-verification-formatting.ts").exists(),
    ]);

    expect(files).toEqual([true, true, true, true]);

    const candidateAggregator = await source("src/lib/review-details-candidate-formatting.ts");
    expect(candidateAggregator).not.toContain("function formatCandidatePublicationBridgeLine");
    expect(candidateAggregator).not.toContain("function formatCandidateVerificationPublicationEvidenceLine");
  });

  test("formats candidate publication summaries from the typed public model", async () => {
    const publicationFormatter = await source("src/lib/review-details-candidate-publication-formatting.ts");

    expect(publicationFormatter).not.toContain("Record<");
    expect(publicationFormatter).not.toContain(" as ");
    expect(publicationFormatter).not.toMatch(/\bunknown\b(?!-safe-reason)/);
  });

  test("keeps final Review Details assembly as section orchestration", async () => {
    const formatter = await source("src/lib/review-details-formatting.ts");

    expect(formatter).toContain("formatCoreReviewDetailsSection");
    expect(formatter).toContain("formatLargePrTriageSection");
    expect(formatter).toContain("formatPublicationDiagnosticsSection");
    expect(formatter).not.toContain("largePRTriage.mentionOnlyFiles.length");
  });
});
