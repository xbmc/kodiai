import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildReviewOutputKey } from "../src/handlers/review-idempotency.ts";
import type { M048S01Report } from "./verify-m048-s01.ts";

function makeS01Report(params?: {
  reviewOutputKey?: string;
  deliveryId?: string;
  success?: boolean;
  statusCode?: M048S01Report["status_code"];
  azureLogs?: M048S01Report["sourceAvailability"]["azureLogs"];
}): M048S01Report {
  return {
    command: "verify:m048:s01",
    generated_at: "2026-04-13T05:00:00.000Z",
    review_output_key: params?.reviewOutputKey ?? "rok-sync",
    delivery_id: params?.deliveryId ?? "delivery-sync",
    success: params?.success ?? true,
    status_code: params?.statusCode ?? "m048_s01_ok",
    sourceAvailability: {
      azureLogs: params?.azureLogs ?? "present",
    },
    query: {
      text: "phase query",
      timespan: "P14D",
      workspaceCount: 1,
      matchedRowCount: 1,
      duplicateRowCount: 0,
      driftedRowCount: 0,
    },
    evidence: {
      reviewOutputKey: params?.reviewOutputKey ?? "rok-sync",
      deliveryId: params?.deliveryId ?? "delivery-sync",
      conclusion: "success",
      published: true,
      totalDurationMs: 4_200,
      timeGenerated: "2026-04-13T04:59:00.000Z",
      revisionName: "ca-kodiai--0000102",
      containerAppName: "ca-kodiai",
      phases: [
        { name: "queue wait", status: "completed", durationMs: 150 },
        { name: "workspace preparation", status: "completed", durationMs: 400 },
        { name: "retrieval/context assembly", status: "completed", durationMs: 700 },
        { name: "executor handoff", status: "completed", durationMs: 350 },
        { name: "remote runtime", status: "completed", durationMs: 2_100 },
        { name: "publication", status: "completed", durationMs: 500 },
      ],
    },
    issues: [],
  };
}

async function loadModule() {
  return await import("./verify-m048-s03.ts");
}

describe("verify-m048-s03", () => {
  test("parseVerifyM048S03Args parses the optional synchronize review key and json flag", async () => {
    const { parseVerifyM048S03Args } = await loadModule();

    const result = parseVerifyM048S03Args([
      "--review-output-key",
      "rok-sync",
      "--json",
    ]);

    expect(result.reviewOutputKey).toBe("rok-sync");
    expect(result.json).toBe(true);
  });

  test("evaluateM048S03 passes the checked-in synchronize preflight and bounded-disclosure fixtures without live evidence", async () => {
    const { evaluateM048S03 } = await loadModule();

    const report = await evaluateM048S03({
      workspaceDir: process.cwd(),
      generatedAt: "2026-04-13T05:10:00.000Z",
    });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m048_s03_ok");
    expect(report.local.synchronizeConfig.passed).toBe(true);
    expect(report.local.synchronizeConfig.effectiveOnSynchronize).toBe(true);
    expect(report.local.boundedDisclosure.passed).toBe(true);
    expect(report.local.boundedDisclosure.fixtures).toEqual([
      expect.objectContaining({
        name: "large-pr-strict",
        passed: true,
        actualDisclosureRequired: true,
      }),
      expect.objectContaining({
        name: "timeout-auto-reduced",
        passed: true,
        actualDisclosureRequired: true,
      }),
      expect.objectContaining({
        name: "small-unbounded",
        passed: true,
        actualDisclosureRequired: false,
      }),
    ]);
    expect(report.live.requested).toBe(false);
    expect(report.live.skipped).toBe(true);
    expect(report.live.phaseTiming).toBeNull();
  });

  test("evaluateM048S03 fails loudly when synchronize intent is mis-shaped and effective config stays disabled", async () => {
    const { evaluateM048S03 } = await loadModule();
    const dir = await mkdtemp(join(tmpdir(), "kodiai-m048-s03-"));

    try {
      await writeFile(join(dir, ".kodiai.yml"), "review:\n  onSynchronize: true\n");

      const report = await evaluateM048S03({
        workspaceDir: dir,
        generatedAt: "2026-04-13T05:10:00.000Z",
      });

      expect(report.success).toBe(false);
      expect(report.status_code).toBe("m048_s03_sync_config_drift");
      expect(report.local.synchronizeConfig.passed).toBe(false);
      expect(report.local.synchronizeConfig.effectiveOnSynchronize).toBe(false);
      expect(report.local.synchronizeConfig.issues.join(" ")).toContain("review.onSynchronize");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("evaluateM048S03 returns a named bounded-disclosure failure when fixture proof drifts", async () => {
    const { evaluateM048S03 } = await loadModule();

    const report = await evaluateM048S03({
      workspaceDir: process.cwd(),
      generatedAt: "2026-04-13T05:10:00.000Z",
      evaluateBoundedDisclosure: async () => ({
        passed: false,
        fixtures: [
          {
            name: "large-pr-strict",
            passed: false,
            expectedDisclosureRequired: true,
            actualDisclosureRequired: true,
            expectedSentence: "expected disclosure",
            actualSentence: "drifted disclosure",
            summaryDisclosureInserted: false,
            issues: ["Disclosure sentence drifted."],
          },
        ],
        issues: ["Disclosure sentence drifted."],
      }),
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m048_s03_bounded_disclosure_failed");
    expect(report.local.boundedDisclosure.passed).toBe(false);
    expect(report.issues).toContain("Disclosure sentence drifted.");
  });

  test("evaluateM048S03 accepts synchronize reviewOutputKey values and reuses the S01 phase-evidence surface", async () => {
    const { evaluateM048S03 } = await loadModule();
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 203,
      action: "synchronize",
      deliveryId: "delivery-203",
      headSha: "abc123",
    });

    const report = await evaluateM048S03({
      workspaceDir: process.cwd(),
      reviewOutputKey,
      generatedAt: "2026-04-13T05:10:00.000Z",
      evaluateLivePhaseTiming: async ({ reviewOutputKey: key, deliveryId }) =>
        makeS01Report({ reviewOutputKey: key, deliveryId }),
    });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m048_s03_ok");
    expect(report.live.requested).toBe(true);
    expect(report.live.skipped).toBe(false);
    expect(report.live.action).toBe("synchronize");
    expect(report.live.deliveryId).toBe("delivery-203");
    expect(report.live.phaseTiming).toEqual(expect.objectContaining({
      command: "verify:m048:s01",
      status_code: "m048_s01_ok",
      success: true,
      review_output_key: reviewOutputKey,
    }));
  });

  test("main exits zero when --review-output-key is present without a value so local proof stays cheap", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const exitCode = await main(["--review-output-key", "--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: (chunk: string) => void stderrChunks.push(chunk) },
      evaluate: async ({ reviewOutputKey }) => ({
        command: "verify:m048:s03",
        generated_at: "2026-04-13T05:10:00.000Z",
        review_output_key: reviewOutputKey,
        success: true,
        status_code: "m048_s03_ok",
        local: {
          synchronizeConfig: {
            configPath: join(process.cwd(), ".kodiai.yml"),
            configPresent: true,
            effectiveOnSynchronize: true,
            warnings: [],
            passed: true,
            issues: [],
          },
          boundedDisclosure: {
            passed: true,
            fixtures: [],
            issues: [],
          },
        },
        live: {
          requested: false,
          skipped: true,
          action: null,
          deliveryId: null,
          phaseTiming: null,
        },
        issues: [],
      }),
    });

    const report = JSON.parse(stdoutChunks.join(""));
    expect(exitCode).toBe(0);
    expect(stderrChunks.join(" ")).toBe("");
    expect(report.status_code).toBe("m048_s03_ok");
    expect(report.live.skipped).toBe(true);
    expect(report.live.requested).toBe(false);
  });

  test("main rejects non-synchronize reviewOutputKey values before live evidence lookup", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 204,
      action: "review_requested",
      deliveryId: "delivery-204",
      headSha: "abc123",
    });

    const exitCode = await main([
      "--review-output-key",
      reviewOutputKey,
      "--json",
    ], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => {
        throw new Error("should not be called");
      },
    });

    const report = JSON.parse(stdoutChunks.join(""));
    expect(exitCode).toBe(1);
    expect(report.status_code).toBe("m048_s03_live_key_mismatch");
    expect(report.issues).toContain(
      "Expected a synchronize reviewOutputKey; received action=review_requested.",
    );
  });

  test("package.json wires verify:m048:s03 to the verifier script", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m048:s03"]).toBe("bun scripts/verify-m048-s03.ts");
  });
});
