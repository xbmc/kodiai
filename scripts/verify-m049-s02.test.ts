import { describe, expect, test } from "bun:test";
import {
  buildApprovedReviewBody,
  buildReviewOutputKey,
  buildReviewOutputMarker,
} from "../src/handlers/review-idempotency.ts";
import type {
  ReviewOutputArtifact,
  ReviewOutputArtifactCollection,
} from "../src/review-audit/review-output-artifacts.ts";
import type { NormalizedLogAnalyticsRow } from "../src/review-audit/log-analytics.ts";

function makeReviewOutputKey(overrides?: Partial<{
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

function makeArtifact(overrides?: Partial<ReviewOutputArtifact>): ReviewOutputArtifact {
  const reviewOutputKey = overrides?.reviewOutputKey ?? makeReviewOutputKey();

  return {
    prNumber: overrides?.prNumber ?? 101,
    prUrl: overrides?.prUrl ?? "https://github.com/xbmc/kodiai/pull/101",
    source: overrides?.source ?? "review",
    sourceUrl: overrides?.sourceUrl ?? "https://github.com/xbmc/kodiai/pull/101#pullrequestreview-7",
    updatedAt: overrides?.updatedAt ?? "2026-04-13T12:00:00.000Z",
    reviewOutputKey,
    lane: overrides?.lane ?? "explicit",
    action: overrides?.action ?? "mention-review",
    body: overrides?.body ?? buildApprovedReviewBody({
      reviewOutputKey,
      evidence: ["Reviewed the touched files and found no actionable issues."],
    }),
    reviewState: overrides?.reviewState ?? "APPROVED",
  };
}

function makeCollection(artifacts: ReviewOutputArtifact[], reviewOutputKey = artifacts[0]?.reviewOutputKey ?? makeReviewOutputKey()): ReviewOutputArtifactCollection {
  return {
    requestedReviewOutputKey: reviewOutputKey,
    prUrl: "https://github.com/xbmc/kodiai/pull/101",
    artifactCounts: {
      reviewComments: artifacts.filter((artifact) => artifact.source === "review-comment").length,
      issueComments: artifacts.filter((artifact) => artifact.source === "issue-comment").length,
      reviews: artifacts.filter((artifact) => artifact.source === "review").length,
      total: artifacts.length,
    },
    artifacts,
  };
}

function makeAzureRow(params?: {
  reviewOutputKey?: string;
  deliveryId?: string;
  publishResolution?: string;
  conclusion?: string;
  eventType?: string;
  message?: string;
}): NormalizedLogAnalyticsRow {
  const payload: Record<string, unknown> = {
    reviewOutputKey: params?.reviewOutputKey ?? makeReviewOutputKey(),
    deliveryId: params?.deliveryId ?? "delivery-101",
    conclusion: params?.conclusion ?? "success",
    eventType: params?.eventType ?? "issue_comment.created",
  };

  if (params?.publishResolution !== undefined) {
    payload.publishResolution = params.publishResolution;
  }

  return {
    timeGenerated: "2026-04-13T12:30:00.000Z",
    rawLog: JSON.stringify(payload),
    malformed: false,
    deliveryId: String(payload.deliveryId),
    reviewOutputKey: String(payload.reviewOutputKey),
    message: params?.message ?? "Mention execution completed",
    revisionName: "ca-kodiai--0000111",
    containerAppName: "ca-kodiai",
    parsedLog: payload,
  };
}

async function loadModule() {
  return await import("./verify-m049-s02.ts");
}

describe("verify-m049-s02", () => {
  test("parseVerifyM049S02Args parses repo, review-output-key, and json", async () => {
    const { parseVerifyM049S02Args } = await loadModule();

    const result = parseVerifyM049S02Args([
      "--repo",
      "xbmc/kodiai",
      "--review-output-key",
      makeReviewOutputKey(),
      "--json",
    ]);

    expect(result.repo).toBe("xbmc/kodiai");
    expect(result.reviewOutputKey).toBe(makeReviewOutputKey());
    expect(result.json).toBe(true);
  });

  test("parseVerifyM049S02Args does not consume the next flag when --review-output-key is empty", async () => {
    const { parseVerifyM049S02Args } = await loadModule();

    const result = parseVerifyM049S02Args([
      "--repo",
      "xbmc/kodiai",
      "--review-output-key",
      "--json",
    ]);

    expect(result.reviewOutputKey).toBeNull();
    expect(result.json).toBe(true);
  });

  test("main exits non-zero with invalid-arg when --review-output-key is missing", async () => {
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
    expect(report.status_code).toBe("m049_s02_invalid_arg");
    expect(report.issues).toContain("Missing required --review-output-key.");
  });

  test("main rejects non-explicit reviewOutputKey values before live lookup", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];

    const exitCode = await main([
      "--repo",
      "xbmc/kodiai",
      "--review-output-key",
      makeReviewOutputKey({ action: "review_requested" }),
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
    expect(report.status_code).toBe("m049_s02_invalid_arg");
    expect(report.issues).toContain("--review-output-key must encode the explicit mention-review action.");
  });

  test("main rejects repo mismatches before live lookup", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];

    const exitCode = await main([
      "--repo",
      "xbmc/other-repo",
      "--review-output-key",
      makeReviewOutputKey({ repo: "kodiai" }),
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
    expect(report.status_code).toBe("m049_s02_invalid_arg");
    expect(report.issues).toContain("Provided --repo does not match the repository encoded in --review-output-key.");
  });

  test("evaluateM049S02 returns missing-github-access before any proof attempt", async () => {
    const { evaluateM049S02 } = await loadModule();

    const report = await evaluateM049S02({
      repo: "xbmc/kodiai",
      reviewOutputKey: makeReviewOutputKey(),
      generatedAt: "2026-04-13T13:00:00.000Z",
      githubAccess: "missing",
      collectArtifacts: async () => {
        throw new Error("should not be called");
      },
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m049_s02_missing_github_access");
    expect(report.preflight.githubAccess).toBe("missing");
    expect(report.artifact).toBeNull();
    expect(report.artifactCounts.total).toBe(0);
  });

  test("evaluateM049S02 returns named GitHub proof failures for zero, duplicate, wrong-surface, wrong-state, and body drift branches", async () => {
    const { evaluateM049S02 } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();

    const noMatch = await evaluateM049S02({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      generatedAt: "2026-04-13T13:05:00.000Z",
      githubAccess: "available",
      collectArtifacts: async () => makeCollection([], reviewOutputKey),
    });
    const duplicate = await evaluateM049S02({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      generatedAt: "2026-04-13T13:05:00.000Z",
      githubAccess: "available",
      collectArtifacts: async () => makeCollection([
        makeArtifact({ reviewOutputKey, source: "review" }),
        makeArtifact({
          reviewOutputKey,
          source: "issue-comment",
          sourceUrl: "https://github.com/xbmc/kodiai/pull/101#issuecomment-1",
          reviewState: null,
        }),
      ], reviewOutputKey),
    });
    const wrongSurface = await evaluateM049S02({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      generatedAt: "2026-04-13T13:05:00.000Z",
      githubAccess: "available",
      collectArtifacts: async () => makeCollection([
        makeArtifact({
          reviewOutputKey,
          source: "issue-comment",
          sourceUrl: "https://github.com/xbmc/kodiai/pull/101#issuecomment-1",
          reviewState: null,
        }),
      ], reviewOutputKey),
    });
    const wrongState = await evaluateM049S02({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      generatedAt: "2026-04-13T13:05:00.000Z",
      githubAccess: "available",
      collectArtifacts: async () => makeCollection([
        makeArtifact({ reviewOutputKey, reviewState: "COMMENTED" }),
      ], reviewOutputKey),
    });
    const bodyDrift = await evaluateM049S02({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      generatedAt: "2026-04-13T13:05:00.000Z",
      githubAccess: "available",
      collectArtifacts: async () => makeCollection([
        makeArtifact({
          reviewOutputKey,
          body: [
            "Decision: APPROVE",
            "Issues: none",
            "",
            "- Missing evidence heading.",
            "",
            buildReviewOutputMarker(reviewOutputKey),
          ].join("\n"),
        }),
      ], reviewOutputKey),
    });

    expect(noMatch.status_code).toBe("m049_s02_no_matching_artifact");
    expect(duplicate.status_code).toBe("m049_s02_duplicate_visible_outputs");
    expect(wrongSurface.status_code).toBe("m049_s02_wrong_surface");
    expect(wrongState.status_code).toBe("m049_s02_wrong_review_state");
    expect(bodyDrift.status_code).toBe("m049_s02_body_drift");
    expect(bodyDrift.bodyContract?.hasEvidenceHeading).toBe(false);
  });

  test("evaluateM049S02 preserves GitHub proof fields when Azure correlation is unavailable or mismatched", async () => {
    const { evaluateM049S02 } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();
    const collection = makeCollection([makeArtifact({ reviewOutputKey })], reviewOutputKey);

    const azureUnavailable = await evaluateM049S02({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      generatedAt: "2026-04-13T13:10:00.000Z",
      githubAccess: "available",
      workspaceIds: ["workspace-1"],
      collectArtifacts: async () => collection,
      queryLogs: async () => {
        throw new Error("azure timeout");
      },
    });
    const auditUnavailable = await evaluateM049S02({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      generatedAt: "2026-04-13T13:10:00.000Z",
      githubAccess: "available",
      workspaceIds: ["workspace-1"],
      collectArtifacts: async () => collection,
      queryLogs: async () => ({
        query: "audit query",
        rows: [makeAzureRow({ reviewOutputKey, publishResolution: undefined })],
      }),
    });
    const auditMismatch = await evaluateM049S02({
      repo: "xbmc/kodiai",
      reviewOutputKey,
      generatedAt: "2026-04-13T13:10:00.000Z",
      githubAccess: "available",
      workspaceIds: ["workspace-1"],
      collectArtifacts: async () => collection,
      queryLogs: async () => ({
        query: "audit query",
        rows: [makeAzureRow({ reviewOutputKey, publishResolution: "executor" })],
      }),
    });

    expect(azureUnavailable.status_code).toBe("m049_s02_azure_unavailable");
    expect(azureUnavailable.preflight.azureAccess).toBe("unavailable");
    expect(azureUnavailable.artifact?.sourceUrl).toBe("https://github.com/xbmc/kodiai/pull/101#pullrequestreview-7");
    expect(azureUnavailable.bodyContract?.valid).toBe(true);

    expect(auditUnavailable.status_code).toBe("m049_s02_audit_unavailable");
    expect(auditUnavailable.audit?.publishResolution).toBeNull();
    expect(auditUnavailable.artifact?.reviewState).toBe("APPROVED");

    expect(auditMismatch.status_code).toBe("m049_s02_audit_mismatch");
    expect(auditMismatch.audit?.publishResolution).toBe("executor");
  });

  test("evaluateM049S02 succeeds only for one APPROVED review plus a clean explicit publish resolution and exposes the required report shape", async () => {
    const { evaluateM049S02, renderM049S02Report } = await loadModule();
    const cleanResolutions = [
      "approval-bridge",
      "idempotency-skip",
      "duplicate-suppressed",
    ] as const;

    for (const publishResolution of cleanResolutions) {
      const reviewOutputKey = makeReviewOutputKey({ deliveryId: `delivery-${publishResolution}` });
      const report = await evaluateM049S02({
        repo: "xbmc/kodiai",
        reviewOutputKey,
        generatedAt: "2026-04-13T13:15:00.000Z",
        githubAccess: "available",
        workspaceIds: ["workspace-1"],
        collectArtifacts: async () => makeCollection([
          makeArtifact({ reviewOutputKey }),
        ], reviewOutputKey),
        queryLogs: async () => ({
          query: "audit query",
          rows: [makeAzureRow({
            reviewOutputKey,
            deliveryId: `delivery-${publishResolution}`,
            publishResolution,
          })],
        }),
      });

      expect(report.success).toBe(true);
      expect(report.status_code).toBe("m049_s02_ok");
      expect(report.artifactCounts).toEqual({
        reviewComments: 0,
        issueComments: 0,
        reviews: 1,
        total: 1,
      });
      expect(report.artifact?.sourceUrl).toBe("https://github.com/xbmc/kodiai/pull/101#pullrequestreview-7");
      expect(report.artifact?.reviewState).toBe("APPROVED");
      expect(report.bodyContract?.hasDecisionApprove).toBe(true);
      expect(report.bodyContract?.hasIssuesNone).toBe(true);
      expect(report.bodyContract?.hasEvidenceHeading).toBe(true);
      expect(report.bodyContract?.hasExactMarker).toBe(true);
      expect(report.audit?.publishResolution).toBe(publishResolution);
      expect(report.issues).toEqual([]);

      const human = renderM049S02Report(report);
      expect(human).toContain("Status: m049_s02_ok");
      expect(human).toContain("Artifact counts: review_comments=0 issue_comments=0 reviews=1 total=1");
      expect(human).toContain("Review URL: https://github.com/xbmc/kodiai/pull/101#pullrequestreview-7");
      expect(human).toContain(`Publish resolution: ${publishResolution}`);
    }
  });

  test("package.json wires verify:m049:s02 to the verifier script", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m049:s02"]).toBe("bun scripts/verify-m049-s02.ts");
  });
});
