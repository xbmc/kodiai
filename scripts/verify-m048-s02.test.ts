import { describe, expect, test } from "bun:test";
import type { ReviewPhaseTiming } from "../src/execution/types.ts";
import { buildReviewOutputKey } from "../src/handlers/review-idempotency.ts";
import type { M048S01Report } from "./verify-m048-s01.ts";

const TARGET_PHASES = [
  "queue wait",
  "workspace preparation",
  "retrieval/context assembly",
  "executor handoff",
  "remote runtime",
  "publication",
] as const;

function makePhases(overrides?: Partial<Record<(typeof TARGET_PHASES)[number], Partial<ReviewPhaseTiming>>>) {
  return TARGET_PHASES.map((name, index) => ({
    name,
    status: "completed" as const,
    durationMs: (index + 1) * 1_000,
    ...(overrides?.[name] ?? {}),
  }));
}

function makeS01Report(params?: {
  reviewOutputKey?: string;
  deliveryId?: string;
  statusCode?: M048S01Report["status_code"];
  success?: boolean;
  published?: boolean | null;
  conclusion?: string | null;
  totalDurationMs?: number | null;
  phases?: ReviewPhaseTiming[] | null;
  sourceAvailability?: M048S01Report["sourceAvailability"]["azureLogs"];
  issues?: string[];
}): M048S01Report {
  const phases = params?.phases === null ? null : (params?.phases ?? makePhases());
  const conclusion = params?.conclusion ?? "success";
  const published = params?.published ?? true;
  const outcomeClass = conclusion === "timeout_partial"
    ? "timeout_partial"
    : conclusion === "timeout"
      ? "timeout"
      : conclusion === "success"
        ? "success"
        : "failure";

  return {
    command: "verify:m048:s01",
    generated_at: "2026-04-12T18:00:00.000Z",
    review_output_key: params?.reviewOutputKey ?? "rok-default",
    delivery_id: params?.deliveryId ?? "delivery-default",
    success: params?.success ?? true,
    status_code: params?.statusCode ?? "m048_s01_ok",
    sourceAvailability: {
      azureLogs: params?.sourceAvailability ?? "present",
    },
    query: {
      text: "phase query",
      timespan: "P14D",
      workspaceCount: 1,
      matchedRowCount: phases ? 1 : 0,
      duplicateRowCount: 0,
      driftedRowCount: 0,
    },
    outcome: {
      class: outcomeClass,
      conclusion,
      published,
      summary: conclusion === "timeout_partial"
        ? "timeout_partial (visible partial output published)"
        : conclusion === "timeout"
          ? "timeout (no visible output published)"
          : conclusion === "success"
            ? (published ? "success (published output)" : "success (no published output)")
            : `${conclusion ?? "unknown"} (${published ? "published output" : "no published output"})`,
    },
    evidence: phases
      ? {
        reviewOutputKey: params?.reviewOutputKey ?? "rok-default",
        deliveryId: params?.deliveryId ?? "delivery-default",
        conclusion,
        published,
        totalDurationMs: params?.totalDurationMs ?? 21_000,
        timeGenerated: "2026-04-12T17:59:00.000Z",
        revisionName: "ca-kodiai--0000102",
        containerAppName: "ca-kodiai",
        phases,
      }
      : null,
    issues: params?.issues ?? [],
  };
}

async function loadModule() {
  return await import("./verify-m048-s02.ts");
}

describe("verify-m048-s02", () => {
  test("evaluateM048S02 returns an improved compare report with targeted phase deltas, timeout-class retirement, and preserved publication continuity", async () => {
    const { evaluateM048S02 } = await loadModule();

    const baseline = makeS01Report({
      reviewOutputKey: "rok-baseline",
      deliveryId: "delivery-baseline",
      conclusion: "timeout_partial",
      published: true,
      totalDurationMs: 28_000,
      phases: makePhases({
        "workspace preparation": { durationMs: 7_000 },
        "executor handoff": { durationMs: 5_000 },
        "remote runtime": { durationMs: 9_000 },
        publication: { durationMs: 1_500 },
      }),
    });
    const candidate = makeS01Report({
      reviewOutputKey: "rok-candidate",
      deliveryId: "delivery-candidate",
      conclusion: "success",
      published: true,
      totalDurationMs: 18_000,
      phases: makePhases({
        "workspace preparation": { durationMs: 3_000 },
        "executor handoff": { durationMs: 2_000 },
        "remote runtime": { durationMs: 6_000 },
        publication: { durationMs: 1_300 },
      }),
    });

    const report = await evaluateM048S02({
      baseline: { reviewOutputKey: "rok-baseline", deliveryId: "delivery-baseline" },
      candidate: { reviewOutputKey: "rok-candidate", deliveryId: "delivery-candidate" },
      evaluate: async ({ reviewOutputKey }) => reviewOutputKey === "rok-baseline" ? baseline : candidate,
    });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m048_s02_ok");
    expect(report.comparison.outcome).toBe("latency-improved");
    expect(report.comparison.targetedTotal.deltaMs).toBe(-10_000);
    expect(report.comparison.timeoutClass).toEqual(expect.objectContaining({
      state: "retired",
      baselineClass: "timeout_partial",
      candidateClass: "success",
    }));
    expect(report.comparison.targetedPhases).toEqual([
      expect.objectContaining({
        name: "workspace preparation",
        deltaMs: -4_000,
        direction: "faster",
      }),
      expect.objectContaining({
        name: "executor handoff",
        deltaMs: -3_000,
        direction: "faster",
      }),
      expect.objectContaining({
        name: "remote runtime",
        deltaMs: -3_000,
        direction: "faster",
      }),
    ]);
    expect(report.comparison.publicationContinuity.state).toBe("preserved");
  });

  test("evaluateM048S02 returns an explicit no-improvement outcome when the candidate stays slower on targeted phases", async () => {
    const { evaluateM048S02 } = await loadModule();

    const baseline = makeS01Report({
      reviewOutputKey: "rok-baseline",
      deliveryId: "delivery-baseline",
      phases: makePhases({
        "workspace preparation": { durationMs: 3_000 },
        "executor handoff": { durationMs: 2_500 },
        "remote runtime": { durationMs: 6_000 },
      }),
    });
    const candidate = makeS01Report({
      reviewOutputKey: "rok-candidate",
      deliveryId: "delivery-candidate",
      phases: makePhases({
        "workspace preparation": { durationMs: 3_500 },
        "executor handoff": { durationMs: 2_500 },
        "remote runtime": { durationMs: 6_500 },
      }),
    });

    const report = await evaluateM048S02({
      baseline: { reviewOutputKey: "rok-baseline", deliveryId: "delivery-baseline" },
      candidate: { reviewOutputKey: "rok-candidate", deliveryId: "delivery-candidate" },
      evaluate: async ({ reviewOutputKey }) => reviewOutputKey === "rok-baseline" ? baseline : candidate,
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m048_s02_no_improvement");
    expect(report.comparison.outcome).toBe("no-improvement");
    expect(report.comparison.targetedTotal.deltaMs).toBe(1_000);
    expect(report.comparison.timeoutClass.state).toBe("preserved");
    expect(report.comparison.targetedPhases[0]).toEqual(expect.objectContaining({
      name: "workspace preparation",
      direction: "slower",
      deltaMs: 500,
    }));
    expect(report.comparison.publicationContinuity.state).toBe("preserved");
  });

  test("evaluateM048S02 returns an explicit timeout-class persisted status when the candidate still times out", async () => {
    const { evaluateM048S02 } = await loadModule();

    const baseline = makeS01Report({
      reviewOutputKey: "rok-baseline",
      deliveryId: "delivery-baseline",
      conclusion: "timeout_partial",
      published: true,
      phases: makePhases({
        "workspace preparation": { durationMs: 7_000 },
        "executor handoff": { durationMs: 5_000 },
        "remote runtime": { durationMs: 9_000 },
      }),
    });
    const candidate = makeS01Report({
      reviewOutputKey: "rok-candidate",
      deliveryId: "delivery-candidate",
      conclusion: "timeout_partial",
      published: true,
      phases: makePhases({
        "workspace preparation": { durationMs: 5_000 },
        "executor handoff": { durationMs: 3_000 },
        "remote runtime": { durationMs: 8_000 },
      }),
    });

    const report = await evaluateM048S02({
      baseline: { reviewOutputKey: "rok-baseline", deliveryId: "delivery-baseline" },
      candidate: { reviewOutputKey: "rok-candidate", deliveryId: "delivery-candidate" },
      evaluate: async ({ reviewOutputKey }) => reviewOutputKey === "rok-baseline" ? baseline : candidate,
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m048_s02_timeout_class_persisted");
    expect(report.comparison.timeoutClass).toEqual(expect.objectContaining({
      state: "persisted",
      baselineClass: "timeout_partial",
      candidateClass: "timeout_partial",
    }));
    expect(report.issues).toContain(
      "Candidate remained in the small-PR timeout class (timeout_partial) instead of retiring it.",
    );
  });

  test("evaluateM048S02 preserves unavailable evidence as an inconclusive comparison instead of inventing a result", async () => {
    const { evaluateM048S02 } = await loadModule();

    const baseline = makeS01Report({
      reviewOutputKey: "rok-baseline",
      deliveryId: "delivery-baseline",
    });
    const candidate = makeS01Report({
      reviewOutputKey: "rok-candidate",
      deliveryId: "delivery-candidate",
      success: false,
      statusCode: "m048_s01_azure_unavailable",
      sourceAvailability: "unavailable",
      phases: null,
      issues: ["Azure Log Analytics query failed: timeout"],
    });

    const report = await evaluateM048S02({
      baseline: { reviewOutputKey: "rok-baseline", deliveryId: "delivery-baseline" },
      candidate: { reviewOutputKey: "rok-candidate", deliveryId: "delivery-candidate" },
      evaluate: async ({ reviewOutputKey }) => reviewOutputKey === "rok-baseline" ? baseline : candidate,
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m048_s02_inconclusive");
    expect(report.comparison.outcome).toBe("inconclusive");
    expect(report.comparison.targetedTotal.deltaMs).toBeNull();
    expect(report.candidate.status_code).toBe("m048_s01_azure_unavailable");
    expect(report.issues).toContain("Candidate evidence is unavailable: m048_s01_azure_unavailable.");
  });

  test("evaluateM048S02 reports publication continuity regressions while still showing the latency delta", async () => {
    const { evaluateM048S02 } = await loadModule();

    const baseline = makeS01Report({
      reviewOutputKey: "rok-baseline",
      deliveryId: "delivery-baseline",
      published: true,
      phases: makePhases({
        "workspace preparation": { durationMs: 7_000 },
        "executor handoff": { durationMs: 4_500 },
        "remote runtime": { durationMs: 10_000 },
        publication: { status: "completed", durationMs: 1_000 },
      }),
    });
    const candidate = makeS01Report({
      reviewOutputKey: "rok-candidate",
      deliveryId: "delivery-candidate",
      published: false,
      conclusion: "timeout",
      phases: makePhases({
        "workspace preparation": { durationMs: 4_000 },
        "executor handoff": { durationMs: 2_500 },
        "remote runtime": { status: "degraded", durationMs: 8_500, detail: "aca polling retries" },
        publication: { status: "unavailable", detail: "review timed out before publication", durationMs: undefined },
      }),
    });

    const report = await evaluateM048S02({
      baseline: { reviewOutputKey: "rok-baseline", deliveryId: "delivery-baseline" },
      candidate: { reviewOutputKey: "rok-candidate", deliveryId: "delivery-candidate" },
      evaluate: async ({ reviewOutputKey }) => reviewOutputKey === "rok-baseline" ? baseline : candidate,
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m048_s02_timeout_class_regressed");
    expect(report.comparison.outcome).toBe("latency-improved");
    expect(report.comparison.targetedTotal.deltaMs).toBe(-6_500);
    expect(report.comparison.timeoutClass).toEqual(expect.objectContaining({
      state: "introduced",
      baselineClass: "success",
      candidateClass: "timeout",
    }));
    expect(report.comparison.publicationContinuity.state).toBe("regressed");
    expect(report.comparison.publicationContinuity.issue).toContain("Candidate lost publication continuity");
    expect(report.comparison.targetedPhases[2]).toEqual(expect.objectContaining({
      name: "remote runtime",
      deltaMs: -1_500,
      direction: "faster",
      candidate: expect.objectContaining({
        status: "degraded",
        detail: "aca polling retries",
      }),
    }));
  });

  test("main exits zero with a named skipped status when compare keys are passed without values", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const exitCode = await main([
      "--baseline-review-output-key",
      "--candidate-review-output-key",
      "--json",
    ], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: (chunk: string) => void stderrChunks.push(chunk) },
      evaluate: async () => {
        throw new Error("should not be called");
      },
    });

    const report = JSON.parse(stdoutChunks.join(""));
    expect(exitCode).toBe(0);
    expect(stderrChunks.join(" ")).toBe("");
    expect(report.status_code).toBe("m048_s02_skipped_missing_review_output_keys");
    expect(report.success).toBe(true);
    expect(report.issues).toContain(
      "No baseline/candidate review output keys provided; skipped live latency compare verification.",
    );
  });

  test("main rejects empty review keys and contradictory delivery overrides instead of running a broad query", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];
    const baselineReviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "xbmc",
      repo: "xbmc",
      prNumber: 202,
      action: "review_requested",
      deliveryId: "delivery-202",
      headSha: "abc123",
    });

    const exitCode = await main([
      "--baseline-review-output-key",
      baselineReviewOutputKey,
      "--baseline-delivery-id",
      "delivery-mismatch",
      "--candidate-review-output-key",
      "",
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
    expect(report.status_code).toBe("m048_s02_invalid_arg");
    expect(report.issues).toContain(
      "Baseline --baseline-delivery-id does not match the delivery id encoded in --baseline-review-output-key.",
    );
    expect(report.issues).toContain("Missing required --candidate-review-output-key.");
  });

  test("package.json wires verify:m048:s02 to the compare script", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m048:s02"]).toBe("bun scripts/verify-m048-s02.ts");
  });
});
