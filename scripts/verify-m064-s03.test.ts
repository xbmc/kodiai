import { describe, expect, test } from "bun:test";

type JsonReport = {
  command: string;
  generated_at: string;
  mode: "fixture-matrix" | "operator-lookup";
  record_count: number;
  success: boolean;
  status_code: string;
  records: Array<{
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
  }>;
  issues: string[];
};

async function loadModule() {
  return await import("./verify-m064-s03.ts");
}

describe("verify-m064-s03", () => {
  test("parse args accepts --json and optional --review-output-key", async () => {
    const { parseVerifyM064S03Args } = await loadModule();

    expect(parseVerifyM064S03Args(["--review-output-key", "rok-123", "--json"]))
      .toEqual({ help: false, json: true, reviewOutputKey: "rok-123", invalidArg: null });
  });

  test("evaluate default fixture matrix reports canonical, degraded, pending, superseded, and lookup-failure states explicitly", async () => {
    const { evaluateM064S03 } = await loadModule();

    const report = await evaluateM064S03({ generatedAt: "2026-04-24T08:15:00.000Z" });

    expect(report.success).toBe(true);
    expect(report.mode).toBe("fixture-matrix");
    expect(report.status_code).toBe("m064_s03_ok");
    expect(report.record_count).toBe(6);
    expect(report.records.map((record) => record.recordId)).toEqual([
      "canonical-authority",
      "degraded-projection",
      "pending-continuation",
      "superseded-family",
      "missing-canonical-row",
      "invalid-review-output-key",
    ]);
    expect(report.records.map((record) => record.statusCode)).toEqual([
      "canonical",
      "degraded",
      "pending",
      "superseded",
      "missing-canonical-row",
      "invalid-review-output-key",
    ]);

    expect(report.records.find((record) => record.recordId === "canonical-authority")).toMatchObject({
      success: true,
      repoFullName: "acme/repo",
      prNumber: 101,
      authoritativeAttemptId: "review-work-2",
      authoritativeAttemptOrdinal: 2,
      authoritativeOutcome: "merged",
      finalStopReason: "merged-continuation-results",
      projectionStatus: "canonical",
      supersededByAttemptId: null,
    });

    expect(report.records.find((record) => record.recordId === "degraded-projection")).toMatchObject({
      success: true,
      authoritativeAttemptId: "review-work-1",
      authoritativeAttemptOrdinal: 1,
      authoritativeOutcome: "blocked",
      finalStopReason: "no-follow-up",
      projectionStatus: "degraded",
      supersededByAttemptId: null,
    });

    expect(report.records.find((record) => record.recordId === "pending-continuation")).toMatchObject({
      success: true,
      authoritativeAttemptId: "review-work-2",
      authoritativeAttemptOrdinal: 2,
      authoritativeOutcome: "continuation-pending",
      finalStopReason: "awaiting-continuation",
      projectionStatus: "pending",
      supersededByAttemptId: null,
    });

    expect(report.records.find((record) => record.recordId === "superseded-family")).toMatchObject({
      success: true,
      authoritativeAttemptId: "review-work-3",
      authoritativeAttemptOrdinal: 3,
      authoritativeOutcome: "superseded",
      finalStopReason: "superseded-by-newer-attempt",
      projectionStatus: "canonical",
      supersededByAttemptId: "review-work-3",
    });

    expect(report.records.find((record) => record.recordId === "missing-canonical-row")).toMatchObject({
      success: true,
      statusCode: "missing-canonical-row",
      familyKey: "acme/repo#101",
      baseReviewOutputKey: "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-review_requested:delivery-delivery-404:head-abcdef1234567890",
      authoritativeAttemptId: null,
      finalStopReason: null,
      projectionStatus: null,
    });

    expect(report.records.find((record) => record.recordId === "invalid-review-output-key")).toMatchObject({
      success: true,
      statusCode: "invalid-review-output-key",
      familyKey: null,
      baseReviewOutputKey: null,
      authoritativeAttemptId: null,
      finalStopReason: null,
      projectionStatus: null,
    });
  });

  test("evaluate operator lookup mode returns a single authoritative record for retry reviewOutputKey input", async () => {
    const { evaluateM064S03 } = await loadModule();

    const report = await evaluateM064S03({
      generatedAt: "2026-04-24T08:15:00.000Z",
      reviewOutputKey:
        "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-review_requested:delivery-delivery-123:head-abcdef1234567890-retry-2",
    });

    expect(report.success).toBe(true);
    expect(report.mode).toBe("operator-lookup");
    expect(report.status_code).toBe("m064_s03_ok");
    expect(report.record_count).toBe(1);
    expect(report.records[0]).toMatchObject({
      recordId: "operator-lookup",
      statusCode: "canonical",
      reviewOutputKey:
        "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-review_requested:delivery-delivery-123:head-abcdef1234567890-retry-2",
      baseReviewOutputKey:
        "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-review_requested:delivery-delivery-123:head-abcdef1234567890",
      familyKey: "acme/repo#101",
      retryAttempt: 2,
      effectiveDeliveryId: "delivery-123-retry-2",
      authoritativeAttemptId: "review-work-2",
      authoritativeAttemptOrdinal: 2,
      authoritativeOutcome: "merged",
      finalStopReason: "merged-continuation-results",
      projectionStatus: "canonical",
      supersededByAttemptId: null,
    });
  });

  test("evaluate operator lookup mode honors an injected live knowledge store for non-fixture review keys", async () => {
    const { evaluateM064S03 } = await loadModule();
    const reviewOutputKey = "kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-80:action-mention-review:delivery-66b4ee50-32bc-11f1-9eeb-89b961f025e8:head-fa9e8cad5c63e2723598bd582a3f47538176ea61";

    const report = await evaluateM064S03({
      generatedAt: "2026-04-24T08:15:00.000Z",
      reviewOutputKey,
      knowledgeStore: {
        getContinuationFamilyState: async () => ({
          familyKey: "xbmc/kodiai#80",
          baseReviewOutputKey: reviewOutputKey,
          authoritativeAttemptId: "review-work-9",
          authoritativeAttemptOrdinal: 9,
          authoritativeOutcome: "merged",
          finalStopReason: "merged-continuation-results",
          projectionStatus: "canonical",
          supersededByAttemptId: null,
        }),
      },
    });

    expect(report.success).toBe(true);
    expect(report.mode).toBe("operator-lookup");
    expect(report.records[0]).toMatchObject({
      recordId: "operator-lookup",
      statusCode: "canonical",
      familyKey: "xbmc/kodiai#80",
      repoFullName: "xbmc/kodiai",
      prNumber: 80,
      action: "mention-review",
      deliveryId: "66b4ee50-32bc-11f1-9eeb-89b961f025e8",
      effectiveDeliveryId: "66b4ee50-32bc-11f1-9eeb-89b961f025e8",
      authoritativeAttemptId: "review-work-9",
      authoritativeAttemptOrdinal: 9,
      authoritativeOutcome: "merged",
      finalStopReason: "merged-continuation-results",
      projectionStatus: "canonical",
    });
  });

  test("main rejects malformed operator lookup args with a named invalid-arg status", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];

    const exitCode = await main(["--review-output-key", "--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: () => undefined },
    });

    const report = JSON.parse(stdoutChunks.join("")) as JsonReport;
    expect(exitCode).toBe(1);
    expect(report.status_code).toBe("m064_s03_invalid_arg");
    expect(report.issues).toContain("Missing value for --review-output-key.");
  });

  test("main emits json for fixture mode and keeps canonical lifecycle fields explicit", async () => {
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
    expect(report.command).toBe("verify:m064:s03");
    expect(report.generated_at).toBeString();
    expect(report.status_code).toBe("m064_s03_ok");
    expect(report.records.every((record) => typeof record.reviewOutputKey === "string")).toBe(true);
    expect(report.records.every((record) => "statusCode" in record)).toBe(true);
    expect(report.records.some((record) => record.projectionStatus === "degraded")).toBe(true);
    expect(report.records.some((record) => record.projectionStatus === "pending")).toBe(true);
  });

  test("render report keeps human output ordered around authoritative outcome and projection status", async () => {
    const { evaluateM064S03, renderM064S03Report } = await loadModule();

    const report = await evaluateM064S03({ generatedAt: "2026-04-24T08:15:00.000Z" });
    const human = renderM064S03Report(report);

    expect(human).toContain("# M064 S03 — Canonical Operator Evidence Report");
    expect(human).toContain("Status: m064_s03_ok");
    expect(human).toContain("canonical-authority: canonical");
    expect(human).toContain("degraded-projection: degraded");
    expect(human).toContain("pending-continuation: pending");
    expect(human).toContain("superseded-family: superseded");
    expect(human).toContain(
      "authoritativeOutcome=merged finalStopReason=merged-continuation-results authoritativeAttemptId=review-work-2 projectionStatus=canonical supersededByAttemptId=none",
    );
    expect(human).toContain(
      "authoritativeOutcome=blocked finalStopReason=no-follow-up authoritativeAttemptId=review-work-1 projectionStatus=degraded supersededByAttemptId=none",
    );
    expect(human).toContain(
      "authoritativeOutcome=continuation-pending finalStopReason=awaiting-continuation authoritativeAttemptId=review-work-2 projectionStatus=pending supersededByAttemptId=none",
    );
    expect(human).toContain(
      "authoritativeOutcome=superseded finalStopReason=superseded-by-newer-attempt authoritativeAttemptId=review-work-3 projectionStatus=canonical supersededByAttemptId=review-work-3",
    );
    expect(human).toContain("missing-canonical-row: missing-canonical-row");
    expect(human).toContain("invalid-review-output-key: invalid-review-output-key");
  });

  test("package.json wires verify:m064:s03 to the verifier script", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m064:s03"]).toBe("bun scripts/verify-m064-s03.ts");
  });
});
