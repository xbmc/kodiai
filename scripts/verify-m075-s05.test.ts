import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  DEFAULT_FIXTURE_PATH,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateEvidence,
  evaluateM075S05Contract,
  main,
  parseM075S05Args,
  type M075S05EvidenceSnapshot,
} from "./verify-m075-s05.ts";

function packageJson(script = EXPECTED_PACKAGE_SCRIPT): string {
  return JSON.stringify({ scripts: { [COMMAND_NAME]: script } });
}

const taxonomyText = [
  "review-timeout-classification.expected-bounded-outcome",
  "review-timeout-classification.hard-failure",
  "review-timeout-classification.long-run-threshold",
].join("\n");

async function fixture(overrides: (copy: any) => void = () => undefined): Promise<M075S05EvidenceSnapshot> {
  const loaded = await Bun.file(DEFAULT_FIXTURE_PATH).json() as M075S05EvidenceSnapshot;
  const copy = JSON.parse(JSON.stringify(loaded));
  overrides(copy);
  return copy as M075S05EvidenceSnapshot;
}

async function reportFor(copy: M075S05EvidenceSnapshot) {
  return evaluateM075S05Contract(parseM075S05Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
    readFileText: async () => JSON.stringify(copy),
    readPackageJsonText: async () => packageJson(),
    readTaxonomyText: async () => taxonomyText,
  });
}

describe("verify-m075-s05", () => {
  test("parses fixture-only CLI arguments and rejects unsafe inputs", () => {
    expect(parseM075S05Args([])).toEqual({ json: false, help: false });
    expect(parseM075S05Args(["--json", "--fixture", DEFAULT_FIXTURE_PATH])).toEqual({ json: true, help: false, fixturePath: DEFAULT_FIXTURE_PATH });
    expect(parseM075S05Args(["--help"])).toEqual({ json: false, help: true });
    expect(() => parseM075S05Args(["--live"])).toThrow(/fixture-only/);
    expect(() => parseM075S05Args(["--fixture", ".gsd/raw.json"])).toThrow(/must not read ignored/);
    expect(() => parseM075S05Args(["--fixture", "../raw.json"])).toThrow(/must not traverse/);
    expect(() => parseM075S05Args(["--fixture", "/tmp/raw.json"])).toThrow(/repo-relative/);
    expect(() => parseM075S05Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("fixture verification succeeds for bounded timeout classification evidence", async () => {
    const report = await evaluateM075S05Contract(parseM075S05Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      generatedAt: "2026-05-20T16:30:00.000Z",
      readPackageJsonText: async () => packageJson(),
      readTaxonomyText: async () => taxonomyText,
    });

    expect(report).toMatchObject({
      command: "verify:m075:s05",
      generatedAt: "2026-05-20T16:30:00.000Z",
      success: true,
      statusCode: "m075_s05_ok",
      fixturePath: DEFAULT_FIXTURE_PATH,
      observed: {
        scenarioCount: 8,
        modeCount: 8,
        expectedBoundedCount: 4,
        hardFailureCount: 4,
        actionableCount: 4,
      },
    });
    expect(report.failedCheckIds).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("RAW_PROMPT_CANARY");
    expect(JSON.stringify(report)).not.toContain("diff --git");
  });

  test("fails closed when required mode coverage is missing", async () => {
    const copy = await fixture((next) => {
      next.scenarios = next.scenarios.filter((scenario: any) => scenario.runtime.mode !== "retry-failed");
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("mode-coverage.present");
    expect(report.issues.join("\n")).toContain("retry-failed");
  });

  test("fails closed when reason codes are empty, unsafe, mismatched, or unbounded", async () => {
    const empty = await fixture((next) => {
      next.scenarios[0]!.runtime.reasonCodes = [];
      next.scenarios[0]!.log.reasonCodes = [];
    });
    const unsafe = await fixture((next) => {
      next.scenarios[0]!.runtime.reasonCodes = ["RAW_PROMPT_CANARY"];
      next.scenarios[0]!.log.reasonCodes = ["RAW_PROMPT_CANARY"];
    });
    const mismatch = await fixture((next) => {
      next.scenarios[0]!.log.reasonCodes = ["timeout"];
    });
    const unbounded = await fixture((next) => {
      next.scenarios[0]!.runtime.reasonCodes = Array.from({ length: 9 }, (_, index) => `reason-${index}`);
      next.scenarios[0]!.log.reasonCodes = Array.from({ length: 9 }, (_, index) => `reason-${index}`);
    });

    expect((await reportFor(empty)).failedCheckIds).toContain("reason-codes.safe");
    expect((await reportFor(unsafe)).failedCheckIds).toContain("reason-codes.safe");
    expect((await reportFor(mismatch)).failedCheckIds).toContain("reason-codes.safe");
    expect((await reportFor(unbounded)).failedCheckIds).toContain("reason-codes.safe");
  });

  test("fails closed for raw keys, raw canaries, secret-like values, and unsafe redaction flags without echoing raw values", async () => {
    const copy = await fixture((next) => {
      next.scenarios[0]!.runtime.redaction.rawPayloadOmitted = false;
      next.scenarios[0]!.runtime.redaction.boundedReasonCodes = false;
      (next.scenarios[0]!.telemetry as Record<string, unknown>).candidateBody = "SECRET_TOKEN_CANARY";
      (next.scenarios[0]!.log as Record<string, unknown>).message = "TOKEN=abc123 diff --git";
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("runtime-signals.present");
    expect(report.failedCheckIds).toContain("redaction.safe");
    expect(report.issues.join("\n")).toContain("forbidden raw key/value");
    expect(report.issues.join("\n")).not.toContain("SECRET_TOKEN_CANARY");
    expect(report.issues.join("\n")).not.toContain("TOKEN=abc123");
  });

  test("fails closed when telemetry or taxonomy mappings collapse bounded outcomes into ambiguous timeout noise", async () => {
    const boundedAsHardFailure = await fixture((next) => {
      next.scenarios[0]!.taxonomy.classId = "review-timeout-classification.hard-failure";
      next.scenarios[0]!.taxonomy.actionable = true;
    });
    const longRunWrongClass = await fixture((next) => {
      const scenario = next.scenarios.find((entry: any) => entry.runtime.mode === "long-run-threshold-exceeded")!;
      scenario.taxonomy.classId = "review-timeout-classification.hard-failure";
    });
    const telemetryDrift = await fixture((next) => {
      next.scenarios[0]!.telemetry.timeoutClassificationMode = "zero-evidence-hard-timeout";
    });

    expect((await reportFor(boundedAsHardFailure)).failedCheckIds).toContain("telemetry-taxonomy.present");
    expect((await reportFor(longRunWrongClass)).failedCheckIds).toContain("telemetry-taxonomy.present");
    expect((await reportFor(telemetryDrift)).failedCheckIds).toContain("telemetry-taxonomy.present");
  });

  test("fails closed when scenario output or issue output is unbounded", async () => {
    const copy = await fixture((next) => {
      next.scenarios = Array.from({ length: 17 }, (_, index) => ({
        ...JSON.parse(JSON.stringify(next.scenarios[0])),
        name: `scenario-${index}`,
      }));
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("mode-coverage.present");
    expect(report.failedCheckIds).toContain("output.bounded");
    expect(report.issues.length).toBeLessThanOrEqual(24);
    expect(report.issues.every((issue) => issue.length <= 240)).toBe(true);
  });

  test("package wiring, invalid JSON, unreadable fixture, taxonomy drift, and main invalid args fail safely", async () => {
    const drifted = await evaluateM075S05Contract(parseM075S05Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readPackageJsonText: async () => JSON.stringify({ scripts: {} }),
      readTaxonomyText: async () => taxonomyText,
    });
    const invalidJson = await evaluateM075S05Contract(parseM075S05Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readFileText: async () => "{not-json",
      readPackageJsonText: async () => packageJson(),
      readTaxonomyText: async () => taxonomyText,
    });
    const missing = await evaluateM075S05Contract(parseM075S05Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readFileText: async () => { throw new Error("missing"); },
      readPackageJsonText: async () => packageJson(),
      readTaxonomyText: async () => taxonomyText,
    });
    const missingTaxonomy = await evaluateM075S05Contract(parseM075S05Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readPackageJsonText: async () => packageJson(),
      readTaxonomyText: async () => "review.timeout-or-long-run",
    });

    expect(drifted.success).toBe(false);
    expect(drifted.failedCheckIds).toContain("package-wiring.present");
    expect(invalidJson.statusCode).toBe("m075_s05_invalid_json");
    expect(missing.statusCode).toBe("m075_s05_fixture_read_failed");
    expect(missingTaxonomy.failedCheckIds).toContain("telemetry-taxonomy.present");
    expect(await main(["--invalid"], { stdout: { write: () => undefined }, stderr: { write: () => undefined } })).toBe(2);
  });

  test("evaluateEvidence can be reused by later S07 aggregation", async () => {
    const copy = await fixture();
    const result = evaluateEvidence(copy, { id: "package-wiring.present", status: "pass", message: "ok", issues: [] }, taxonomyText);

    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
    expect(result.observed).toMatchObject({ scenarioCount: 8, modeCount: 8, actionableCount: 4 });
  });
});
