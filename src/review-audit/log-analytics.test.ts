import { describe, expect, test } from "bun:test";
import {
  buildReviewAuditLogQuery,
  discoverLogAnalyticsWorkspaceIds,
  normalizeLogAnalyticsRows,
  queryReviewAuditLogs,
} from "./log-analytics.ts";

describe("review audit log analytics adapter", () => {
  test("buildReviewAuditLogQuery creates a bounded query with delivery, review-output, and message filters", () => {
    const query = buildReviewAuditLogQuery({
      reviewOutputKey: "rok-123",
      deliveryId: "delivery-123",
      messageContains: "Review phase timing summary",
      limit: 50,
    });

    expect(query).toContain("ContainerAppConsoleLogs_CL");
    expect(query).toContain('Log_s has "rok-123"');
    expect(query).toContain('Log_s has "delivery-123"');
    expect(query).toContain('Log_s has "Review phase timing summary"');
    expect(query).toContain("take 50");
  });

  test("discoverLogAnalyticsWorkspaceIds returns explicit workspace ids when provided", async () => {
    const result = await discoverLogAnalyticsWorkspaceIds({
      resourceGroup: "rg-kodiai",
      explicitWorkspaceIds: ["w1", "w2"],
      runAzJson: async () => {
        throw new Error("should not be called");
      },
    });

    expect(result).toEqual(["w1", "w2"]);
  });

  test("normalizeLogAnalyticsRows parses JSON logs and flags malformed rows", () => {
    const result = normalizeLogAnalyticsRows([
      {
        TimeGenerated: "2026-04-09T00:00:00.000Z",
        Log_s: JSON.stringify({
          deliveryId: "delivery-123",
          reviewOutputKey: "rok-123",
          msg: "Evidence bundle",
        }),
        RevisionName_s: "ca-kodiai--0000076",
        ContainerAppName_s: "ca-kodiai",
      },
      {
        TimeGenerated: "2026-04-09T00:01:00.000Z",
        Log_s: "not-json",
        RevisionName_s: "ca-kodiai--0000076",
        ContainerAppName_s: "ca-kodiai",
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]?.malformed).toBe(false);
    expect(result[0]?.deliveryId).toBe("delivery-123");
    expect(result[0]?.reviewOutputKey).toBe("rok-123");
    expect(result[1]?.malformed).toBe(true);
    expect(result[1]?.deliveryId).toBeNull();
  });

  test("queryReviewAuditLogs uses the first workspace as primary and normalizes returned rows", async () => {
    const calls: string[][] = [];

    const result = await queryReviewAuditLogs({
      workspaceIds: ["w1", "w2", "w3"],
      reviewOutputKey: "rok-123",
      deliveryId: "delivery-123",
      timespan: "P7D",
      runAzJson: async (args) => {
        calls.push(args);
        return [
          {
            TimeGenerated: "2026-04-09T00:00:00.000Z",
            Log_s: JSON.stringify({
              deliveryId: "delivery-123",
              reviewOutputKey: "rok-123",
              msg: "Mention execution completed",
            }),
            RevisionName_s: "ca-kodiai--0000076",
            ContainerAppName_s: "ca-kodiai",
          },
        ];
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("-w");
    expect(calls[0]).toContain("w1");
    expect(calls[0]).toContain("--workspaces");
    expect(calls[0]).toContain("w2");
    expect(calls[0]).toContain("w3");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.message).toBe("Mention execution completed");
  });

  test("queryReviewAuditLogs returns an empty normalized result when no rows are found", async () => {
    const result = await queryReviewAuditLogs({
      workspaceIds: ["w1"],
      reviewOutputKey: "rok-123",
      runAzJson: async () => [],
    });

    expect(result.rows).toEqual([]);
  });
});
