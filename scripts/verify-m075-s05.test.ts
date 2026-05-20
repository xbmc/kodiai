import { describe, expect, test } from "bun:test";
import {
  COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateM075S05Contract,
  parseM075S05Args,
  renderM075S05Report,
} from "./verify-m075-s05.ts";

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ scripts: { [COMMAND_NAME]: EXPECTED_PACKAGE_SCRIPT } }, null, 2),
  "src/handlers/review.ts": `
    import { classifyReviewTimeoutOutcome } from "../review-orchestration/review-timeout-classification.ts";
    const timeoutClassification = classifyReviewTimeoutOutcome({});
    logger.info(
      {
        ...baseLog,
        gate: timeoutClassification.gate,
        gateResult: timeoutClassification.classification,
        classification: timeoutClassification.classification,
        mode: timeoutClassification.mode,
        reasonCodes: timeoutClassification.reasonCodes,
        deliveryId: event.id,
        reviewOutputKey,
        checkpointFilesReviewed: timeoutClassification.counts.checkpointFilesReviewed ?? null,
        checkpointFilesInspected: timeoutClassification.counts.checkpointFilesInspected ?? null,
        checkpointFindingCount: timeoutClassification.counts.checkpointFindingCount ?? null,
        checkpointTotalFiles: timeoutClassification.counts.checkpointTotalFiles ?? null,
        retryFilesCount: timeoutClassification.counts.retryFilesCount ?? null,
        recentTimeouts: timeoutClassification.counts.recentTimeouts ?? null,
        longRunThresholdSeconds: timeoutClassification.counts.longRunThresholdSeconds ?? null,
        redaction: timeoutClassification.redaction,
      },
      "Review timeout classification",
    );
  `,
  "src/handlers/review.test.ts": `
    test("logs bounded partial timeout classification", () => undefined);
    expect(mode).toBe("zero-evidence-hard-timeout");
    expect(mode).toBe("chronic-timeout-skip");
    expect(mode).toBe("max-turns-continuation");
    expect(message).toBe("Resilience telemetry write failed (non-blocking)");
  `,
  "src/telemetry/types.ts": `
    timeoutClassification?: string;
    timeoutClassificationMode?: string;
    timeoutClassificationReasons?: string[];
  `,
  "src/telemetry/store.ts": `
    timeout_classification, timeout_classification_mode, timeout_classification_reasons
    entry.timeoutClassificationReasons ?? []
    timeout_classification_reasons = EXCLUDED.timeout_classification_reasons
  `,
  "src/telemetry/store.test.ts": `test("writes timeout classification fields without raw payloads", () => undefined);`,
  "src/db/migrations/044-review-timeout-classification.sql": `
    ADD COLUMN IF NOT EXISTS timeout_classification TEXT,
    ADD COLUMN IF NOT EXISTS timeout_classification_mode TEXT,
    ADD COLUMN IF NOT EXISTS timeout_classification_reasons TEXT[]
  `,
  "src/db/migrations/044-review-timeout-classification.down.sql": `
    DROP COLUMN IF EXISTS timeout_classification_reasons,
    DROP COLUMN IF EXISTS timeout_classification_mode,
    DROP COLUMN IF EXISTS timeout_classification
  `,
};

describe("verify-m075-s05", () => {
  test("parses cli args", () => {
    expect(parseM075S05Args([])).toEqual({ json: false, help: false });
    expect(parseM075S05Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM075S05Args(["--help"])).toEqual({ json: false, help: true });
    expect(() => parseM075S05Args(["--fixture", ".gsd/secret.json"])).toThrow(/invalid_cli_args/);
  });

  test("passes when tracked runtime, telemetry, migration, test, and package surfaces are present", async () => {
    const report = await evaluateM075S05Contract({
      generatedAt: "2026-05-20T00:00:00.000Z",
      readTextFile: async (path) => FILES[path] ?? "",
    });

    expect(report.success).toBe(true);
    expect(report.statusCode).toBe("m075_s05_ok");
    expect(report.failedCheckIds).toEqual([]);
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(renderM075S05Report(report)).toContain("M075/S05 timeout classification verifier: PASS");
  });

  test("fails closed when raw canary names appear in the runtime classification log", async () => {
    const report = await evaluateM075S05Contract({
      generatedAt: "2026-05-20T00:00:00.000Z",
      readTextFile: async (path) => path === "src/handlers/review.ts"
        ? FILES[path]!.replace("reviewOutputKey,", "rawPrompt,\n        reviewOutputKey,")
        : FILES[path] ?? "",
    });

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("redaction.raw-canaries-absent");
    expect(report.issues.join("\n")).toContain("Raw prompt/model/candidate/diff/GitHub payload/log canary");
  });
});
