import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  DEFAULT_FIXTURE_PATH,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateEvidence,
  evaluateM075S04Contract,
  main,
  parseM075S04Args,
  type M075S04EvidenceSnapshot,
} from "./verify-m075-s04.ts";

function packageJson(script = EXPECTED_PACKAGE_SCRIPT): string {
  return JSON.stringify({ scripts: { [COMMAND_NAME]: script } });
}

async function fixture(overrides: (copy: M075S04EvidenceSnapshot) => void = () => undefined): Promise<M075S04EvidenceSnapshot> {
  const loaded = await Bun.file(DEFAULT_FIXTURE_PATH).json() as M075S04EvidenceSnapshot;
  const copy = JSON.parse(JSON.stringify(loaded)) as M075S04EvidenceSnapshot;
  overrides(copy);
  return copy;
}

async function reportFor(copy: M075S04EvidenceSnapshot) {
  return evaluateM075S04Contract(parseM075S04Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
    readFileText: async () => JSON.stringify(copy),
    readPackageJsonText: async () => packageJson(),
  });
}

describe("verify-m075-s04", () => {
  test("parses fixture-only CLI arguments and rejects unsafe inputs", () => {
    expect(parseM075S04Args([])).toEqual({ json: false, help: false });
    expect(parseM075S04Args(["--json", "--fixture", DEFAULT_FIXTURE_PATH])).toEqual({ json: true, help: false, fixturePath: DEFAULT_FIXTURE_PATH });
    expect(parseM075S04Args(["--help"])).toEqual({ json: false, help: true });
    expect(() => parseM075S04Args(["--live"])).toThrow(/fixture-only/);
    expect(() => parseM075S04Args(["--fixture", ".gsd/raw.json"])).toThrow(/must not read ignored/);
    expect(() => parseM075S04Args(["--fixture", "../raw.json"])).toThrow(/must not traverse/);
    expect(() => parseM075S04Args(["--fixture", "/tmp/raw.json"])).toThrow(/repo-relative/);
    expect(() => parseM075S04Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("fixture verification succeeds for bounded publication reason evidence", async () => {
    const report = await evaluateM075S04Contract(parseM075S04Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      generatedAt: "2026-05-20T16:30:00.000Z",
      readPackageJsonText: async () => packageJson(),
    });

    expect(report).toMatchObject({
      command: "verify:m075:s04",
      generatedAt: "2026-05-20T16:30:00.000Z",
      success: true,
      statusCode: "m075_s04_ok",
      fixturePath: DEFAULT_FIXTURE_PATH,
      observed: {
        bucketCount: 7,
        nonEmptyReasonBucketCount: 7,
        visibleLineCount: 8,
        publisherSampleCount: 7,
        directFallbackPublished: 0,
        fallbackDisallowed: 1,
      },
    });
    expect(report.failedCheckIds).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("RAW_PROMPT_CANARY");
    expect(JSON.stringify(report)).not.toContain("diff --git");
  });

  test("fails closed when a required bucket is missing", async () => {
    const copy = await fixture((next) => {
      delete next.runtime.outcomeBuckets.failed;
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("outcome-buckets.present");
    expect(report.issues.join("\n")).toContain("runtime.outcomeBuckets.failed");
  });

  test("fails closed when non-zero buckets have empty or unsafe reasons", async () => {
    const empty = await fixture((next) => {
      next.runtime.outcomeBuckets.blocked.reasons = [];
      next.logs.outcomeBuckets.blocked.reasons = [];
      next.reviewDetails.outcomeBuckets.blocked.reasons = [];
    });
    const unsafe = await fixture((next) => {
      next.runtime.outcomeBuckets.published.reasons = ["RAW_PROMPT_CANARY"];
    });

    expect((await reportFor(empty)).failedCheckIds).toContain("reason-evidence.non-empty");
    expect((await reportFor(unsafe)).failedCheckIds).toContain("reason-evidence.non-empty");
  });

  test("fails closed for raw keys, raw canaries, secret-like values, and unsafe redaction flags without echoing raw values", async () => {
    const copy = await fixture((next) => {
      next.runtime.redaction.rawPromptsIncluded = true;
      next.reviewDetails.movedToDetails.redaction.secretLikeValuesIncluded = true;
      next.reviewDetails.visibleBody.lines.push("RAW_PROMPT_CANARY TOKEN=abc123 diff --git unapproved content canary");
      next.reviewDetails.visibleBody.lineCount = next.reviewDetails.visibleBody.lines.length;
      (next.provenance as Record<string, unknown>).candidatePayload = "SECRET_TOKEN_CANARY";
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("redaction.safe");
    expect(report.failedCheckIds).toContain("fallback-leakage.absent");
    expect(report.issues.join("\n")).toContain("forbidden raw key/value");
    expect(report.issues.join("\n")).not.toContain("SECRET_TOKEN_CANARY");
    expect(report.issues.join("\n")).not.toContain("TOKEN=abc123");
  });

  test("fails closed when direct fallback publication leaks", async () => {
    const copy = await fixture((next) => {
      next.runtime.counts.directPublished = 1;
      next.logs.counts.directPublished = 1;
      next.reviewDetails.visibleBody.lines[0] = "direct fallback published fallback body";
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("direct-fallback.disallowed");
    expect(report.failedCheckIds).toContain("fallback-leakage.absent");
  });

  test("fails closed when visible output, reason arrays, or publisher samples are unbounded", async () => {
    const copy = await fixture((next) => {
      next.reviewDetails.visibleBody.maxLineCount = 99;
      next.reviewDetails.visibleBody.lines = Array.from({ length: 25 }, (_, index) => `line ${index}`);
      next.reviewDetails.visibleBody.lineCount = 25;
      next.runtime.outcomeBuckets.published.reasons = Array.from({ length: 13 }, (_, index) => `reason-${index}`);
      next.runtime.publisherResultSample = Array.from({ length: 21 }, (_, index) => ({ fingerprint: `candidate-${index}`, status: "published", reason: "candidate-publisher-published" }));
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("output.bounded");
    expect(report.failedCheckIds).toContain("publisher-sample.bounded");
  });

  test("package wiring, invalid JSON, unreadable fixture, and main invalid args fail safely", async () => {
    const drifted = await evaluateM075S04Contract(parseM075S04Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readPackageJsonText: async () => JSON.stringify({ scripts: {} }),
    });
    const invalidJson = await evaluateM075S04Contract(parseM075S04Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readFileText: async () => "{not-json",
      readPackageJsonText: async () => packageJson(),
    });
    const missing = await evaluateM075S04Contract(parseM075S04Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readFileText: async () => { throw new Error("missing"); },
      readPackageJsonText: async () => packageJson(),
    });

    expect(drifted.success).toBe(false);
    expect(drifted.failedCheckIds).toContain("package-wiring.present");
    expect(invalidJson.statusCode).toBe("m075_s04_invalid_json");
    expect(missing.statusCode).toBe("m075_s04_fixture_read_failed");
    expect(await main(["--invalid"], { stdout: { write: () => undefined }, stderr: { write: () => undefined } })).toBe(2);
  });

  test("issue output is bounded", async () => {
    const copy = await fixture((next) => {
      for (const bucket of Object.values(next.runtime.outcomeBuckets)) bucket.reasons = [];
      for (const bucket of Object.values(next.logs.outcomeBuckets)) bucket.reasons = [];
      for (const bucket of Object.values(next.reviewDetails.outcomeBuckets)) bucket.reasons = [];
      next.reviewDetails.visibleBody.lines = Array.from({ length: 40 }, (_, index) => `${index} ${"x".repeat(220)}`);
      next.reviewDetails.visibleBody.lineCount = 40;
      next.reviewDetails.visibleBody.maxLineCount = 40;
      next.reviewDetails.visibleBody.maxLineLength = 400;
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.issues.length).toBeLessThanOrEqual(24);
    expect(report.issues.every((issue) => issue.length <= 240)).toBe(true);
  });

  test("evaluateEvidence can be reused by later S07 aggregation", async () => {
    const copy = await fixture();
    const result = evaluateEvidence(copy, { id: "package-wiring.present", status: "pass", message: "ok", issues: [] });

    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
    expect(result.observed).toMatchObject({ bucketCount: 7, nonEmptyReasonBucketCount: 7, directFallbackPublished: 0 });
  });
});
