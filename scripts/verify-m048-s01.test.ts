import { describe, expect, test } from "bun:test";
import type { ReviewPhaseTiming } from "../src/execution/types.ts";
import type { NormalizedLogAnalyticsRow } from "../src/review-audit/log-analytics.ts";
import type { PhaseTimingEvidence } from "../src/review-audit/phase-timing-evidence.ts";
import { buildReviewOutputKey } from "../src/handlers/review-idempotency.ts";

const REQUIRED_PHASES = [
  "queue wait",
  "workspace preparation",
  "retrieval/context assembly",
  "executor handoff",
  "remote runtime",
  "publication",
] as const;

function makePhases(overrides?: Partial<Record<(typeof REQUIRED_PHASES)[number], Partial<ReviewPhaseTiming>>>) {
  return REQUIRED_PHASES.map((name, index) => ({
    name,
    status: "completed" as const,
    durationMs: (index + 1) * 125,
    ...(overrides?.[name] ?? {}),
  }));
}

function makeEvidence(params?: {
  reviewOutputKey?: string;
  deliveryId?: string | null;
  totalDurationMs?: number | null;
  conclusion?: string | null;
  published?: boolean | null;
  phases?: ReviewPhaseTiming[];
}): PhaseTimingEvidence {
  return {
    reviewOutputKey: params?.reviewOutputKey ?? "rok-123",
    deliveryId: params?.deliveryId ?? "delivery-123",
    conclusion: params?.conclusion === undefined ? "success" : params.conclusion,
    published: params?.published === undefined ? true : params.published,
    totalDurationMs: params?.totalDurationMs ?? 4_250,
    timeGenerated: "2026-04-12T16:30:00.000Z",
    revisionName: "ca-kodiai--0000102",
    containerAppName: "ca-kodiai",
    phases: params?.phases ?? makePhases(),
  };
}

function makeRow(params?: {
  reviewOutputKey?: string;
  deliveryId?: string;
  totalDurationMs?: number;
  phases?: Array<Record<string, unknown>>;
  conclusion?: string;
  published?: boolean;
}): NormalizedLogAnalyticsRow {
  const payload = {
    msg: "Review phase timing summary",
    reviewOutputKey: params?.reviewOutputKey ?? "rok-123",
    deliveryId: params?.deliveryId ?? "delivery-123",
    totalDurationMs: params?.totalDurationMs ?? 4_250,
    conclusion: params?.conclusion ?? "success",
    published: params?.published ?? true,
    phases: params?.phases ?? makePhases(),
  } satisfies Record<string, unknown>;

  return {
    timeGenerated: "2026-04-12T16:30:00.000Z",
    rawLog: JSON.stringify(payload),
    malformed: false,
    deliveryId: String(payload.deliveryId),
    reviewOutputKey: String(payload.reviewOutputKey),
    message: "Review phase timing summary",
    revisionName: "ca-kodiai--0000102",
    containerAppName: "ca-kodiai",
    parsedLog: payload,
  };
}

async function loadModule() {
  return await import("./verify-m048-s01.ts");
}

describe("verify-m048-s01", () => {
  test("parseVerifyM048S01Args parses the review key, optional delivery id, and json flag", async () => {
    const { parseVerifyM048S01Args } = await loadModule();

    const result = parseVerifyM048S01Args([
      "--review-output-key",
      "rok-123",
      "--delivery-id",
      "delivery-123",
      "--json",
    ]);

    expect(result.reviewOutputKey).toBe("rok-123");
    expect(result.deliveryId).toBe("delivery-123");
    expect(result.json).toBe(true);
  });

  test("parseVerifyM048S01Args does not consume the next flag when --review-output-key is empty", async () => {
    const { parseVerifyM048S01Args } = await loadModule();

    const result = parseVerifyM048S01Args([
      "--review-output-key",
      "--json",
    ]);

    expect(result.reviewOutputKey).toBeNull();
    expect(result.json).toBe(true);
  });

  test("deriveM048S01Outcome keeps the no-evidence summary reserved for the true missing-evidence path", async () => {
    const { deriveM048S01Outcome } = await loadModule();

    expect(deriveM048S01Outcome(null)).toEqual({
      class: "unknown",
      conclusion: null,
      published: null,
      summary: "no correlated phase evidence available",
    });

    expect(deriveM048S01Outcome(makeEvidence({ conclusion: null, published: null }))).toEqual({
      class: "unknown",
      conclusion: null,
      published: null,
      summary: "unknown (publication unknown)",
    });
  });

  test("deriveM048S01Outcome renders publication unknown for success evidence with an unknown publication state", async () => {
    const { deriveM048S01Outcome } = await loadModule();

    expect(deriveM048S01Outcome(makeEvidence({ conclusion: "success", published: null }))).toEqual({
      class: "success",
      conclusion: "success",
      published: null,
      summary: "success (publication unknown)",
    });
  });

  test("deriveM048S01Outcome renders publication unknown for timeout evidence with an unknown publication state", async () => {
    const { deriveM048S01Outcome } = await loadModule();

    expect(deriveM048S01Outcome(makeEvidence({ conclusion: "timeout", published: null }))).toEqual({
      class: "timeout",
      conclusion: "timeout",
      published: null,
      summary: "timeout (publication unknown)",
    });
  });

  test("evaluateM048S01 returns a successful report with the required six-phase matrix", async () => {
    const { evaluateM048S01 } = await loadModule();

    const report = await evaluateM048S01({
      reviewOutputKey: "rok-123",
      deliveryId: "delivery-123",
      generatedAt: "2026-04-12T16:45:00.000Z",
      workspaceIds: ["workspace-1"],
      queryLogs: async () => ({
        query: "phase query",
        rows: [makeRow()],
      }),
    });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m048_s01_ok");
    expect(report.sourceAvailability.azureLogs).toBe("present");
    expect(report.outcome.class).toBe("success");
    expect(report.outcome.summary).toContain("published output");
    expect(report.evidence?.totalDurationMs).toBe(4_250);
    expect(report.evidence?.phases.map((phase: ReviewPhaseTiming) => phase.name)).toEqual([...REQUIRED_PHASES]);
  });

  test("evaluateM048S01 returns a named Azure-unavailable status when the query helper throws", async () => {
    const { evaluateM048S01 } = await loadModule();

    const report = await evaluateM048S01({
      reviewOutputKey: "rok-123",
      deliveryId: "delivery-123",
      generatedAt: "2026-04-12T16:45:00.000Z",
      workspaceIds: ["workspace-1"],
      queryLogs: async () => {
        throw new Error("azure timeout");
      },
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m048_s01_azure_unavailable");
    expect(report.sourceAvailability.azureLogs).toBe("unavailable");
  });

  test("main exits zero with a named skipped status when --review-output-key is passed without a value", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const exitCode = await main(["--review-output-key", "--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: (chunk: string) => void stderrChunks.push(chunk) },
      evaluate: async () => {
        throw new Error("should not be called");
      },
    });

    const report = JSON.parse(stdoutChunks.join(""));
    expect(exitCode).toBe(0);
    expect(stderrChunks.join(" ")).toBe("");
    expect(report.status_code).toBe("m048_s01_skipped_missing_review_output_key");
    expect(report.success).toBe(true);
    expect(report.issues).toContain("No review output key provided; skipped live Azure phase-timing verification.");
  });

  test("main exits non-zero with a named invalid-arg status when --review-output-key is missing", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const exitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: (chunk: string) => void stderrChunks.push(chunk) },
      evaluate: async () => {
        throw new Error("should not be called");
      },
    });

    const report = JSON.parse(stdoutChunks.join(""));
    expect(exitCode).toBe(1);
    expect(stderrChunks.join(" ")).toBe("");
    expect(report.status_code).toBe("m048_s01_invalid_arg");
    expect(report.issues).toContain("Missing required --review-output-key.");
  });

  test("main rejects contradictory delivery filters instead of running a broad query", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "xbmc",
      repo: "xbmc",
      prNumber: 101,
      action: "review_requested",
      deliveryId: "delivery-101",
      headSha: "abc123",
    });

    const exitCode = await main([
      "--review-output-key",
      reviewOutputKey,
      "--delivery-id",
      "delivery-999",
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
    expect(report.status_code).toBe("m048_s01_invalid_arg");
    expect(report.issues).toContain(
      "Provided --delivery-id does not match the delivery id encoded in --review-output-key.",
    );
  });

  test("renderM048S01Report keeps timeout evidence readable for operators", async () => {
    const { evaluateM048S01, renderM048S01Report } = await loadModule();

    const report = await evaluateM048S01({
      reviewOutputKey: "rok-123",
      deliveryId: "delivery-123",
      generatedAt: "2026-04-12T16:45:00.000Z",
      workspaceIds: ["workspace-1"],
      queryLogs: async () => ({
        query: "phase query",
        rows: [makeRow({
          conclusion: "timeout_partial",
          published: true,
          phases: makePhases({
            publication: {
              status: "completed",
              detail: "partial review output published before timeout",
              durationMs: 625,
            },
          }),
        })],
      }),
    });

    const human = renderM048S01Report(report);

    expect(human).toContain("Status: m048_s01_ok");
    expect(human).toContain("Outcome class: timeout_partial");
    expect(human).toContain("Outcome detail: timeout_partial (visible partial output published)");
    expect(human).toContain("Conclusion: timeout_partial");
    expect(human).toContain("publication: 625ms");
  });

  test("package.json wires verify:m048:s01 to the verifier script", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m048:s01"]).toBe("bun scripts/verify-m048-s01.ts");
  });
});
