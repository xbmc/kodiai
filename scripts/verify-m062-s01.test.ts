import { describe, expect, test } from "bun:test";
import type { ReviewFirstPassPayload } from "../src/lib/review-first-pass.ts";
import { buildReviewOutputKey } from "../src/review-orchestration/review-idempotency.ts";

type JsonReport = {
  command: string;
  generated_at: string;
  scenario_count: number;
  success: boolean;
  status_code: string;
  scenarios: Array<{
    scenarioId: string;
    statusCode: string;
    success: boolean;
    reviewOutputKey: string | null;
    state: ReviewFirstPassPayload["state"] | null;
    boundedReason: ReviewFirstPassPayload["boundedReason"] | null;
    evidenceSource: ReviewFirstPassPayload["evidenceSource"] | null;
    publicationEligible: boolean | null;
    hasPublishedOutput: boolean | null;
    coveredFiles: number | null;
    remainingFiles: number | null;
  }>;
  issues: string[];
};

function makeReviewOutputKey(deliveryId: string) {
  return buildReviewOutputKey({
    installationId: 42,
    owner: "acme",
    repo: "repo",
    prNumber: 101,
    action: "review_requested",
    deliveryId,
    headSha: "abc123",
  });
}

async function loadModule() {
  return await import("./verify-m062-s01.ts");
}

describe("verify-m062-s01", () => {
  test("parse args accepts --json and optional --scenario", async () => {
    const { parseVerifyM062S01Args } = await loadModule();

    expect(parseVerifyM062S01Args(["--scenario", "timeout-checkpoint", "--json"]))
      .toEqual({ help: false, json: true, scenarioId: "timeout-checkpoint" });
  });

  test("evaluate default matrix classifies bounded first-pass scenarios and zero-evidence failure distinctly", async () => {
    const { evaluateM062S01 } = await loadModule();

    const report = evaluateM062S01({ generatedAt: "2026-04-24T03:00:00.000Z" });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m062_s01_ok");
    expect(report.scenario_count).toBe(4);
    expect(report.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "timeout-checkpoint",
      "max-turns-checkpoint",
      "large-pr-bounded",
      "zero-evidence-failure",
    ]);
    expect(report.scenarios.map((scenario) => scenario.statusCode)).toEqual([
      "bounded-first-pass",
      "bounded-first-pass",
      "bounded-first-pass",
      "dead-end-failure",
    ]);
  });

  test("scenario records expose stable observability fields for reason, evidence, coverage, and publication", async () => {
    const { evaluateM062S01 } = await loadModule();

    const report = evaluateM062S01({ generatedAt: "2026-04-24T03:00:00.000Z" });
    const timeoutScenario = report.scenarios[0]!;
    const zeroEvidenceScenario = report.scenarios[3]!;

    expect(timeoutScenario).toMatchObject({
      scenarioId: "timeout-checkpoint",
      statusCode: "bounded-first-pass",
      boundedReason: "timeout",
      evidenceSource: "checkpoint",
      publicationEligible: true,
      hasPublishedOutput: false,
      coveredFiles: 2,
      remainingFiles: 3,
    });

    expect(zeroEvidenceScenario).toMatchObject({
      scenarioId: "zero-evidence-failure",
      statusCode: "dead-end-failure",
      boundedReason: "max-turns",
      evidenceSource: "none",
      publicationEligible: false,
      hasPublishedOutput: false,
      coveredFiles: null,
      remainingFiles: null,
    });
  });

  test("evaluateScenario reports invalid payload for unknown bounded reason", async () => {
    const { evaluateScenario } = await loadModule();

    const result = evaluateScenario({
      scenarioId: "invalid-bounded-reason",
      checkpoint: null,
      boundedness: null,
      outcome: {
        conclusion: "failure",
        stopReason: "max_turns",
        published: false,
      },
      reviewOutputKey: makeReviewOutputKey("delivery-invalid-reason"),
      mutateNormalizedPayload: (payload) => ({
        ...(payload as ReviewFirstPassPayload),
        boundedReason: "bogus-reason" as ReviewFirstPassPayload["boundedReason"],
      }),
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("invalid-payload");
    expect(result.issues).toContain("Invalid bounded reason in normalized payload.");
  });

  test("evaluateScenario reports invalid payload for inconsistent coverage counts", async () => {
    const { evaluateScenario } = await loadModule();

    const result = evaluateScenario({
      scenarioId: "invalid-coverage",
      checkpoint: {
        reviewOutputKey: makeReviewOutputKey("delivery-invalid-coverage"),
        repo: "acme/repo",
        prNumber: 101,
        filesReviewed: ["a.ts", "b.ts"],
        findingCount: 1,
        summaryDraft: "draft",
        totalFiles: 5,
      },
      boundedness: null,
      outcome: {
        conclusion: "failure",
        isTimeout: true,
        published: false,
      },
      reviewOutputKey: makeReviewOutputKey("delivery-invalid-coverage"),
      mutateNormalizedPayload: (payload) => ({
        ...(payload as ReviewFirstPassPayload),
        coveredScope: { reviewedFiles: 6, totalFiles: 5 },
        remainingScope: { remainingFiles: 0, totalFiles: 5 },
      }),
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("invalid-payload");
    expect(result.issues).toContain("Covered/remaining scope counts are inconsistent.");
  });

  test("evaluateScenario reports invalid payload for missing review output identity", async () => {
    const { evaluateScenario } = await loadModule();

    const result = evaluateScenario({
      scenarioId: "missing-review-output-key",
      checkpoint: null,
      boundedness: {
        requestedProfile: { selectedProfile: "minimal", source: "auto", autoBand: "large", linesChanged: 240 },
        effectiveProfile: { selectedProfile: "minimal", source: "auto", autoBand: "large", linesChanged: 240 },
        reasonCodes: ["large-pr-triage"],
        disclosureRequired: true,
        disclosureSentence: "Requested minimal review; effective review remained minimal and covered 2/5 changed files via large-PR triage (1 full, 1 abbreviated; 3 not reviewed).",
        largePR: {
          fullCount: 1,
          abbreviatedCount: 1,
          reviewedCount: 2,
          totalFiles: 5,
          notReviewedCount: 3,
        },
        timeout: null,
      },
      outcome: {
        conclusion: "success",
        published: true,
      },
      reviewOutputKey: null,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("invalid-payload");
    expect(result.issues).toContain("Missing review output identity.");
  });

  test("render report keeps human-readable bounded versus dead-end classification stable", async () => {
    const { evaluateM062S01, renderM062S01Report } = await loadModule();

    const report = evaluateM062S01({ generatedAt: "2026-04-24T03:00:00.000Z" });
    const human = renderM062S01Report(report);

    expect(human).toContain("# M062 S01 — Bounded First-Pass Verifier");
    expect(human).toContain("Status: m062_s01_ok");
    expect(human).toContain("timeout-checkpoint: bounded-first-pass");
    expect(human).toContain("max-turns-checkpoint: bounded-first-pass");
    expect(human).toContain("large-pr-bounded: bounded-first-pass");
    expect(human).toContain("zero-evidence-failure: dead-end-failure");
  });

  test("main emits json for the default matrix", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const exitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: (chunk: string) => void stderrChunks.push(chunk) },
    });

    const report = JSON.parse(stdoutChunks.join("")) as JsonReport;
    expect(exitCode).toBe(0);
    expect(stderrChunks).toEqual([]);
    expect(report.status_code).toBe("m062_s01_ok");
    expect(report.scenario_count).toBe(4);
  });

  test("main rejects unknown scenario ids with a named invalid-arg status", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];

    const exitCode = await main(["--scenario", "not-real", "--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: () => undefined },
    });

    const report = JSON.parse(stdoutChunks.join("")) as JsonReport;
    expect(exitCode).toBe(1);
    expect(report.status_code).toBe("m062_s01_invalid_arg");
    expect(report.issues).toContain("Unknown scenario id: not-real.");
  });

  test("main can target a single scenario for deterministic drift checks", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];

    const exitCode = await main(["--scenario", "large-pr-bounded", "--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: () => undefined },
    });

    const report = JSON.parse(stdoutChunks.join("")) as JsonReport;
    expect(exitCode).toBe(0);
    expect(report.scenario_count).toBe(1);
    expect(report.scenarios[0]?.scenarioId).toBe("large-pr-bounded");
    expect(report.scenarios[0]?.statusCode).toBe("bounded-first-pass");
  });

  test("package.json wires verify:m062:s01 to the verifier script", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m062:s01"]).toBe("bun scripts/verify-m062-s01.ts");
  });
});
