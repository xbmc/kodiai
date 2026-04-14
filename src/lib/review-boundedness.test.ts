import { describe, expect, test } from "bun:test";

const LARGE_PR_DISCLOSURE = "Requested strict review; effective review remained strict and covered 50/60 changed files via large-PR triage (30 full, 20 abbreviated; 10 not reviewed).";
const TIMEOUT_REDUCED_DISCLOSURE = "Requested strict review; timeout risk auto-reduced the effective review to minimal and covered 50/60 changed files via large-PR triage (30 full, 20 abbreviated; 10 not reviewed).";

async function loadReviewBoundednessModule() {
  return await import("./review-boundedness.ts").catch(() => null);
}

describe("resolveReviewBoundedness", () => {
  test("captures large-PR strict boundedness with one exact disclosure sentence", async () => {
    const mod = await loadReviewBoundednessModule();

    expect(mod).not.toBeNull();

    const contract = mod!.resolveReviewBoundedness({
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
      largePRTriage: {
        fullCount: 30,
        abbreviatedCount: 20,
        totalFiles: 60,
      },
      timeout: {
        riskLevel: "high",
        dynamicTimeoutSeconds: 900,
        shouldReduceScope: true,
        reductionApplied: false,
        reductionSkippedReason: "explicit-profile",
      },
    });

    expect(contract).not.toBeNull();
    expect(contract?.disclosureRequired).toBe(true);
    expect(contract?.disclosureSentence).toBe(LARGE_PR_DISCLOSURE);
    expect(contract?.reasonCodes).toEqual([
      "large-pr-triage",
      "timeout-auto-reduction-skipped-explicit-profile",
    ]);
    expect(contract?.largePR).toEqual({
      fullCount: 30,
      abbreviatedCount: 20,
      reviewedCount: 50,
      totalFiles: 60,
      notReviewedCount: 10,
    });
  });

  test("captures timeout auto-reduction with requested versus effective profile truth", async () => {
    const mod = await loadReviewBoundednessModule();

    expect(mod).not.toBeNull();

    const contract = mod!.resolveReviewBoundedness({
      requestedProfile: {
        selectedProfile: "strict",
        source: "auto",
        autoBand: "small",
        linesChanged: 100,
      },
      effectiveProfile: {
        selectedProfile: "minimal",
        source: "auto",
        autoBand: "small",
        linesChanged: 100,
      },
      largePRTriage: {
        fullCount: 30,
        abbreviatedCount: 20,
        totalFiles: 60,
      },
      timeout: {
        riskLevel: "high",
        dynamicTimeoutSeconds: 900,
        shouldReduceScope: true,
        reductionApplied: true,
        reductionSkippedReason: null,
      },
    });

    expect(contract).not.toBeNull();
    expect(contract?.disclosureRequired).toBe(true);
    expect(contract?.disclosureSentence).toBe(TIMEOUT_REDUCED_DISCLOSURE);
    expect(contract?.reasonCodes).toEqual([
      "large-pr-triage",
      "timeout-auto-reduced",
    ]);
    expect(contract?.timeout?.reductionApplied).toBe(true);
  });

  test("keeps small unbounded reviews silent", async () => {
    const mod = await loadReviewBoundednessModule();

    expect(mod).not.toBeNull();

    const contract = mod!.resolveReviewBoundedness({
      requestedProfile: {
        selectedProfile: "strict",
        source: "auto",
        autoBand: "small",
        linesChanged: 80,
      },
      effectiveProfile: {
        selectedProfile: "strict",
        source: "auto",
        autoBand: "small",
        linesChanged: 80,
      },
      largePRTriage: null,
      timeout: {
        riskLevel: "low",
        dynamicTimeoutSeconds: 600,
        shouldReduceScope: false,
        reductionApplied: false,
        reductionSkippedReason: null,
      },
    });

    expect(contract).not.toBeNull();
    expect(contract?.disclosureRequired).toBe(false);
    expect(contract?.disclosureSentence).toBeNull();
    expect(contract?.reasonCodes).toEqual([]);
  });

  test("fails open when requested or effective profile data is missing", async () => {
    const mod = await loadReviewBoundednessModule();

    expect(mod).not.toBeNull();

    const contract = mod!.resolveReviewBoundedness({
      requestedProfile: null,
      effectiveProfile: {
        selectedProfile: "strict",
        source: "auto",
        autoBand: "small",
        linesChanged: 80,
      },
      largePRTriage: {
        fullCount: 30,
        abbreviatedCount: 20,
        totalFiles: 60,
      },
      timeout: null,
    });

    expect(contract).toBeNull();
  });
});

describe("ensureReviewBoundednessDisclosureInSummary", () => {
  test("injects the disclosure sentence into ## What Changed exactly once", async () => {
    const mod = await loadReviewBoundednessModule();

    expect(mod).not.toBeNull();

    const contract = mod!.resolveReviewBoundedness({
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
      largePRTriage: {
        fullCount: 30,
        abbreviatedCount: 20,
        totalFiles: 60,
      },
      timeout: {
        riskLevel: "high",
        dynamicTimeoutSeconds: 900,
        shouldReduceScope: true,
        reductionApplied: false,
        reductionSkippedReason: "explicit-profile",
      },
    });

    const summaryBody = [
      "<details>",
      "<summary>Kodiai Review Summary</summary>",
      "",
      "## What Changed",
      "- Reviewed the changed files.",
      "",
      "## Observations",
      "- [MAJOR] src/review.ts (42): Something broke.",
      "",
      "</details>",
    ].join("\n");

    const updated = mod!.ensureReviewBoundednessDisclosureInSummary(summaryBody, contract);

    expect(updated).toContain(`- ${LARGE_PR_DISCLOSURE}`);
    expect(updated.indexOf(`- ${LARGE_PR_DISCLOSURE}`)).toBeGreaterThan(updated.indexOf("## What Changed"));
    expect(updated.indexOf(`- ${LARGE_PR_DISCLOSURE}`)).toBeLessThan(updated.indexOf("## Observations"));
    const disclosureCount = (updated.match(/Requested strict review; effective review remained strict and covered 50\/60 changed files via large-PR triage \(30 full, 20 abbreviated; 10 not reviewed\)\./g) ?? []).length;
    expect(disclosureCount).toBe(1);
  });

  test("does not duplicate an existing disclosure sentence and fails quietly on malformed summaries", async () => {
    const mod = await loadReviewBoundednessModule();

    expect(mod).not.toBeNull();

    const contract = mod!.resolveReviewBoundedness({
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
      largePRTriage: {
        fullCount: 30,
        abbreviatedCount: 20,
        totalFiles: 60,
      },
      timeout: {
        riskLevel: "high",
        dynamicTimeoutSeconds: 900,
        shouldReduceScope: true,
        reductionApplied: false,
        reductionSkippedReason: "explicit-profile",
      },
    });

    const alreadyDisclosed = [
      "<details>",
      "<summary>Kodiai Review Summary</summary>",
      "",
      "## What Changed",
      `- ${LARGE_PR_DISCLOSURE}`,
      "",
      "## Observations",
      "- [MAJOR] src/review.ts (42): Something broke.",
      "",
      "</details>",
    ].join("\n");

    const unchanged = mod!.ensureReviewBoundednessDisclosureInSummary(alreadyDisclosed, contract);
    const disclosureCount = (unchanged.match(/Requested strict review; effective review remained strict and covered 50\/60 changed files via large-PR triage \(30 full, 20 abbreviated; 10 not reviewed\)\./g) ?? []).length;
    expect(disclosureCount).toBe(1);

    const malformed = [
      "<details>",
      "<summary>Kodiai Review Summary</summary>",
      "",
      "## Observations",
      "- [MAJOR] src/review.ts (42): Something broke.",
      "",
      "</details>",
    ].join("\n");

    expect(mod!.ensureReviewBoundednessDisclosureInSummary(malformed, contract)).toBe(malformed);
  });
});
