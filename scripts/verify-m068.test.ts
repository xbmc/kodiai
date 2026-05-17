import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  evaluateM068MilestoneContract,
  M068_CHECK_IDS,
  main,
  queryM068ReviewAuditLogsLive,
  renderM068Report,
  type M068Check,
  type M068Report,
} from "./verify-m068.ts";
import { M068_S01_CHECK_IDS } from "./verify-m068-s01.ts";
import { M068_S02_CHECK_IDS } from "./verify-m068-s02.ts";
import { M068_S03_CHECK_IDS } from "./verify-m068-s03.ts";
import { buildReviewOutputMarker } from "../src/handlers/review-idempotency.ts";
import { buildReviewDetailsMarker } from "../src/lib/review-utils.ts";
import type { NormalizedLogAnalyticsRow } from "../src/review-audit/log-analytics.ts";
import type { ReviewOutputArtifact, ReviewOutputArtifactCollection } from "../src/review-audit/review-output-artifacts.ts";

const RAW_NESTED_MARKERS = [
  "rawPrompt",
  "rawDiff",
  "BEGIN PROMPT",
  "diff --git",
  "candidate payload",
  "TOKEN=abc123",
  "SECRET=",
  "sk-",
  "ghp_",
  "AKIA",
];

function expectedCheckIds(command: "verify:m068:s01" | "verify:m068:s02" | "verify:m068:s03"): readonly string[] {
  if (command === "verify:m068:s01") {
    return M068_S01_CHECK_IDS;
  }
  if (command === "verify:m068:s02") {
    return M068_S02_CHECK_IDS;
  }
  return M068_S03_CHECK_IDS;
}

function nestedReport(command: "verify:m068:s01" | "verify:m068:s02" | "verify:m068:s03", success = true) {
  const suffix = command.split(":").at(-1)?.toUpperCase() ?? "S00";
  const checkIds = expectedCheckIds(command);
  return {
    command,
    generated_at: "2026-05-09T17:00:00.000Z",
    success,
    status_code: success ? `m068_${suffix.toLowerCase()}_ok` : `m068_${suffix.toLowerCase()}_contract_failed`,
    check_ids: [...checkIds],
    checks: checkIds.map((checkId, index) => ({
      id: checkId,
      passed: success,
      status_code: success ? "ok" : "failed",
      detail: success
        ? "nested prerequisite passed"
        : index === 0
          ? "nested prerequisite failed with rawPrompt diff --git TOKEN=abc123 sk-live-secret-token"
          : "nested prerequisite not evaluated after first failure",
    })),
    failing_check_id: success ? null : checkIds[0],
    issues: success ? [] : ["nested prerequisite failed with BEGIN PROMPT rawDiff candidate payload"],
    unsafeRawBlob: "BEGIN PROMPT rawPrompt rawDiff diff --git TOKEN=abc123 sk-live-secret-token candidate payload",
  };
}

function checkById(report: M068Report, id: string): M068Check {
  const check = report.checks.find((candidate) => candidate.id === id);
  if (!check) {
    throw new Error(`missing check ${id}`);
  }
  return check;
}

const REVIEW_OUTPUT_KEY = "kodiai-review-output:v1:inst-123:xbmc/xbmc:pr-28172:action-opened:delivery-delivery-1:head-abc123";
const RETRY_REVIEW_OUTPUT_KEY = `${REVIEW_OUTPUT_KEY}-retry-2`;
const DELIVERY_ID = "delivery-1";

function logRow(overrides: Partial<NormalizedLogAnalyticsRow> = {}): NormalizedLogAnalyticsRow {
  return {
    timeGenerated: "2026-05-09T17:00:00.000Z",
    rawLog: JSON.stringify({
      msg: "Review candidate publication completed",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      deliveryId: DELIVERY_ID,
      gate: "review-candidate-publication",
      published: 1,
      directFallback: 0,
    }),
    malformed: false,
    deliveryId: DELIVERY_ID,
    reviewOutputKey: REVIEW_OUTPUT_KEY,
    message: "Review candidate publication completed",
    revisionName: "rev-a",
    containerAppName: "kodiai-review-worker",
    parsedLog: {
      msg: "Review candidate publication completed",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      deliveryId: DELIVERY_ID,
      gate: "review-candidate-publication",
      published: 1,
      directFallback: 0,
    },
    ...overrides,
  };
}

function reviewDetailsBody(line: string, extra = ""): string {
  return [
    "<details>",
    "<summary>Review Details</summary>",
    "",
    `- ${line}`,
    extra,
    "",
    "</details>",
    "",
    buildReviewDetailsMarker(REVIEW_OUTPUT_KEY),
  ].filter((linePart) => linePart !== "").join("\n");
}

function artifact(overrides: Partial<ReviewOutputArtifact>): ReviewOutputArtifact {
  return {
    prNumber: 28172,
    prUrl: "https://github.com/xbmc/xbmc/pull/28172",
    source: "issue-comment",
    sourceUrl: "https://github.com/xbmc/xbmc/pull/28172#issuecomment-1",
    updatedAt: "2026-05-09T17:00:00.000Z",
    reviewOutputKey: REVIEW_OUTPUT_KEY,
    lane: null,
    action: "opened",
    body: reviewDetailsBody("Review candidate publication: mode=candidate-approved approved=1 rewritten=0 published=1 directFallback=0 reasons=none"),
    reviewState: null,
    ...overrides,
  };
}

function artifactCollection(artifacts: ReviewOutputArtifact[]): ReviewOutputArtifactCollection {
  return {
    requestedReviewOutputKey: REVIEW_OUTPUT_KEY,
    prUrl: "https://github.com/xbmc/xbmc/pull/28172",
    artifactCounts: {
      reviewComments: artifacts.filter((item) => item.source === "review-comment").length,
      issueComments: artifacts.filter((item) => item.source === "issue-comment").length,
      reviews: artifacts.filter((item) => item.source === "review").length,
      total: artifacts.length,
    },
    artifacts,
  };
}

function candidateInlineArtifact(index: number): ReviewOutputArtifact {
  return artifact({
    source: "review-comment",
    sourceUrl: `https://github.com/xbmc/xbmc/pull/28172#discussion_r${index}`,
    body: [`[major] Candidate finding ${index}`, "", buildReviewOutputMarker(REVIEW_OUTPUT_KEY)].join("\n"),
  });
}

function runtimeRows(): NormalizedLogAnalyticsRow[] {
  return [
    logRow(),
    logRow({
      message: "Review candidate publication adapter accepted",
      parsedLog: { msg: "Review candidate publication adapter accepted", reviewOutputKey: REVIEW_OUTPUT_KEY, deliveryId: DELIVERY_ID, gate: "review-candidate-publication-adapter" },
    }),
    logRow({
      message: "Review Details publication completed",
      parsedLog: { msg: "Review Details publication completed", reviewOutputKey: REVIEW_OUTPUT_KEY, deliveryId: DELIVERY_ID, gate: "review-details-output", gateResult: "completed", reviewDetailsPublished: true },
    }),
  ];
}

async function okRuntimeQuery(): Promise<{ query: string; rows: NormalizedLogAnalyticsRow[] }> {
  return { query: "ContainerAppConsoleLogs_CL", rows: runtimeRows() };
}

function expectNoRawNestedBlob(value: string): void {
  for (const marker of RAW_NESTED_MARKERS) {
    expect(value).not.toContain(marker);
  }
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

describe("package wiring", () => {
  test("exposes verify:m068", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["verify:m068"]).toBe("bun scripts/verify-m068.ts");
  });
});

describe("evaluateM068MilestoneContract", () => {
  test("uses explicit workspace ids for live runtime log queries without discovery", async () => {
    let discoverCalls = 0;
    let queryWorkspaceIds: string[] = [];
    const result = await queryM068ReviewAuditLogsLive({
      repo: "xbmc/xbmc",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      deliveryId: DELIVERY_ID,
      workspaceIds: ["workspace-a", "workspace-b"],
      discoverWorkspaceIds: async () => {
        discoverCalls += 1;
        return ["discovered-workspace"];
      },
      queryLogs: async (params) => {
        queryWorkspaceIds = params.workspaceIds;
        expect(params.reviewOutputKey).toBe(REVIEW_OUTPUT_KEY);
        expect(params.deliveryId).toBe(DELIVERY_ID);
        expect(params.timespan).toBe("P14D");
        expect(params.limit).toBe(200);
        return { query: "bounded-query", rows: runtimeRows() };
      },
    });

    expect(discoverCalls).toBe(0);
    expect(queryWorkspaceIds).toEqual(["workspace-a", "workspace-b"]);
    expect(result.rows.length).toBe(3);
  });

  test("returns stable check ids and passes local prerequisites when S01/S02/S03 reports pass", async () => {
    const report = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: null,
      preflightOnly: true,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
    });

    expect(report.command).toBe("verify:m068");
    expect(report.generated_at).toBe("2026-05-09T17:00:00.000Z");
    expect(report.check_ids).toEqual([...M068_CHECK_IDS]);
    expect(report.checks.map((check) => check.id)).toEqual([...M068_CHECK_IDS]);
    expect(new Set(report.checks.map((check) => check.id)).size).toBe(M068_CHECK_IDS.length);
    expect(renderM068Report(report)).toContain("M068-LOCAL-PREREQUISITES");
    for (const checkId of M068_CHECK_IDS) {
      expect(countOccurrences(renderM068Report(report), `- ${checkId}:`)).toBe(1);
    }
    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m068_skipped_missing_review_output_key");
    expect(checkById(report, "M068-LOCAL-PREREQUISITES").passed).toBe(true);
    expect(report.prerequisites.map((item) => item.command)).toEqual([
      "verify:m068:s01",
      "verify:m068:s02",
      "verify:m068:s03",
    ]);
  });

  test("propagates a nested prerequisite failure without throwing or leaking raw nested blobs", async () => {
    const report = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: null,
      preflightOnly: true,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02", false),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m068_local_prerequisites_failed");
    expect(report.failing_check_id).toBe("M068-LOCAL-PREREQUISITES");
    expect(checkById(report, "M068-LOCAL-PREREQUISITES").status_code).toBe("local_prerequisite_failed");
    expect(report.issues.join("\n")).toContain("verify:m068:s02");
    expectNoRawNestedBlob(JSON.stringify(report));
    expectNoRawNestedBlob(renderM068Report(report));
  });

  test("treats malformed nested reports as prerequisite failure", async () => {
    const report = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: null,
      preflightOnly: true,
      evaluateS01: async () => ({ ...nestedReport("verify:m068:s01"), success: undefined }) as never,
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M068-LOCAL-PREREQUISITES");
    expect(report.prerequisites[0]?.status_code).toBe("malformed_report");
    expect(report.prerequisites[0]?.issue).toContain("missing boolean success");
  });

  test("preflight-only without a review output key is bounded and skips live collection", async () => {
    const report = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: null,
      preflightOnly: true,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
    });

    expect(report.preflight.publication.status).toBe("missing_review_output_key");
    expect(report.preflight.publication.issue.length).toBeLessThanOrEqual(180);
    expect(checkById(report, "M068-REDUCER-ADAPTER-PUBLICATION-STATE").status_code).toBe("preflight_skipped_missing_review_output_key");
    expect(checkById(report, "M068-BOUNDED-EVIDENCE").passed).toBe(true);
  });

  test("accepts candidate-approved Review Details with multiple exact-key candidate inline artifacts", async () => {
    const report = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([
        artifact({}),
        candidateInlineArtifact(1),
        candidateInlineArtifact(2),
      ]),
      queryReviewAuditLogs: okRuntimeQuery,
    });

    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m068_ok");
    expect(checkById(report, "M068-CANDIDATE-PATH-PROOF").passed).toBe(true);
    expect(checkById(report, "M068-REVIEW-DETAILS-EVIDENCE").passed).toBe(true);
    expect(checkById(report, "M068-DIRECT-FALLBACK-REJECTED").passed).toBe(true);
    expect(checkById(report, "M068-GITHUB-VISIBLE-VOLUME").passed).toBe(true);
    expect(report.evidence.artifacts.review_details_count).toBe(1);
    expect(report.evidence.artifacts.candidate_inline_count).toBe(2);
    expect(report.evidence.artifacts.by_source.review_comment).toBe(2);
    expect(JSON.stringify(report)).not.toContain("Candidate finding 1");
  });

  test("pending runtime evidence does not satisfy full exact-key proof", async () => {
    const report = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      deliveryId: DELIVERY_ID,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([artifact({}), candidateInlineArtifact(1)]),
    });

    expect(report.success).toBe(false);
    expect(checkById(report, "M068-RUNTIME-LOG-EVIDENCE").status_code).toBe("live_evidence_pending");
    expect(checkById(report, "M068-RUNTIME-LOG-EVIDENCE").passed).toBe(false);
    expect(report.evidence.runtime.status).toBe("pending");
  });

  test("accepts candidate-approved-partial Review Details as candidate path success", async () => {
    const report = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([
        artifact({ body: reviewDetailsBody("Review candidate publication: mode=candidate-approved-partial published=1 directFallback=0 reasons=bounded") }),
      ]),
      queryReviewAuditLogs: okRuntimeQuery,
    });

    expect(report.success).toBe(true);
    expect(report.evidence.artifacts.review_details.mode).toBe("candidate-approved-partial");
    expect(checkById(report, "M068-CANDIDATE-PATH-PROOF").passed).toBe(true);
  });

  test("rejects fallback-only visible output as expected direct fallback evidence", async () => {
    const report = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([
        artifact({ body: reviewDetailsBody("Review candidate publication: mode=direct-fallback published=0 directFallback=1 reasons=runtime-unavailable") }),
      ]),
      queryReviewAuditLogs: okRuntimeQuery,
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M068-CANDIDATE-PATH-PROOF");
    expect(checkById(report, "M068-DIRECT-FALLBACK-REJECTED").passed).toBe(false);
    expect(checkById(report, "M068-DIRECT-FALLBACK-REJECTED").detail).toContain("directFallback=1");
  });

  test("fails missing and duplicate Review Details artifacts without raw body leakage", async () => {
    const missing = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([candidateInlineArtifact(1)]),
    });
    const duplicate = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([
        artifact({ sourceUrl: "https://github.com/xbmc/xbmc/pull/28172#issuecomment-1" }),
        artifact({ sourceUrl: "https://github.com/xbmc/xbmc/pull/28172#issuecomment-2", body: reviewDetailsBody("Review candidate publication: mode=candidate-approved published=1 directFallback=0 reasons=duplicate TOKEN=abc123") }),
      ]),
    });

    expect(checkById(missing, "M068-REVIEW-DETAILS-EVIDENCE").status_code).toBe("review_details_failed");
    expect(missing.evidence.artifacts.review_details_count).toBe(0);
    expect(checkById(duplicate, "M068-REVIEW-DETAILS-EVIDENCE").status_code).toBe("review_details_failed");
    expect(duplicate.evidence.artifacts.review_details_count).toBe(2);
    expectNoRawNestedBlob(JSON.stringify(duplicate));
  });

  test("fails malformed publication lines and non-numeric counts", async () => {
    const report = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([
        artifact({ body: reviewDetailsBody("Review candidate publication: mode=candidate-approved published=one directFallback=0 reasons=bad") }),
      ]),
    });

    expect(report.success).toBe(false);
    expect(checkById(report, "M068-REVIEW-DETAILS-EVIDENCE").detail).toContain("malformed");
    expect(report.evidence.artifacts.review_details.line_status).toBe("malformed_line");
  });

  test("fails bounded evidence instead of leaking prompt, diff, candidate, payload, or secret markers", async () => {
    const report = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([
        artifact({ body: reviewDetailsBody("Review candidate publication: mode=candidate-approved published=1 directFallback=0 reasons=rawPrompt,rawDiff,diff --git,candidate payload,BEGIN PROMPT,TOKEN=abc123,SECRET=shh,sk-live-secret-token,ghp_live_secret,AKIA1234567890123456") }),
      ]),
      queryReviewAuditLogs: async () => ({
        query: "ContainerAppConsoleLogs_CL",
        rows: [
          logRow(),
          logRow({
            message: "Review candidate publication adapter accepted",
            parsedLog: { msg: "Review candidate publication adapter accepted", reviewOutputKey: REVIEW_OUTPUT_KEY, deliveryId: DELIVERY_ID, gate: "review-candidate-publication-adapter" },
          }),
          logRow({
            message: "Review Details publication completed",
            parsedLog: { msg: "Review Details publication completed", reviewOutputKey: REVIEW_OUTPUT_KEY, deliveryId: DELIVERY_ID, gate: "review-details-output", gateResult: "completed", reviewDetailsPublished: true },
          }),
        ],
      }),
    });

    expect(checkById(report, "M068-BOUNDED-EVIDENCE").status_code).toBe("bounded_evidence_ok");
    expect(report.redaction.leak_marker_count).toBe(0);
    expectNoRawNestedBlob(JSON.stringify(report));
    expectNoRawNestedBlob(renderM068Report(report));
    expect(JSON.stringify(report)).not.toContain("ghp_live_secret");
    expect(JSON.stringify(report)).not.toContain("AKIA1234567890123456");
  });

  test("fails excessive candidate inline visible volume at the exact-key cap boundary", async () => {
    const atCap = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([
        artifact({}),
        candidateInlineArtifact(1),
        candidateInlineArtifact(2),
        candidateInlineArtifact(3),
      ]),
      queryReviewAuditLogs: okRuntimeQuery,
    });
    const overCap = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([
        artifact({}),
        candidateInlineArtifact(1),
        candidateInlineArtifact(2),
        candidateInlineArtifact(3),
        candidateInlineArtifact(4),
      ]),
    });

    expect(checkById(atCap, "M068-GITHUB-VISIBLE-VOLUME").passed).toBe(true);
    expect(checkById(overCap, "M068-GITHUB-VISIBLE-VOLUME").passed).toBe(false);
    expect(overCap.evidence.artifacts.candidate_inline_count).toBe(4);
  });

  test("reports artifact collection errors as unavailable without leaking payloads", async () => {
    const report = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => {
        throw new Error("GitHub failed with rawPrompt diff --git TOKEN=abc123 secret body");
      },
    });

    expect(report.success).toBe(false);
    expect(checkById(report, "M068-CANDIDATE-PATH-PROOF").status_code).toBe("artifact_collection_unavailable");
    expectNoRawNestedBlob(JSON.stringify(report));
  });

  test("rejects malformed, wrong-target, and repo-mismatched exact keys before live collectors run", async () => {
    let artifactCalls = 0;
    let logCalls = 0;
    const baseParams = {
      generatedAt: "2026-05-09T17:00:00.000Z",
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => {
        artifactCalls += 1;
        return artifactCollection([]);
      },
      queryReviewAuditLogs: async () => {
        logCalls += 1;
        return { query: "", rows: [] };
      },
    };

    const malformed = await evaluateM068MilestoneContract({
      ...baseParams,
      reviewOutputKey: "not-a-review-output-key",
      deliveryId: DELIVERY_ID,
    });
    const wrongLane = await evaluateM068MilestoneContract({
      ...baseParams,
      reviewOutputKey: REVIEW_OUTPUT_KEY.replace("action-opened", "action-mention-review"),
      deliveryId: DELIVERY_ID,
    });
    const wrongRepo = await evaluateM068MilestoneContract({
      ...baseParams,
      reviewOutputKey: REVIEW_OUTPUT_KEY.replace("xbmc/xbmc", "other/repo"),
      deliveryId: DELIVERY_ID,
      repo: "other/repo",
    });
    const wrongPr = await evaluateM068MilestoneContract({
      ...baseParams,
      reviewOutputKey: REVIEW_OUTPUT_KEY.replace("pr-28172", "pr-123"),
      deliveryId: DELIVERY_ID,
    });
    const repoMismatch = await evaluateM068MilestoneContract({
      ...baseParams,
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      deliveryId: DELIVERY_ID,
      repo: "other/repo",
    });

    for (const report of [malformed, wrongLane, wrongRepo, wrongPr, repoMismatch]) {
      expect(report.success).toBe(false);
      expect(report.status_code).toBe("m068_invalid_arg");
      expect(report.failing_check_id).toBe("M068-EXACT-TARGET-PREFLIGHT");
    }
    expect(artifactCalls).toBe(0);
    expect(logCalls).toBe(0);
    expect(checkById(malformed, "M068-EXACT-TARGET-PREFLIGHT").status_code).toBe("invalid_review_output_key");
    expect(checkById(wrongLane, "M068-EXACT-TARGET-PREFLIGHT").detail).toContain("automatic review action");
    expect(checkById(wrongRepo, "M068-EXACT-TARGET-PREFLIGHT").status_code).toBe("invalid_target");
    expect(checkById(wrongPr, "M068-EXACT-TARGET-PREFLIGHT").status_code).toBe("invalid_target");
    expect(checkById(repoMismatch, "M068-EXACT-TARGET-PREFLIGHT").detail).toContain("does not match");
  });

  test("preflight-only with a valid retry key validates target and skips Azure logs", async () => {
    let artifactCalls = 0;
    let logCalls = 0;
    const report = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: RETRY_REVIEW_OUTPUT_KEY,
      deliveryId: `${DELIVERY_ID}-retry-2`,
      preflightOnly: true,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => {
        artifactCalls += 1;
        throw new Error("preflight-only should not collect artifacts");
      },
      queryReviewAuditLogs: async () => {
        logCalls += 1;
        return { query: "", rows: [] };
      },
    });

    expect(report.success).toBe(true);
    expect(artifactCalls).toBe(0);
    expect(logCalls).toBe(0);
    expect(report.preflight.review_output_key).toBe(REVIEW_OUTPUT_KEY);
    expect(report.preflight.delivery_id).toBe(`${DELIVERY_ID}-retry-2`);
    expect(checkById(report, "M068-EXACT-TARGET-PREFLIGHT").passed).toBe(true);
    expect(checkById(report, "M068-RUNTIME-LOG-EVIDENCE").status_code).toBe("preflight_skipped_runtime_logs");
  });

  test("rejects attempt-only Review Details runtime logs", async () => {
    const report = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      deliveryId: DELIVERY_ID,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([artifact({}), candidateInlineArtifact(1)]),
      queryReviewAuditLogs: async () => ({
        query: "ContainerAppConsoleLogs_CL",
        rows: [
          logRow(),
          logRow({
            message: "Review candidate publication adapter accepted",
            parsedLog: { msg: "Review candidate publication adapter accepted", reviewOutputKey: REVIEW_OUTPUT_KEY, deliveryId: DELIVERY_ID, gate: "review-candidate-publication-adapter" },
          }),
          logRow({
            message: "Attempting canonical Review Details publication",
            parsedLog: { msg: "Attempting canonical Review Details publication", reviewOutputKey: REVIEW_OUTPUT_KEY, deliveryId: DELIVERY_ID, gate: "review-details-output", gateResult: "attempt", reviewDetailsPublished: false },
          }),
        ],
      }),
    });

    expect(report.success).toBe(false);
    expect(checkById(report, "M068-RUNTIME-LOG-EVIDENCE").status_code).toBe("runtime_log_evidence_failed");
    expect(report.evidence.runtime.signals.review_details_publication).toBe(false);
    expect(report.evidence.runtime.review_details_publication_count).toBe(0);
    expect(checkById(report, "M068-RUNTIME-LOG-EVIDENCE").detail).toContain("missing Review Details publication log");
  });

  test("runtime log evidence recognizes candidate publication, adapter, and structured Review Details completion signals", async () => {
    const report = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      deliveryId: DELIVERY_ID,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([artifact({}), candidateInlineArtifact(1)]),
      queryReviewAuditLogs: async () => ({
        query: "ContainerAppConsoleLogs_CL",
        rows: [
          logRow(),
          logRow({
            message: "Review candidate publication adapter accepted",
            parsedLog: { msg: "Review candidate publication adapter accepted", reviewOutputKey: REVIEW_OUTPUT_KEY, deliveryId: DELIVERY_ID, gate: "review-candidate-publication-adapter" },
          }),
          logRow({
            message: "Review Details publication completed",
            parsedLog: { msg: "Review Details publication completed", reviewOutputKey: REVIEW_OUTPUT_KEY, deliveryId: DELIVERY_ID, gate: "review-details-output", gateResult: "completed", reviewDetailsPublished: true },
          }),
        ],
      }),
    });

    expect(report.success).toBe(true);
    expect(checkById(report, "M068-REDUCER-ADAPTER-PUBLICATION-STATE").passed).toBe(true);
    expect(checkById(report, "M068-RUNTIME-LOG-EVIDENCE").status_code).toBe("runtime_log_evidence_ok");
    expect(report.evidence.runtime.signals.candidate_publication).toBe(true);
    expect(report.evidence.runtime.signals.adapter_publication).toBe(true);
    expect(report.evidence.runtime.signals.review_details_publication).toBe(true);
  });

  test("missing Azure access and fallback-only logs are visible but not candidate-approved success", async () => {
    const unavailable = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      deliveryId: DELIVERY_ID,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([artifact({}), candidateInlineArtifact(1)]),
      queryReviewAuditLogs: async () => {
        throw new Error("Azure unavailable with TOKEN=abc123 rawPrompt");
      },
    });
    const fallbackOnly = await evaluateM068MilestoneContract({
      generatedAt: "2026-05-09T17:00:00.000Z",
      reviewOutputKey: REVIEW_OUTPUT_KEY,
      deliveryId: DELIVERY_ID,
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([artifact({}), candidateInlineArtifact(1)]),
      queryReviewAuditLogs: async () => ({
        query: "ContainerAppConsoleLogs_CL",
        rows: [logRow({
          message: "Review candidate publication completed",
          parsedLog: { msg: "Review candidate publication completed", reviewOutputKey: REVIEW_OUTPUT_KEY, deliveryId: DELIVERY_ID, gate: "review-candidate-publication", published: 0, directFallback: 1 },
        })],
      }),
    });

    expect(unavailable.success).toBe(false);
    expect(checkById(unavailable, "M068-RUNTIME-LOG-EVIDENCE").status_code).toBe("runtime_logs_unavailable");
    expectNoRawNestedBlob(JSON.stringify(unavailable));
    expect(fallbackOnly.success).toBe(false);
    expect(checkById(fallbackOnly, "M068-RUNTIME-LOG-EVIDENCE").status_code).toBe("runtime_log_evidence_failed");
    expect(fallbackOnly.evidence.runtime.direct_fallback_count).toBe(1);
  });
});

describe("main", () => {
  test("prints parseable JSON for safe preflight", async () => {
    let stdout = "";
    const exitCode = await main(["--preflight-only", "--json"], {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: () => undefined },
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as M068Report;
    expect(parsed.command).toBe("verify:m068");
    expect(parsed.check_ids).toEqual([...M068_CHECK_IDS]);
    expect(parsed.preflight.publication.status).toBe("missing_review_output_key");
  });

  test("returns nonzero and names the local prerequisite check when nested evaluation fails", async () => {
    let stdout = "";
    let stderr = "";
    const exitCode = await main(["--json"], {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: (chunk) => { stderr += chunk; } },
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => { throw new Error("nested evaluator exploded with rawPrompt diff --git TOKEN=abc123"); },
      evaluateS03: async () => nestedReport("verify:m068:s03"),
    });

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout) as M068Report;
    expect(parsed.failing_check_id).toBe("M068-LOCAL-PREREQUISITES");
    expect(stderr).toContain("verify:m068 failed: M068-LOCAL-PREREQUISITES");
    expectNoRawNestedBlob(stdout);
  });

  test("normal keyed CLI runs use live collection and fail bounded when GitHub access is missing", async () => {
    const previousAppId = process.env.GITHUB_APP_ID;
    const previousPrivateKey = process.env.GITHUB_PRIVATE_KEY;
    const previousPrivateKeyBase64 = process.env.GITHUB_PRIVATE_KEY_BASE64;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_PRIVATE_KEY;
    delete process.env.GITHUB_PRIVATE_KEY_BASE64;

    try {
      let stdout = "";
      let stderr = "";
      const exitCode = await main(["--json", "--review-output-key", REVIEW_OUTPUT_KEY, "--delivery-id", DELIVERY_ID], {
        stdout: { write: (chunk) => { stdout += chunk; } },
        stderr: { write: (chunk) => { stderr += chunk; } },
        evaluateS01: async () => nestedReport("verify:m068:s01"),
        evaluateS02: async () => nestedReport("verify:m068:s02"),
        evaluateS03: async () => nestedReport("verify:m068:s03"),
        queryReviewAuditLogs: okRuntimeQuery,
      });

      expect(exitCode).toBe(1);
      const parsed = JSON.parse(stdout) as M068Report;
      expect(parsed.success).toBe(false);
      expect(parsed.evidence.artifacts.status).toBe("unavailable");
      expect(checkById(parsed, "M068-CANDIDATE-PATH-PROOF").status_code).toBe("artifact_collection_unavailable");
      expect(checkById(parsed, "M068-CANDIDATE-PATH-PROOF").detail).toContain("GitHub");
      expect(checkById(parsed, "M068-CANDIDATE-PATH-PROOF").detail).not.toContain("pending live verifier wiring");
      expect(stderr).toContain("verify:m068 failed: M068-CANDIDATE-PATH-PROOF");
      expectNoRawNestedBlob(stdout);
    } finally {
      if (previousAppId === undefined) {
        delete process.env.GITHUB_APP_ID;
      } else {
        process.env.GITHUB_APP_ID = previousAppId;
      }
      if (previousPrivateKey === undefined) {
        delete process.env.GITHUB_PRIVATE_KEY;
      } else {
        process.env.GITHUB_PRIVATE_KEY = previousPrivateKey;
      }
      if (previousPrivateKeyBase64 === undefined) {
        delete process.env.GITHUB_PRIVATE_KEY_BASE64;
      } else {
        process.env.GITHUB_PRIVATE_KEY_BASE64 = previousPrivateKeyBase64;
      }
    }
  });

  test("normal keyed CLI runs query runtime logs when artifact evidence is available", async () => {
    let logCalls = 0;
    let stdout = "";
    const exitCode = await main(["--json", "--review-output-key", REVIEW_OUTPUT_KEY, "--delivery-id", DELIVERY_ID], {
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: () => undefined },
      evaluateS01: async () => nestedReport("verify:m068:s01"),
      evaluateS02: async () => nestedReport("verify:m068:s02"),
      evaluateS03: async () => nestedReport("verify:m068:s03"),
      collectReviewOutputArtifacts: async () => artifactCollection([artifact({}), candidateInlineArtifact(1)]),
      queryReviewAuditLogs: async ({ reviewOutputKey, repo, deliveryId }) => {
        logCalls += 1;
        expect(reviewOutputKey).toBe(REVIEW_OUTPUT_KEY);
        expect(repo).toBe("xbmc/xbmc");
        expect(deliveryId).toBe(DELIVERY_ID);
        return okRuntimeQuery();
      },
    });

    expect(exitCode).toBe(0);
    expect(logCalls).toBe(1);
    const parsed = JSON.parse(stdout) as M068Report;
    expect(parsed.evidence.runtime.status).toBe("classified");
    expect(checkById(parsed, "M068-RUNTIME-LOG-EVIDENCE").status_code).toBe("runtime_log_evidence_ok");
  });

  test("keeps invalid-argument JSON and text output bounded and sanitized", async () => {
    let jsonStdout = "";
    const jsonExitCode = await main(["--json", "SECRET=shh", "rawPrompt", "diff --git", "ghp_live_secret", "AKIA1234567890123456"], {
      stdout: { write: (chunk) => { jsonStdout += chunk; } },
      stderr: { write: () => undefined },
    });

    let textStdout = "";
    const textExitCode = await main(["SECRET=shh", "rawPrompt", "diff --git", "ghp_live_secret", "AKIA1234567890123456"], {
      stdout: { write: (chunk) => { textStdout += chunk; } },
      stderr: { write: () => undefined },
    });

    expect(jsonExitCode).toBe(1);
    expect(textExitCode).toBe(1);
    expectNoRawNestedBlob(jsonStdout);
    expectNoRawNestedBlob(textStdout);
    expect(jsonStdout.length).toBeLessThan(5000);
    expect(textStdout.length).toBeLessThan(3000);
  });
});
