import { describe, expect, test } from "bun:test";
import { buildReviewOutputKey } from "../src/handlers/review-idempotency.ts";

type RuntimeReport = {
  command: "verify:m048:s01";
  generated_at: string;
  review_output_key: string | null;
  delivery_id: string | null;
  success: boolean;
  status_code: string;
  issues: string[];
  evidence?: {
    conclusion?: string | null;
    published?: boolean | null;
  } | null;
  [key: string]: unknown;
};

type VisibleReport = {
  command: "verify:m049:s02";
  generated_at: string;
  repo: string;
  review_output_key: string | null;
  delivery_id: string | null;
  success: boolean;
  status_code: string;
  issues: string[];
  artifact?: {
    prNumber: number;
    source: string;
    lane: string | null;
    reviewState: string | null;
  } | null;
  bodyContract?: {
    valid: boolean;
  } | null;
  [key: string]: unknown;
};

type OperatorRecord = {
  recordId: string;
  success: boolean;
  statusCode: string;
  detail: string;
  reviewOutputKey: string;
  baseReviewOutputKey: string | null;
  familyKey: string | null;
  repoFullName: string | null;
  prNumber: number | null;
  action: string | null;
  deliveryId: string | null;
  effectiveDeliveryId: string | null;
  retryAttempt: number | null;
  authoritativeAttemptId: string | null;
  authoritativeAttemptOrdinal: number | null;
  authoritativeOutcome: string | null;
  finalStopReason: string | null;
  projectionStatus: string | null;
  supersededByAttemptId: string | null;
  issues: string[];
};

type OperatorReport = {
  command: "verify:m064:s03";
  generated_at: string;
  mode: string;
  record_count: number;
  success: boolean;
  status_code: string;
  records: OperatorRecord[];
  issues: string[];
  [key: string]: unknown;
};

type JsonReport = {
  command: "verify:m065:s02";
  generated_at: string;
  success: boolean;
  status_code: string;
  review_output_key: string | null;
  normalized_review_output_key: string | null;
  delivery_id: string | null;
  repo: string | null;
  proof_target: {
    review_output_key: string | null;
    base_review_output_key: string | null;
    delivery_id: string | null;
    repo: string | null;
    pr_number: number | null;
  };
  check_ids: Array<
    | "M065-S02-IDENTITY-CORRELATION"
    | "M065-S02-RUNTIME-TIMING-EVIDENCE"
    | "M065-S02-VISIBLE-REVIEW-PROOF"
    | "M065-S02-CANONICAL-OPERATOR-EVIDENCE"
    | "M065-S02-REPRESENTATIVE-LIVE-BUNDLE"
  >;
  checks: Array<{
    id: JsonReport["check_ids"][number];
    passed: boolean;
    skipped: boolean;
    status_code: string;
    detail?: string;
    drill_down: {
      command: string;
      report_key: string;
      nested_status_code?: string;
    };
  }>;
  nested_reports: {
    runtimeTiming: RuntimeReport | null;
    visibleReview: VisibleReport | null;
    operatorEvidence: OperatorReport | null;
  };
  failing_check_id: JsonReport["check_ids"][number] | null;
  issues: string[];
};

function makeReviewKey(overrides?: Partial<{
  owner: string;
  repo: string;
  prNumber: number;
  action: string;
  deliveryId: string;
  headSha: string;
}>) {
  return buildReviewOutputKey({
    installationId: 42,
    owner: overrides?.owner ?? "xbmc",
    repo: overrides?.repo ?? "kodiai",
    prNumber: overrides?.prNumber ?? 101,
    action: overrides?.action ?? "mention-review",
    deliveryId: overrides?.deliveryId ?? "delivery-101",
    headSha: overrides?.headSha ?? "head-101",
  });
}

function makeRuntimeReport(overrides?: Partial<RuntimeReport>): RuntimeReport {
  return {
    command: "verify:m048:s01",
    generated_at: "2026-04-24T09:45:00.000Z",
    review_output_key: makeReviewKey(),
    delivery_id: "delivery-101",
    success: true,
    status_code: "m048_s01_ok",
    issues: [],
    evidence: {
      conclusion: "success",
      published: true,
    },
    ...overrides,
  };
}

function makeVisibleReport(overrides?: Partial<VisibleReport>): VisibleReport {
  return {
    command: "verify:m049:s02",
    generated_at: "2026-04-24T09:45:00.000Z",
    repo: "xbmc/kodiai",
    review_output_key: makeReviewKey(),
    delivery_id: "delivery-101",
    success: true,
    status_code: "m049_s02_ok",
    issues: [],
    artifact: {
      prNumber: 101,
      source: "review",
      lane: "explicit",
      reviewState: "APPROVED",
    },
    bodyContract: {
      valid: true,
    },
    ...overrides,
  };
}

function makeOperatorRecord(overrides?: Partial<OperatorRecord>): OperatorRecord {
  return {
    recordId: "operator-lookup",
    success: true,
    statusCode: "canonical",
    detail: "Resolved canonical continuation-family state with outcome=merged.",
    reviewOutputKey: makeReviewKey(),
    baseReviewOutputKey: makeReviewKey(),
    familyKey: "xbmc/kodiai#101",
    repoFullName: "xbmc/kodiai",
    prNumber: 101,
    action: "mention-review",
    deliveryId: "delivery-101",
    effectiveDeliveryId: "delivery-101",
    retryAttempt: null,
    authoritativeAttemptId: "review-work-2",
    authoritativeAttemptOrdinal: 2,
    authoritativeOutcome: "merged",
    finalStopReason: "merged-continuation-results",
    projectionStatus: "canonical",
    supersededByAttemptId: null,
    issues: [],
    ...overrides,
  };
}

function makeOperatorReport(overrides?: Partial<OperatorReport>): OperatorReport {
  const record = makeOperatorRecord();
  return {
    command: "verify:m064:s03",
    generated_at: "2026-04-24T09:45:00.000Z",
    mode: "operator-lookup",
    record_count: 1,
    success: true,
    status_code: "m064_s03_ok",
    records: [record],
    issues: [],
    ...overrides,
  };
}

async function loadModule() {
  return await import("./verify-m065-s02.ts");
}

describe("verify-m065-s02", () => {
  test("parse args accepts review-output-key plus optional delivery-id, repo, and json", async () => {
    const { parseVerifyM065S02Args } = await loadModule();

    const result = parseVerifyM065S02Args([
      "--review-output-key",
      makeReviewKey(),
      "--delivery-id",
      "delivery-101",
      "--repo",
      "xbmc/kodiai",
      "--json",
    ]);

    expect(result).toEqual({
      help: false,
      json: true,
      reviewOutputKey: makeReviewKey(),
      deliveryId: "delivery-101",
      repo: "xbmc/kodiai",
      invalidArg: null,
    });
  });

  test("parse args does not consume the next flag when an option value is missing", async () => {
    const { parseVerifyM065S02Args } = await loadModule();

    const result = parseVerifyM065S02Args([
      "--review-output-key",
      "--repo",
      "xbmc/kodiai",
      "--json",
    ]);

    expect(result.reviewOutputKey).toBeNull();
    expect(result.repo).toBe("xbmc/kodiai");
    expect(result.json).toBe(true);
  });

  test("parse args rejects unknown flags with a named invalidArg result", async () => {
    const { parseVerifyM065S02Args } = await loadModule();

    expect(parseVerifyM065S02Args(["--wat"]))
      .toEqual({ help: false, json: false, reviewOutputKey: null, deliveryId: null, repo: null, invalidArg: "Unknown argument: --wat." });
  });

  test("stable check ids stay pinned to identity, runtime, visible review, operator evidence, and bundle sufficiency", async () => {
    const { M065_S02_CHECK_IDS } = await loadModule();

    expect(M065_S02_CHECK_IDS).toEqual([
      "M065-S02-IDENTITY-CORRELATION",
      "M065-S02-RUNTIME-TIMING-EVIDENCE",
      "M065-S02-VISIBLE-REVIEW-PROOF",
      "M065-S02-CANONICAL-OPERATOR-EVIDENCE",
      "M065-S02-REPRESENTATIVE-LIVE-BUNDLE",
    ]);
  });

  test("representative live bundle passes only when runtime, visible review, and canonical operator evidence agree on the same base identity", async () => {
    const { evaluateM065S02 } = await loadModule();
    const reviewOutputKey = makeReviewKey();

    const report = await evaluateM065S02({
      reviewOutputKey,
      generatedAt: "2026-04-24T09:45:00.000Z",
      runtimeTimingEvaluator: async ({ reviewOutputKey: nestedKey, deliveryId }) =>
        makeRuntimeReport({ review_output_key: nestedKey, delivery_id: deliveryId }),
      visibleReviewEvaluator: async ({ repo, reviewOutputKey: nestedKey }) =>
        makeVisibleReport({ repo, review_output_key: nestedKey }),
      operatorEvidenceEvaluator: async ({ reviewOutputKey: nestedKey }) =>
        makeOperatorReport({
          records: [makeOperatorRecord({ reviewOutputKey: nestedKey, baseReviewOutputKey: nestedKey })],
        }),
    });

    expect(report).toMatchObject({
      command: "verify:m065:s02",
      generated_at: "2026-04-24T09:45:00.000Z",
      success: true,
      status_code: "m065_s02_ok",
      review_output_key: reviewOutputKey,
      normalized_review_output_key: reviewOutputKey,
      delivery_id: "delivery-101",
      repo: "xbmc/kodiai",
      proof_target: {
        review_output_key: reviewOutputKey,
        base_review_output_key: reviewOutputKey,
        delivery_id: "delivery-101",
        repo: "xbmc/kodiai",
        pr_number: 101,
      },
    } satisfies Partial<JsonReport>);

    expect(report.checks).toEqual([
      {
        id: "M065-S02-IDENTITY-CORRELATION",
        passed: true,
        skipped: false,
        status_code: "identity_correlated",
        detail: "reviewOutputKey is normalized to the captured base identity and all explicit or nested identities agree.",
        drill_down: {
          command: "bun run verify:m065:s02 -- --json",
          report_key: "proof_target",
        },
      },
      {
        id: "M065-S02-RUNTIME-TIMING-EVIDENCE",
        passed: true,
        skipped: false,
        status_code: "nested_report_ok",
        detail: "Preserved authoritative verify:m048:s01 report.",
        drill_down: {
          command: "bun run verify:m048:s01 -- --json",
          report_key: "nested_reports.runtimeTiming",
          nested_status_code: "m048_s01_ok",
        },
      },
      {
        id: "M065-S02-VISIBLE-REVIEW-PROOF",
        passed: true,
        skipped: false,
        status_code: "nested_report_ok",
        detail: "Preserved authoritative verify:m049:s02 report.",
        drill_down: {
          command: "bun run verify:m049:s02 -- --json",
          report_key: "nested_reports.visibleReview",
          nested_status_code: "m049_s02_ok",
        },
      },
      {
        id: "M065-S02-CANONICAL-OPERATOR-EVIDENCE",
        passed: true,
        skipped: false,
        status_code: "nested_report_ok",
        detail: "Preserved authoritative verify:m064:s03 report.",
        drill_down: {
          command: "bun run verify:m064:s03 -- --json",
          report_key: "nested_reports.operatorEvidence",
          nested_status_code: "m064_s03_ok",
        },
      },
      {
        id: "M065-S02-REPRESENTATIVE-LIVE-BUNDLE",
        passed: true,
        skipped: false,
        status_code: "representative_bundle_ok",
        detail: "Runtime timing, visible review proof, and canonical operator evidence describe the same captured live large-PR run.",
        drill_down: {
          command: "bun run verify:m065:s02 -- --json",
          report_key: "checks[4]",
        },
      },
    ]);
    expect(report.failing_check_id).toBeNull();
    expect(report.issues).toEqual([]);
  });

  test("representative live bundle normalizes retry review-output keys back to the base key before evaluating nested proofs", async () => {
    const { evaluateM065S02 } = await loadModule();
    const baseReviewOutputKey = makeReviewKey();
    const retryKey = `${baseReviewOutputKey}-retry-2`;

    const runtimeCalls: Array<{ reviewOutputKey: string; deliveryId: string }> = [];
    const visibleCalls: Array<{ repo: string; reviewOutputKey: string }> = [];
    const operatorCalls: Array<{ reviewOutputKey: string }> = [];

    const report = await evaluateM065S02({
      reviewOutputKey: retryKey,
      generatedAt: "2026-04-24T09:45:00.000Z",
      runtimeTimingEvaluator: async (params) => {
        runtimeCalls.push(params);
        return makeRuntimeReport({ review_output_key: params.reviewOutputKey, delivery_id: params.deliveryId });
      },
      visibleReviewEvaluator: async (params) => {
        visibleCalls.push(params);
        return makeVisibleReport({ repo: params.repo, review_output_key: params.reviewOutputKey });
      },
      operatorEvidenceEvaluator: async (params) => {
        operatorCalls.push(params);
        return makeOperatorReport({ records: [makeOperatorRecord({ reviewOutputKey: params.reviewOutputKey, baseReviewOutputKey: params.reviewOutputKey })] });
      },
    });

    expect(runtimeCalls).toEqual([{ reviewOutputKey: baseReviewOutputKey, deliveryId: "delivery-101" }]);
    expect(visibleCalls).toEqual([{ repo: "xbmc/kodiai", reviewOutputKey: baseReviewOutputKey }]);
    expect(operatorCalls).toEqual([{ reviewOutputKey: baseReviewOutputKey }]);
    expect(report.review_output_key).toBe(retryKey);
    expect(report.normalized_review_output_key).toBe(baseReviewOutputKey);
    expect(report.proof_target.base_review_output_key).toBe(baseReviewOutputKey);
    expect(report.success).toBe(true);
  });

  test("evaluate rejects malformed nested report blocks instead of flattening or omitting them", async () => {
    const { evaluateM065S02 } = await loadModule();

    const report = await evaluateM065S02({
      reviewOutputKey: makeReviewKey(),
      generatedAt: "2026-04-24T09:45:00.000Z",
      runtimeTimingEvaluator: async () => ({
        command: "verify:m048:s01",
        generated_at: "2026-04-24T09:45:00.000Z",
        success: true,
        issues: [],
      }),
      visibleReviewEvaluator: async () => makeVisibleReport(),
      operatorEvidenceEvaluator: async () => makeOperatorReport(),
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m065_s02_nested_contract_failed");
    expect(report.failing_check_id).toBe("M065-S02-RUNTIME-TIMING-EVIDENCE");
    expect(report.checks.find((check) => check.id === "M065-S02-RUNTIME-TIMING-EVIDENCE")).toMatchObject({
      passed: false,
      skipped: false,
      status_code: "nested_report_malformed",
      drill_down: {
        command: "bun run verify:m048:s01 -- --json",
        report_key: "nested_reports.runtimeTiming",
      },
    });
  });

  test("representative live bundle fails when nested proofs disagree on delivery, repo, or PR identity", async () => {
    const { evaluateM065S02 } = await loadModule();

    const report = await evaluateM065S02({
      reviewOutputKey: makeReviewKey(),
      generatedAt: "2026-04-24T09:45:00.000Z",
      runtimeTimingEvaluator: async () => makeRuntimeReport({ delivery_id: "delivery-999" }),
      visibleReviewEvaluator: async () => makeVisibleReport({ repo: "other/repo", artifact: { prNumber: 999, source: "review", lane: "explicit", reviewState: "APPROVED" } }),
      operatorEvidenceEvaluator: async () => makeOperatorReport(),
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m065_s02_nested_verifier_failed");
    expect(report.failing_check_id).toBe("M065-S02-IDENTITY-CORRELATION");
    expect(report.checks.find((check) => check.id === "M065-S02-IDENTITY-CORRELATION")).toMatchObject({
      passed: false,
      skipped: false,
      status_code: "identity_mismatch",
    });
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining("runtime timing evidence delivery_id mismatch"),
      expect.stringContaining("visible review proof repo mismatch"),
      expect.stringContaining("visible review proof pr_number mismatch"),
    ]));
  });

  test("representative live bundle fails when runtime evidence is unavailable even if the other seams pass", async () => {
    const { evaluateM065S02 } = await loadModule();

    const report = await evaluateM065S02({
      reviewOutputKey: makeReviewKey(),
      generatedAt: "2026-04-24T09:45:00.000Z",
      runtimeTimingEvaluator: async () => makeRuntimeReport({ success: false, status_code: "m048_s01_azure_unavailable", issues: ["Azure Log Analytics query failed: timed out"] }),
      visibleReviewEvaluator: async () => makeVisibleReport(),
      operatorEvidenceEvaluator: async () => makeOperatorReport(),
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m065_s02_nested_verifier_failed");
    expect(report.failing_check_id).toBe("M065-S02-RUNTIME-TIMING-EVIDENCE");
    expect(report.issues).toContain("M065-S02-RUNTIME-TIMING-EVIDENCE: verify:m048:s01 returned m048_s01_azure_unavailable");
  });

  test("representative live bundle fails when visible review proof reports duplicate or drifting artifacts", async () => {
    const { evaluateM065S02 } = await loadModule();

    const report = await evaluateM065S02({
      reviewOutputKey: makeReviewKey(),
      generatedAt: "2026-04-24T09:45:00.000Z",
      runtimeTimingEvaluator: async () => makeRuntimeReport(),
      visibleReviewEvaluator: async () => makeVisibleReport({ success: false, status_code: "m049_s02_duplicate_visible_outputs", issues: ["multiple matching review artifacts"] }),
      operatorEvidenceEvaluator: async () => makeOperatorReport(),
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m065_s02_nested_verifier_failed");
    expect(report.failing_check_id).toBe("M065-S02-VISIBLE-REVIEW-PROOF");
  });

  test("representative live bundle fails when operator evidence is missing or malformed", async () => {
    const { evaluateM065S02 } = await loadModule();

    const missingCanonical = await evaluateM065S02({
      reviewOutputKey: makeReviewKey(),
      generatedAt: "2026-04-24T09:45:00.000Z",
      runtimeTimingEvaluator: async () => makeRuntimeReport(),
      visibleReviewEvaluator: async () => makeVisibleReport(),
      operatorEvidenceEvaluator: async () => makeOperatorReport({ success: false, status_code: "m064_s03_ok", records: [makeOperatorRecord({ success: false, statusCode: "missing-canonical-row" })] }),
    });

    expect(missingCanonical.success).toBe(false);
    expect(missingCanonical.status_code).toBe("m065_s02_nested_verifier_failed");
    expect(missingCanonical.failing_check_id).toBe("M065-S02-CANONICAL-OPERATOR-EVIDENCE");

    const malformed = await evaluateM065S02({
      reviewOutputKey: makeReviewKey(),
      generatedAt: "2026-04-24T09:45:00.000Z",
      runtimeTimingEvaluator: async () => makeRuntimeReport(),
      visibleReviewEvaluator: async () => makeVisibleReport(),
      operatorEvidenceEvaluator: async () => ({
        command: "verify:m064:s03",
        generated_at: "2026-04-24T09:45:00.000Z",
        success: true,
        status_code: "m064_s03_ok",
        issues: [],
      }),
    });

    expect(malformed.success).toBe(false);
    expect(malformed.status_code).toBe("m065_s02_nested_contract_failed");
    expect(malformed.failing_check_id).toBe("M065-S02-CANONICAL-OPERATOR-EVIDENCE");
  });

  test("representative live bundle accepts only canonical operator truth and rejects pending, degraded, or superseded family state", async () => {
    const { evaluateM065S02 } = await loadModule();

    for (const operatorStatus of ["pending", "degraded", "superseded"] as const) {
      const report = await evaluateM065S02({
        reviewOutputKey: makeReviewKey(),
        generatedAt: "2026-04-24T09:45:00.000Z",
        runtimeTimingEvaluator: async () => makeRuntimeReport(),
        visibleReviewEvaluator: async () => makeVisibleReport(),
        operatorEvidenceEvaluator: async () => makeOperatorReport({
          records: [makeOperatorRecord({ statusCode: operatorStatus, projectionStatus: operatorStatus === "degraded" ? "degraded" : "canonical", authoritativeOutcome: operatorStatus === "pending" ? "continuation-pending" : operatorStatus === "superseded" ? "superseded" : "merged" })],
        }),
      });

      expect(report.success).toBe(false);
      expect(report.status_code).toBe("m065_s02_nested_verifier_failed");
      expect(report.failing_check_id).toBe("M065-S02-REPRESENTATIVE-LIVE-BUNDLE");
      expect(report.checks.find((check) => check.id === "M065-S02-REPRESENTATIVE-LIVE-BUNDLE")).toMatchObject({
        passed: false,
        skipped: false,
        status_code: "representative_bundle_insufficient",
      });
      expect(report.issues).toContain(`M065-S02-REPRESENTATIVE-LIVE-BUNDLE: operator evidence status ${operatorStatus} is not sufficient for representative live proof.`);
    }
  });

  test("main invalid arg rejects missing review-output-key, malformed review-output-key, malformed repo, and delivery mismatches before evaluation", async () => {
    const { main } = await loadModule();

    const missingStdout: string[] = [];
    const missingExit = await main(["--json"], {
      stdout: { write: (chunk: string) => void missingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => {
        throw new Error("should not be called");
      },
    });
    const missingReport = JSON.parse(missingStdout.join("")) as JsonReport;
    expect(missingExit).toBe(1);
    expect(missingReport.status_code).toBe("m065_s02_invalid_arg");
    expect(missingReport.issues).toContain("Missing required --review-output-key.");

    const malformedKeyStdout: string[] = [];
    const malformedKeyExit = await main(["--review-output-key", "not-a-review-output-key", "--json"], {
      stdout: { write: (chunk: string) => void malformedKeyStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => {
        throw new Error("should not be called");
      },
    });
    const malformedKeyReport = JSON.parse(malformedKeyStdout.join("")) as JsonReport;
    expect(malformedKeyExit).toBe(1);
    expect(malformedKeyReport.issues).toContain("Malformed --review-output-key.");

    const malformedRepoStdout: string[] = [];
    const malformedRepoExit = await main([
      "--review-output-key",
      makeReviewKey(),
      "--repo",
      "xbmc",
      "--json",
    ], {
      stdout: { write: (chunk: string) => void malformedRepoStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => {
        throw new Error("should not be called");
      },
    });
    const malformedRepoReport = JSON.parse(malformedRepoStdout.join("")) as JsonReport;
    expect(malformedRepoExit).toBe(1);
    expect(malformedRepoReport.issues).toContain("Invalid repo 'xbmc'. Expected owner/repo.");

    const mismatchStdout: string[] = [];
    const mismatchExit = await main([
      "--review-output-key",
      makeReviewKey(),
      "--delivery-id",
      "delivery-999",
      "--json",
    ], {
      stdout: { write: (chunk: string) => void mismatchStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => {
        throw new Error("should not be called");
      },
    });
    const mismatchReport = JSON.parse(mismatchStdout.join("")) as JsonReport;
    expect(mismatchExit).toBe(1);
    expect(mismatchReport.issues).toContain(
      "Provided --delivery-id does not match the delivery id encoded in --review-output-key.",
    );
  });

  test("main invalid arg rejects unknown flags and missing option values with a named status", async () => {
    const { main } = await loadModule();

    const unknownStdout: string[] = [];
    const unknownExit = await main(["--wat", "--json"], {
      stdout: { write: (chunk: string) => void unknownStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => {
        throw new Error("should not be called");
      },
    });

    const unknownReport = JSON.parse(unknownStdout.join("")) as JsonReport;
    expect(unknownExit).toBe(1);
    expect(unknownReport.status_code).toBe("m065_s02_invalid_arg");
    expect(unknownReport.issues).toContain("Unknown argument: --wat.");

    const missingValueStdout: string[] = [];
    const missingValueExit = await main(["--repo", "--json"], {
      stdout: { write: (chunk: string) => void missingValueStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => {
        throw new Error("should not be called");
      },
    });

    const missingValueReport = JSON.parse(missingValueStdout.join("")) as JsonReport;
    expect(missingValueExit).toBe(1);
    expect(missingValueReport.issues).toContain("Missing value for --repo.");
  });

  test("main prints help, supports json output, and preserves the dedicated command name", async () => {
    const { main } = await loadModule();
    const helpStdout: string[] = [];

    const helpExit = await main(["--help"], {
      stdout: { write: (chunk: string) => void helpStdout.push(chunk) },
      stderr: { write: () => undefined },
    });

    expect(helpExit).toBe(0);
    expect(helpStdout.join("")).toContain(
      "Usage: bun run verify:m065:s02 -- --review-output-key <key> [--delivery-id <id>] [--repo <owner/repo>] [--json]",
    );

    const jsonStdout: string[] = [];
    const jsonExit = await main([
      "--review-output-key",
      makeReviewKey(),
      "--json",
    ], {
      stdout: { write: (chunk: string) => void jsonStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async ({ reviewOutputKey }) => ({
        command: "verify:m065:s02",
        generated_at: "2026-04-24T09:45:00.000Z",
        success: true,
        status_code: "m065_s02_ok",
        review_output_key: reviewOutputKey,
        normalized_review_output_key: reviewOutputKey,
        delivery_id: "delivery-101",
        repo: "xbmc/kodiai",
        proof_target: {
          review_output_key: reviewOutputKey,
          base_review_output_key: reviewOutputKey,
          delivery_id: "delivery-101",
          repo: "xbmc/kodiai",
          pr_number: 101,
        },
        check_ids: [
          "M065-S02-IDENTITY-CORRELATION",
          "M065-S02-RUNTIME-TIMING-EVIDENCE",
          "M065-S02-VISIBLE-REVIEW-PROOF",
          "M065-S02-CANONICAL-OPERATOR-EVIDENCE",
          "M065-S02-REPRESENTATIVE-LIVE-BUNDLE",
        ],
        checks: [],
        nested_reports: {
          runtimeTiming: null,
          visibleReview: null,
          operatorEvidence: null,
        },
        failing_check_id: null,
        issues: [],
      }),
    });

    const jsonReport = JSON.parse(jsonStdout.join("")) as JsonReport;
    expect(jsonExit).toBe(0);
    expect(jsonReport.command).toBe("verify:m065:s02");
    expect(jsonReport.status_code).toBe("m065_s02_ok");
  });

  test("package.json wires verify:m065:s02 to the dedicated verifier script", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m065:s02"]).toBe("bun scripts/verify-m065-s02.ts");
  });
});
