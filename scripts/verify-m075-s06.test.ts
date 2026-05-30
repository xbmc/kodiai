import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  DEFAULT_FIXTURE_PATH,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateEvidence,
  evaluateM075S06Contract,
  main,
  parseM075S06Args,
  type M075S06EvidenceSnapshot,
} from "./verify-m075-s06.ts";

function packageJson(script = EXPECTED_PACKAGE_SCRIPT): string {
  return JSON.stringify({ scripts: { [COMMAND_NAME]: script } });
}

const taxonomyText = [
  "addon-check-classification.expected-bounded-outcome",
  "addon-check-classification.actionable-diagnostic",
  "addon-check-classification.malformed-evidence",
  "addon-check.timeout",
  "classifyStructuredAddonCheck",
].join("\n");

async function fixture(overrides: (copy: M075S06EvidenceSnapshot) => void = () => undefined): Promise<M075S06EvidenceSnapshot> {
  const loaded = await Bun.file(DEFAULT_FIXTURE_PATH).json() as M075S06EvidenceSnapshot;
  const copy = JSON.parse(JSON.stringify(loaded)) as M075S06EvidenceSnapshot;
  overrides(copy);
  return copy;
}

async function reportFor(copy: M075S06EvidenceSnapshot) {
  return evaluateM075S06Contract(parseM075S06Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
    readFileText: async () => JSON.stringify(copy),
    readPackageJsonText: async () => packageJson(),
    readTaxonomyText: async () => taxonomyText,
  });
}

describe("verify-m075-s06", () => {
  test("parses fixture-only CLI arguments and rejects unsafe inputs", () => {
    expect(parseM075S06Args([])).toEqual({ json: false, help: false });
    expect(parseM075S06Args(["--json", "--fixture", DEFAULT_FIXTURE_PATH])).toEqual({ json: true, help: false, fixturePath: DEFAULT_FIXTURE_PATH });
    expect(parseM075S06Args(["--help"])).toEqual({ json: false, help: true });
    expect(() => parseM075S06Args(["--live"])).toThrow(/fixture-only/);
    expect(() => parseM075S06Args(["--fixture", ".gsd/raw.json"])).toThrow(/must not read ignored/);
    expect(() => parseM075S06Args(["--fixture", ".planning/raw.json"])).toThrow(/must not read ignored/);
    expect(() => parseM075S06Args(["--fixture", ".audits/raw.json"])).toThrow(/must not read ignored/);
    expect(() => parseM075S06Args(["--fixture", "../raw.json"])).toThrow(/must not traverse/);
    expect(() => parseM075S06Args(["--fixture", "/tmp/raw.json"])).toThrow(/repo-relative/);
    expect(() => parseM075S06Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("fixture verification succeeds for bounded addon-check classification evidence", async () => {
    const report = await evaluateM075S06Contract(parseM075S06Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      generatedAt: "2026-05-20T15:30:00.000Z",
      readPackageJsonText: async () => packageJson(),
      readTaxonomyText: async () => taxonomyText,
    });

    expect(report).toMatchObject({
      command: "verify:m075:s06",
      generatedAt: "2026-05-20T15:30:00.000Z",
      success: true,
      statusCode: "m075_s06_ok",
      fixturePath: DEFAULT_FIXTURE_PATH,
      observed: {
        scenarioCount: 7,
        modeCount: 7,
        expectedBoundedCount: 2,
        actionableDiagnosticCount: 4,
        malformedEvidenceCount: 1,
      },
    });
    expect(report.failedCheckIds).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("RAW_CHECKER_OUTPUT_CANARY");
    expect(JSON.stringify(report)).not.toContain("/home/");
    expect(JSON.stringify(report)).not.toContain("diff --git");
  });

  test("fails closed when required mode coverage is missing", async () => {
    const copy = await fixture((next) => {
      next.scenarios = next.scenarios.filter((scenario) => scenario.runtime.mode !== "all-timeout");
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("mode-coverage.present");
    expect(report.issues.join("\n")).toContain("all-timeout");
  });

  test("fails closed when reason codes are empty, unsafe, mismatched, or unbounded", async () => {
    const empty = await fixture((next) => {
      next.scenarios[0]!.runtime.reasonCodes = [];
      next.scenarios[0]!.log.reasonCodes = [];
      next.scenarios[0]!.comment.reasonCodes = [];
    });
    const unsafe = await fixture((next) => {
      next.scenarios[0]!.runtime.reasonCodes = ["RAW_CHECKER_OUTPUT_CANARY"];
      next.scenarios[0]!.log.reasonCodes = ["RAW_CHECKER_OUTPUT_CANARY"];
      next.scenarios[0]!.comment.reasonCodes = ["RAW_CHECKER_OUTPUT_CANARY"];
    });
    const mismatch = await fixture((next) => {
      next.scenarios[0]!.comment.reasonCodes = ["all-timeout"];
    });
    const unbounded = await fixture((next) => {
      const reasons = Array.from({ length: 9 }, (_, index) => `reason-${index}`);
      next.scenarios[0]!.runtime.reasonCodes = reasons;
      next.scenarios[0]!.log.reasonCodes = reasons;
      next.scenarios[0]!.comment.reasonCodes = reasons;
    });

    expect((await reportFor(empty)).failedCheckIds).toContain("reason-codes.safe");
    expect((await reportFor(unsafe)).failedCheckIds).toContain("reason-codes.safe");
    expect((await reportFor(mismatch)).failedCheckIds).toContain("reason-codes.safe");
    expect((await reportFor(unbounded)).failedCheckIds).toContain("reason-codes.safe");
  });

  test("fails closed for unsafe runtime/log/comment correlation and unbounded counts", async () => {
    const copy = await fixture((next) => {
      next.scenarios[0]!.log.deliveryId = "different-delivery";
      next.scenarios[0]!.runtime.repo = "not a repo";
      next.scenarios[0]!.runtime.counts.addonCount = 10001;
      next.scenarios[0]!.runtime.counts.timeBudgetMs = 3600001;
      next.scenarios[0]!.runtime.redaction.rawCheckerOutputOmitted = false;
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("runtime-signals.present");
    expect(report.issues.join("\n")).toContain("deliveryId correlation");
    expect(report.issues.join("\n")).toContain("counts.addonCount");
  });

  test("fails closed for raw keys, raw canaries, secret-like values, and unsafe comment diagnostics without echoing raw values", async () => {
    const copy = await fixture((next) => {
      next.scenarios[0]!.comment.bounded = false;
      (next.scenarios[0]!.comment as Record<string, unknown>).addonIdentifiers = ["pvr.secret-addon"];
      (next.scenarios[0]!.log as Record<string, unknown>).rawCheckerOutput = "RAW_CHECKER_OUTPUT_CANARY TOKEN=abc123";
      (next.scenarios[0]!.runtime as unknown as Record<string, unknown>).workspacePath = "/home/runner/work/kodiai";
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("comment-diagnostics.present");
    expect(report.failedCheckIds).toContain("redaction.safe");
    expect(report.issues.join("\n")).toContain("forbidden raw key/value");
    expect(report.issues.join("\n")).not.toContain("RAW_CHECKER_OUTPUT_CANARY");
    expect(report.issues.join("\n")).not.toContain("TOKEN=abc123");
    expect(report.issues.join("\n")).not.toContain("/home/runner");
  });

  test("fails closed when taxonomy mappings collapse structured outcomes into ambiguous legacy timeout noise", async () => {
    const boundedAsLegacy = await fixture((next) => {
      next.scenarios[0]!.taxonomy.classId = "addon-check.timeout";
      next.scenarios[0]!.taxonomy.actionable = false;
    });
    const malformedWrongClass = await fixture((next) => {
      const scenario = next.scenarios.find((entry) => entry.runtime.mode === "unknown-malformed-evidence")!;
      scenario.taxonomy.classId = "addon-check-classification.actionable-diagnostic";
    });
    const missingTaxonomy = await evaluateM075S06Contract(parseM075S06Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readPackageJsonText: async () => packageJson(),
      readTaxonomyText: async () => "addon-check.timeout",
    });

    expect((await reportFor(boundedAsLegacy)).failedCheckIds).toContain("taxonomy.present");
    expect((await reportFor(malformedWrongClass)).failedCheckIds).toContain("taxonomy.present");
    expect(missingTaxonomy.failedCheckIds).toContain("taxonomy.present");
  });

  test("fails closed when scenario output, fixture bytes, or issue output are unbounded", async () => {
    const tooManyScenarios = await fixture((next) => {
      next.scenarios = Array.from({ length: 17 }, (_, index) => ({
        ...JSON.parse(JSON.stringify(next.scenarios[0])),
        name: `scenario-${index}`,
      }));
    });
    const hugeFixture = await evaluateM075S06Contract(parseM075S06Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readFileText: async () => JSON.stringify({ schema: "m075-s06-addon-check-classification.v1", generatedAt: "x", scenarios: [], negativeControls: {}, padding: "x".repeat(100001) }),
      readPackageJsonText: async () => packageJson(),
      readTaxonomyText: async () => taxonomyText,
    });
    const report = await reportFor(tooManyScenarios);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("mode-coverage.present");
    expect(report.failedCheckIds).toContain("output.bounded");
    expect(report.issues.length).toBeLessThanOrEqual(24);
    expect(report.issues.every((issue) => issue.length <= 240)).toBe(true);
    expect(hugeFixture.statusCode).toBe("m075_s06_malformed_evidence");
  });

  test("package wiring, invalid JSON, unreadable fixture, missing negative controls, and main invalid args fail safely", async () => {
    const drifted = await evaluateM075S06Contract(parseM075S06Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readPackageJsonText: async () => JSON.stringify({ scripts: {} }),
      readTaxonomyText: async () => taxonomyText,
    });
    const invalidJson = await evaluateM075S06Contract(parseM075S06Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readFileText: async () => "{not-json",
      readPackageJsonText: async () => packageJson(),
      readTaxonomyText: async () => taxonomyText,
    });
    const missing = await evaluateM075S06Contract(parseM075S06Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readFileText: async () => { throw new Error("missing"); },
      readPackageJsonText: async () => packageJson(),
      readTaxonomyText: async () => taxonomyText,
    });
    const missingNegative = await fixture((next) => {
      next.negativeControls.liveModeRejected = false;
    });

    expect(drifted.success).toBe(false);
    expect(drifted.failedCheckIds).toContain("package-wiring.present");
    expect(invalidJson.statusCode).toBe("m075_s06_invalid_json");
    expect(missing.statusCode).toBe("m075_s06_fixture_read_failed");
    expect((await reportFor(missingNegative)).failedCheckIds).toContain("negative-controls.present");
    expect(await main(["--invalid"], { stdout: { write: () => undefined }, stderr: { write: () => undefined } })).toBe(2);
  });

  test("evaluateEvidence can be reused by later S07 aggregation", async () => {
    const copy = await fixture();
    const result = evaluateEvidence(copy, { id: "package-wiring.present", status: "pass", message: "ok", issues: [] }, taxonomyText);

    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
    expect(result.observed).toMatchObject({ scenarioCount: 7, modeCount: 7, actionableDiagnosticCount: 4 });
  });
});
