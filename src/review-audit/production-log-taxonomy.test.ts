import { describe, expect, test } from "bun:test";
import { buildReviewOutputKey } from "../handlers/review-idempotency.ts";
import type { NormalizedLogAnalyticsRow } from "./log-analytics.ts";
import {
  buildBaselineWindowFromObservations,
  buildBaselineWindowFromRows,
  buildProductionLogBaselineReport,
  classifyProductionLogRow,
  findProductionLogIssueClass,
  type ProductionLogIssueClassId,
} from "./production-log-taxonomy.ts";

function reviewOutputKey(prNumber: number, deliveryId = `delivery-${prNumber}`): string {
  return buildReviewOutputKey({
    installationId: 42,
    owner: "xbmc",
    repo: "xbmc",
    prNumber,
    action: "review_requested",
    deliveryId,
    headSha: `head-${prNumber}`,
  });
}

function row(params: {
  msg?: string;
  parsedLog?: Record<string, unknown> | null;
  rawLog?: string | null;
  malformed?: boolean;
  prNumber?: number;
  deliveryId?: string;
  reviewOutputKey?: string;
  containerAppName?: string;
  revisionName?: string;
  timeGenerated?: string;
}): NormalizedLogAnalyticsRow {
  const key = params.reviewOutputKey ?? reviewOutputKey(params.prNumber ?? 101, params.deliveryId);
  const parsedLog = params.parsedLog === undefined
    ? {
      msg: params.msg,
      repo: "xbmc/xbmc",
      prNumber: params.prNumber ?? 101,
      deliveryId: params.deliveryId ?? `delivery-${params.prNumber ?? 101}`,
      reviewOutputKey: key,
    }
    : params.parsedLog;

  return {
    timeGenerated: params.timeGenerated ?? "2026-05-20T12:00:00.000Z",
    rawLog: params.rawLog ?? (parsedLog ? JSON.stringify(parsedLog) : null),
    malformed: params.malformed ?? false,
    deliveryId: typeof parsedLog?.deliveryId === "string" ? parsedLog.deliveryId : null,
    reviewOutputKey: typeof parsedLog?.reviewOutputKey === "string" ? parsedLog.reviewOutputKey : key,
    message: params.msg ?? (typeof parsedLog?.msg === "string" ? parsedLog.msg : params.rawLog ?? null),
    revisionName: params.revisionName ?? "ca-kodiai--0000076",
    containerAppName: params.containerAppName ?? "ca-kodiai",
    parsedLog,
  };
}

function count(report: ReturnType<typeof buildBaselineWindowFromRows>, classId: ProductionLogIssueClassId): number {
  return findProductionLogIssueClass(report, classId).count;
}

describe("production log taxonomy", () => {
  test("classifies M075 app-actionable rows into explicit bounded issue classes", () => {
    const rows = [
      row({
        msg: "Knowledge store write failed (non-fatal): undefined persistence payload",
        prNumber: 101,
      }),
      row({
        msg: "Inline publication failed: line-not-commentable-in-pr-diff",
        prNumber: 102,
      }),
      row({
        msg: "Review candidate publication completed with non-approved mode",
        parsedLog: {
          msg: "Review candidate publication completed with non-approved mode",
          repo: "xbmc/xbmc",
          prNumber: 103,
          deliveryId: "delivery-103",
          reviewOutputKey: reviewOutputKey(103),
          reasonCodes: [],
        },
        prNumber: 103,
      }),
      row({
        msg: "Review execution timeout after remote runtime budget exceeded",
        prNumber: 104,
      }),
      row({
        msg: "addon-check timed out while waiting for checks",
        prNumber: 105,
      }),
    ];

    const report = buildBaselineWindowFromRows({
      window: "last12h",
      rows,
      workspaceCount: 1,
    });

    expect(count(report, "knowledge-store.undefined-write")).toBe(1);
    expect(count(report, "inline-publication.line-not-commentable")).toBe(1);
    expect(count(report, "candidate-publication.non-approved-missing-reason")).toBe(1);
    expect(count(report, "review.timeout-or-long-run")).toBe(1);
    expect(count(report, "addon-check.timeout")).toBe(1);
    expect(report.source).toEqual({ availability: "present", workspaceCount: 1, queryWindow: "last12h" });
    expect(report.redaction.passed).toBe(true);

    const candidateExample = findProductionLogIssueClass(report, "candidate-publication.non-approved-missing-reason").examples[0];
    expect(candidateExample).toEqual({
      timeGenerated: "2026-05-20T12:00:00.000Z",
      repo: "xbmc/xbmc",
      prNumber: 103,
      reviewOutputKey: reviewOutputKey(103),
      deliveryId: "delivery-103",
    });
  });

  test("separates Azure and ACA platform noise from app-actionable classes", () => {
    const azureRow = row({
      msg: "ACA Job completed status=succeeded revision ca-kodiai--0000076",
      parsedLog: {
        msg: "ACA Job completed",
        status: "succeeded",
        deliveryId: "delivery-201",
        reviewOutputKey: reviewOutputKey(201),
      },
      prNumber: 201,
    });

    expect(classifyProductionLogRow(azureRow)).toBe("azure.platform-noise");

    const report = buildBaselineWindowFromRows({ window: "last12h", rows: [azureRow] });
    expect(count(report, "azure.platform-noise")).toBe(1);
    expect(count(report, "knowledge-store.undefined-write")).toBe(0);
    expect(findProductionLogIssueClass(report, "azure.platform-noise").classification).toBe("azure-platform");
    expect(findProductionLogIssueClass(report, "azure.platform-noise").downstreamOwner).toBeNull();
  });

  test("malformed and empty windows produce bounded valid reports rather than throwing", () => {
    const malformed = row({
      rawLog: "{not-json",
      parsedLog: null,
      malformed: true,
      msg: "{not-json",
      reviewOutputKey: null as unknown as string,
    });

    const malformedReport = buildBaselineWindowFromRows({ window: "last12h", rows: [malformed], workspaceCount: 1 });
    expect(malformedReport.totalRowCount).toBe(1);
    expect(malformedReport.malformedRowCount).toBe(1);
    expect(malformedReport.issueClasses.every((issueClass) => issueClass.count === 0)).toBe(true);
    expect(malformedReport.redaction.passed).toBe(true);

    const emptyReport = buildProductionLogBaselineReport({
      generatedAt: "2026-05-20T12:00:00.000Z",
      windows: {
        last12h: { rows: [], workspaceCount: 1 },
        last7d: { observations: [], workspaceCount: 1 },
      },
    });

    expect(emptyReport.windows.last12h.source.availability).toBe("missing");
    expect(emptyReport.windows.last12h.totalRowCount).toBe(0);
    expect(emptyReport.windows.last7d.source.availability).toBe("missing");
    expect(emptyReport.windows.last7d.issueClasses).toHaveLength(6);
  });

  test("caps examples per class while counts continue to scale with volume", () => {
    const rows = Array.from({ length: 20 }, (_, index) => row({
      msg: "Knowledge store write failed (non-fatal): undefined persistence payload",
      prNumber: 300 + index,
      deliveryId: `delivery-${300 + index}`,
    }));

    const report = buildBaselineWindowFromRows({
      window: "last7d",
      rows,
      maxExamplesPerClass: 2,
    });
    const summary = findProductionLogIssueClass(report, "knowledge-store.undefined-write");

    expect(summary.count).toBe(20);
    expect(summary.examples).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain("undefined persistence payload");
  });

  test("redaction canaries fail the redaction check without copying unsafe payloads into examples", () => {
    const report = buildBaselineWindowFromRows({
      window: "last12h",
      rows: [
        row({
          msg: "Review candidate publication completed with non-approved mode",
          parsedLog: {
            msg: "Review candidate publication completed with non-approved mode",
            repo: "xbmc/xbmc",
            prNumber: 401,
            deliveryId: "delivery-401",
            reviewOutputKey: reviewOutputKey(401),
            reasonCodes: [],
            prompt: "raw prompt must not leave the row",
            modelOutput: "raw model output must not leave the row",
            candidateBody: "raw candidate body with token=ghp_123456789012345678901234567890123456",
            diffText: "@@ raw diff text must not leave the row",
          },
          prNumber: 401,
        }),
      ],
    });

    expect(report.redaction.passed).toBe(false);
    expect(report.redaction.violations.map((violation) => violation.reason)).toEqual(expect.arrayContaining([
      "raw-prompt-output",
      "raw-model-output",
      "raw-candidate-output",
      "raw-diff-output",
      "secret-like-string",
    ]));
    const serialized = JSON.stringify(report.issueClasses);
    expect(serialized).not.toContain("raw prompt");
    expect(serialized).not.toContain("raw model");
    expect(serialized).not.toContain("raw candidate");
    expect(serialized).not.toContain("@@ raw diff");
    expect(serialized).not.toContain("ghp_123456789012345678901234567890123456");
  });

  test("oversized arrays and unsafe observation examples are rejected by redaction metadata", () => {
    const rowReport = buildBaselineWindowFromRows({
      window: "last12h",
      rows: [
        row({
          msg: "Knowledge store write failed (non-fatal): undefined persistence payload",
          parsedLog: {
            msg: "Knowledge store write failed (non-fatal): undefined persistence payload",
            repo: "xbmc/xbmc",
            prNumber: 501,
            deliveryId: "delivery-501",
            reviewOutputKey: reviewOutputKey(501),
            reasonCodes: Array.from({ length: 11 }, (_, index) => `reason-${index}`),
          },
          prNumber: 501,
        }),
      ],
    });
    expect(rowReport.redaction.passed).toBe(false);
    expect(rowReport.redaction.violations.some((violation) => violation.reason === "unbounded-array")).toBe(true);

    const observationReport = buildBaselineWindowFromObservations({
      window: "last7d",
      observations: [{
        classId: "knowledge-store.undefined-write",
        count: 5,
        examples: [{
          timeGenerated: "2026-05-20T12:00:00.000Z",
          repo: "xbmc/xbmc",
          prNumber: 501,
          reviewOutputKey: "token=ghp_123456789012345678901234567890123456",
          deliveryId: "delivery-501",
        }],
      }],
    });
    expect(observationReport.redaction.passed).toBe(false);
    expect(observationReport.redaction.violations.some((violation) => violation.reason === "secret-like-string")).toBe(true);
  });

  test("already-aggregated observations produce the same bounded issue-class surface", () => {
    const report = buildBaselineWindowFromObservations({
      window: "last7d",
      observations: [{
        classId: "addon-check.timeout",
        count: 12,
        examples: Array.from({ length: 5 }, (_, index) => ({
          timeGenerated: "2026-05-20T12:00:00.000Z",
          repo: "xbmc/xbmc",
          prNumber: 600 + index,
          reviewOutputKey: reviewOutputKey(600 + index),
          deliveryId: `delivery-${600 + index}`,
        })),
      }],
      sourceAvailability: "partial",
      workspaceCount: 2,
      maxExamplesPerClass: 3,
    });

    const summary = findProductionLogIssueClass(report, "addon-check.timeout");
    expect(report.totalRowCount).toBe(12);
    expect(report.source).toEqual({ availability: "partial", workspaceCount: 2, queryWindow: "last7d" });
    expect(summary.count).toBe(12);
    expect(summary.examples).toHaveLength(3);
    expect(summary.downstreamOwner).toBe("S06");
    expect(report.redaction.passed).toBe(true);
  });
});
