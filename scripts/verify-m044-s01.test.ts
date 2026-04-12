import { describe, expect, test } from "bun:test";
import {
  evaluateM044S01,
  main,
  parseVerifyM044S01Args,
  renderM044S01Report,
  type M044S01Report,
} from "./verify-m044-s01.ts";
import type { RecentReviewArtifact } from "../src/review-audit/recent-review-sample.ts";
import { buildReviewOutputKey } from "../src/handlers/review-idempotency.ts";

function makeArtifact(overrides: Partial<RecentReviewArtifact> & Pick<RecentReviewArtifact, "prNumber" | "lane" | "source">): RecentReviewArtifact {
  return {
    prNumber: overrides.prNumber,
    prUrl: overrides.prUrl ?? `https://github.com/xbmc/xbmc/pull/${overrides.prNumber}`,
    source: overrides.source,
    sourceUrl: overrides.sourceUrl ?? `https://github.com/xbmc/xbmc/pull/${overrides.prNumber}#artifact`,
    updatedAt: overrides.updatedAt ?? "2026-04-08T12:00:00.000Z",
    reviewOutputKey: overrides.reviewOutputKey ?? buildReviewOutputKey({
      installationId: 42,
      owner: "xbmc",
      repo: "xbmc",
      prNumber: overrides.prNumber,
      action: overrides.lane === "explicit" ? "mention-review" : "review_requested",
      deliveryId: `delivery-${overrides.prNumber}`,
      headSha: `head-${overrides.prNumber}`,
    }),
    lane: overrides.lane,
    action: overrides.action ?? (overrides.lane === "explicit" ? "mention-review" : "review_requested"),
  };
}

describe("verify-m044-s01", () => {
  test("parseVerifyM044S01Args parses repo, limit, and json flags", () => {
    const result = parseVerifyM044S01Args(["--repo", "xbmc/xbmc", "--limit", "12", "--json"]);

    expect(result.repo).toBe("xbmc/xbmc");
    expect(result.limit).toBe(12);
    expect(result.json).toBe(true);
  });

  test("evaluateM044S01 returns a successful provisional audit when GitHub sampling is available even if DB access is missing", async () => {
    const automaticArtifact = makeArtifact({ prNumber: 101, lane: "automatic", source: "issue-comment" });
    const explicitArtifact = makeArtifact({ prNumber: 102, lane: "explicit", source: "review" });

    const report = await evaluateM044S01({
      repo: "xbmc/xbmc",
      limit: 12,
      generatedAt: "2026-04-08T23:59:59.000Z",
      githubAccess: "available",
      databaseAccess: "missing",
      azureLogAccess: "missing",
      loadPullRequests: async () => [
        { number: 101, html_url: "https://github.com/xbmc/xbmc/pull/101" },
        { number: 102, html_url: "https://github.com/xbmc/xbmc/pull/102" },
      ],
      collectArtifacts: async () => [automaticArtifact, explicitArtifact],
      loadAutomaticLaneEvidence: async () => ({
        sourceAvailability: {
          reviewRecord: "present",
          findings: "present",
          checkpoint: "missing",
          telemetry: "missing",
        },
        reviewRecord: { deliveryId: "delivery-101", findingsTotal: 0, conclusion: "success" },
        matchingFindingCount: 0,
        publishedFindingCount: 0,
        checkpoint: null,
        telemetry: null,
      }),
      loadExplicitLaneEvidence: async () => ({
        sourceAvailability: {
          telemetry: "unavailable",
          publishResolution: "unavailable",
        },
        telemetry: null,
        publishResolution: null,
      }),
    });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m044_s01_ok");
    expect(report.preflight.githubAccess).toBe("available");
    expect(report.preflight.databaseAccess).toBe("missing");
    expect(report.artifacts).toHaveLength(2);
    expect(report.summary.totalArtifacts).toBe(2);
    expect(report.summary.verdictCounts["clean-valid"]).toBe(1);
    expect(report.summary.verdictCounts["indeterminate"]).toBe(1);
    const automaticReport = report.artifacts.find((artifact) => artifact.prNumber === 101);
    const explicitReport = report.artifacts.find((artifact) => artifact.prNumber === 102);
    expect(automaticReport?.verdict).toBe("clean-valid");
    expect(explicitReport?.verdict).toBe("indeterminate");
  });

  test("evaluateM044S01 degrades DB evidence to unavailable when the database loader throws", async () => {
    const automaticArtifact = makeArtifact({ prNumber: 201, lane: "automatic", source: "issue-comment" });

    const report = await evaluateM044S01({
      repo: "xbmc/xbmc",
      limit: 12,
      generatedAt: "2026-04-08T23:59:59.000Z",
      githubAccess: "available",
      databaseAccess: "available",
      azureLogAccess: "missing",
      loadPullRequests: async () => [
        { number: 201, html_url: "https://github.com/xbmc/xbmc/pull/201" },
      ],
      collectArtifacts: async () => [automaticArtifact],
      loadAutomaticLaneEvidence: async () => {
        throw new Error("db timeout");
      },
    });

    expect(report.success).toBe(true);
    expect(report.preflight.databaseAccess).toBe("unavailable");
    expect(report.artifacts[0]?.verdict).toBe("indeterminate");
  });

  test("evaluateM044S01 uses Azure evidence to classify automatic and explicit reviews when DB access is missing", async () => {
    const automaticArtifact = makeArtifact({ prNumber: 301, lane: "automatic", source: "review" });
    const explicitArtifact = makeArtifact({ prNumber: 302, lane: "explicit", source: "review" });

    const report = await evaluateM044S01({
      repo: "xbmc/xbmc",
      limit: 12,
      generatedAt: "2026-04-08T23:59:59.000Z",
      githubAccess: "available",
      databaseAccess: "missing",
      azureLogAccess: "available",
      loadPullRequests: async () => [
        { number: 301, html_url: "https://github.com/xbmc/xbmc/pull/301" },
        { number: 302, html_url: "https://github.com/xbmc/xbmc/pull/302" },
      ],
      collectArtifacts: async () => [automaticArtifact, explicitArtifact],
      loadAutomaticLaneEvidence: async () => ({
        sourceAvailability: {
          reviewRecord: "unavailable",
          findings: "unavailable",
          checkpoint: "unavailable",
          telemetry: "unavailable",
        },
        reviewRecord: null,
        matchingFindingCount: null,
        publishedFindingCount: null,
        checkpoint: null,
        telemetry: null,
      }),
      loadAutomaticLogEvidence: async () => ({
        sourceAvailability: { azureLogs: "present" },
        evidenceBundleOutcome: "submitted-approval",
        reviewOutputPublicationState: "publish",
        idempotencyDecision: "publish",
      }),
      loadExplicitLaneEvidence: async () => ({
        sourceAvailability: {
          telemetry: "present",
          publishResolution: "present",
        },
        telemetry: { conclusion: "success", eventType: "issue_comment.created" },
        publishResolution: "approval-bridge",
      }),
    });

    expect(report.preflight.azureLogAccess).toBe("available");
    expect(report.artifacts.find((artifact) => artifact.prNumber === 301)?.verdict).toBe("clean-valid");
    expect(report.artifacts.find((artifact) => artifact.prNumber === 302)?.verdict).toBe("clean-valid");
  });

  test("renderM044S01Report includes milestone-level summary counts in human output", () => {
    const report: M044S01Report = {
      command: "verify:m044:s01",
      generated_at: "2026-04-08T23:59:59.000Z",
      repo: "xbmc/xbmc",
      limit: 12,
      success: true,
      status_code: "m044_s01_ok",
      preflight: {
        githubAccess: "available",
        databaseAccess: "missing",
        azureLogAccess: "available",
        explicitPublishResolution: "unavailable",
      },
      selection: {
        scannedPullRequests: 10,
        collectedArtifacts: 4,
        perLaneLimit: 6,
        totalLimit: 12,
        candidateLaneCounts: { automatic: 3, explicit: 1 },
        selectedLaneCounts: { automatic: 3, explicit: 1 },
        fillCount: 0,
      },
      summary: {
        totalArtifacts: 4,
        verdictCounts: {
          "clean-valid": 3,
          "findings-published": 1,
          "publish-failure": 0,
          "suspicious-approval": 0,
          "indeterminate": 0,
        },
        laneCounts: { automatic: 3, explicit: 1 },
      },
      artifacts: [],
    };

    const human = renderM044S01Report(report);

    expect(human).toContain("Summary: total=4 clean-valid=3 findings-published=1");
  });

  test("main returns exit code 1 and JSON when GitHub access is unavailable", async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const exitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: (chunk: string) => void stderrChunks.push(chunk) },
      evaluate: async (): Promise<M044S01Report> => ({
        command: "verify:m044:s01",
        generated_at: "2026-04-08T23:59:59.000Z",
        repo: "xbmc/xbmc",
        limit: 12,
        success: false,
        status_code: "m044_s01_missing_github_access",
        preflight: {
          githubAccess: "missing",
          databaseAccess: "missing",
          azureLogAccess: "missing",
          explicitPublishResolution: "unavailable",
        },
        selection: {
          scannedPullRequests: 0,
          collectedArtifacts: 0,
          perLaneLimit: 6,
          totalLimit: 12,
          candidateLaneCounts: { automatic: 0, explicit: 0 },
          selectedLaneCounts: { automatic: 0, explicit: 0 },
          fillCount: 0,
        },
        summary: {
          totalArtifacts: 0,
          verdictCounts: {},
          laneCounts: {},
        },
        artifacts: [],
      }),
    });

    expect(exitCode).toBe(1);
    expect(stderrChunks.join(" ")).toBe("");
    expect(stdoutChunks.join("")).toContain("m044_s01_missing_github_access");
  });
});
