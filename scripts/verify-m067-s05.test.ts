import { describe, expect, test } from "bun:test";
import { buildReviewOutputKey } from "../src/review-orchestration/review-idempotency.ts";
import { normalizeLogAnalyticsRows, type NormalizedLogAnalyticsRow } from "../src/review-audit/log-analytics.ts";
import type { ReviewOutputArtifactCollection } from "../src/review-audit/review-output-artifacts.ts";
import type { M067S04Report } from "./verify-m067-s04.ts";

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
    repo: overrides?.repo ?? "xbmc",
    prNumber: overrides?.prNumber ?? 28172,
    action: overrides?.action ?? "review_requested",
    deliveryId: overrides?.deliveryId ?? "delivery-28172",
    headSha: overrides?.headSha ?? "head-28172",
  });
}

function reviewDetailsBody(reviewOutputKey = makeReviewOutputKey()) {
  return [
    "Decision: APPROVE",
    "",
    "<details>",
    "<summary>Review Details</summary>",
    "",
    "- Review plan: ready hash=abcdef123456 route=standard graph=enabled candidates=shadow",
    "- Review reducer: ready kept=2 suppressed=0 rewritten=0 graphValidated=1 graphUncertain=0",
    "- Review candidates: shadow recorded=0 rejected=0 errors=0 artifact=absent",
    "",
    "</details>",
    "",
    `<!-- kodiai:review-details:${reviewOutputKey} -->`,
  ].join("\n");
}

type ArtifactOverrides = Partial<ReviewOutputArtifactCollection["artifacts"][number]>;

function makeArtifact(reviewOutputKey = makeReviewOutputKey(), overrides?: ArtifactOverrides): ReviewOutputArtifactCollection["artifacts"][number] {
  return {
    prNumber: 28172,
    prUrl: "https://github.com/xbmc/xbmc/pull/28172",
    source: "review",
    sourceUrl: "https://github.com/xbmc/xbmc/pull/28172#pullrequestreview-7001",
    updatedAt: "2026-05-09T18:00:00.000Z",
    reviewOutputKey,
    lane: "automatic",
    action: "review_requested",
    body: reviewDetailsBody(reviewOutputKey),
    reviewState: "APPROVED",
    ...overrides,
  };
}

function makeCollection(reviewOutputKey = makeReviewOutputKey(), artifacts?: ReviewOutputArtifactCollection["artifacts"]): ReviewOutputArtifactCollection {
  const actualArtifacts = artifacts ?? [makeArtifact(reviewOutputKey)];
  return {
    requestedReviewOutputKey: reviewOutputKey,
    prUrl: "https://github.com/xbmc/xbmc/pull/28172",
    artifactCounts: {
      reviewComments: actualArtifacts.filter((artifact) => artifact.source === "review-comment").length,
      issueComments: actualArtifacts.filter((artifact) => artifact.source === "issue-comment").length,
      reviews: actualArtifacts.filter((artifact) => artifact.source === "review").length,
      total: actualArtifacts.length,
    },
    artifacts: actualArtifacts,
  };
}

type LogRowFixture = { message?: string; extra?: Record<string, unknown>; raw?: string; time?: string };

function makeLogRows(reviewOutputKey = makeReviewOutputKey(), deliveryId = "delivery-28172", overrides?: LogRowFixture[]): NormalizedLogAnalyticsRow[] {
  const base: LogRowFixture[] = [
    { message: "ReviewPlan ready", extra: { planStatus: "ready" } },
    { message: "ReviewReducer ready", extra: { reducerStatus: "ready" } },
    { message: "candidate executor metadata", extra: { candidateMode: "shadow", recorded: 0, rejected: 0 } },
    { message: "Review Details publication", extra: { surface: "review-details-output", status: "published" } },
    {
      message: "Review phase timing summary",
      extra: {
        conclusion: "success",
        published: true,
        totalDurationMs: 1234,
        phases: [
          { name: "queue wait", status: "completed", durationMs: 1 },
          { name: "workspace preparation", status: "completed", durationMs: 2 },
          { name: "retrieval/context assembly", status: "completed", durationMs: 3 },
          { name: "executor handoff", status: "completed", durationMs: 4 },
          { name: "remote runtime", status: "completed", durationMs: 5 },
          { name: "publication", status: "completed", durationMs: 6 },
        ],
      },
    },
  ];
  return normalizeLogAnalyticsRows((overrides ?? base).map((row, index) => ({
    TimeGenerated: row.time ?? `2026-05-09T18:00:0${index}.000Z`,
    RevisionName_s: "kodiai--abc123",
    ContainerAppName_s: "ca-kodiai",
    Log_s: row.raw ?? JSON.stringify({ msg: row.message, reviewOutputKey, deliveryId, ...(row.extra ?? {}) }),
  })));
}

function makeS04Report(success = true): M067S04Report {
  const checkIds: M067S04Report["check_ids"] = ["CANDIDATE-SCHEMA-SHADOW", "CANDIDATE-MCP-TOOL-CAPTURE"];
  return {
    command: "verify:m067:s04" as const,
    generated_at: "2026-05-09T18:00:00.000Z",
    success,
    status_code: success ? "m067_s04_ok" : "m067_s04_contract_failed",
    check_ids: checkIds,
    checks: [],
    failing_check_id: success ? null : "CANDIDATE-SCHEMA-SHADOW",
    issues: [],
    candidate: { status: "shadow" as const, counts: { input: 1, recorded: 1, rejected: 0, errors: 0 }, artifact_present: true, artifact_basename: "review-candidate-findings.json", details_line: "" },
    mcp: { server_names: [], allowed_tools: [], recorded_response: {}, failing_recorder_response: {}, warning_count: 0 },
    review_details: { marker_count: 1, candidate_line_count: 1, candidate_line: "" },
    review_plan: { status: "ready" as const, candidate_mode: "shadow" as const, details_line: "" },
    prompt: { has_shadow_section: true, shadow_section: "", publish_tool_count: 2, includes_candidate_in_publish_contract: false },
    sidecar: { artifact_present: true, artifact_basename: "review-candidate-findings.json" },
  };
}

function runtimeDeps(reviewOutputKey = makeReviewOutputKey(), deliveryId = "delivery-28172") {
  return {
    workspaceIds: ["workspace-1"],
    queryLogs: async () => ({ query: "ContainerAppConsoleLogs_CL", rows: makeLogRows(reviewOutputKey, deliveryId) }),
    evaluateS04: async () => makeS04Report(true),
  };
}

async function loadModule() {
  return await import("./verify-m067-s05.ts");
}

describe("verify-m067-s05", () => {
  test("parse args defaults to xbmc/xbmc and accepts review-output-key, delivery-id, help, and json", async () => {
    const { parseVerifyM067S05Args } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();

    expect(parseVerifyM067S05Args(["--review-output-key", reviewOutputKey, "--delivery-id", "delivery-28172", "--json"])).toEqual({
      help: false,
      json: true,
      preflightOnly: false,
      repo: "xbmc/xbmc",
      reviewOutputKey,
      deliveryId: "delivery-28172",
      invalidArg: null,
    });

    expect(parseVerifyM067S05Args(["--help"]).help).toBe(true);
  });

  test("main rejects missing key, malformed key, wrong repo, wrong PR, mention-review, and unknown automatic action before collection", async () => {
    const { main } = await loadModule();
    const cases: Array<{ args: string[]; issue: string; status?: string; exitCode?: number }> = [
      { args: ["--json"], issue: "No review output key provided; skipped live M067 S05 verification.", status: "m067_s05_skipped_missing_review_output_key", exitCode: 0 },
      { args: ["--review-output-key", "not-a-key", "--json"], issue: "Malformed --review-output-key." },
      { args: ["--repo", "other/repo", "--review-output-key", makeReviewOutputKey(), "--json"], issue: "Provided --repo does not match the repository encoded in --review-output-key." },
      { args: ["--review-output-key", makeReviewOutputKey({ prNumber: 99 }), "--json"], issue: "--review-output-key must encode pr=28172." },
      { args: ["--review-output-key", makeReviewOutputKey({ action: "mention-review" }), "--json"], issue: "--review-output-key must encode an automatic review action (opened, ready_for_review, review_requested, synchronize)." },
      { args: ["--review-output-key", makeReviewOutputKey({ action: "closed" }), "--json"], issue: "--review-output-key must encode an automatic review action (opened, ready_for_review, review_requested, synchronize)." },
    ];

    for (const testCase of cases) {
      const stdoutChunks: string[] = [];
      const exitCode = await main(testCase.args, {
        stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
        stderr: { write: () => undefined },
        collectArtifacts: async () => {
          throw new Error("collector should not be called");
        },
      });

      const report = JSON.parse(stdoutChunks.join(""));
      expect(exitCode).toBe(testCase.exitCode ?? 1);
      expect(report.status_code).toBe(testCase.status ?? "m067_s05_invalid_arg");
      expect(report.issues).toContain(testCase.issue);
    }
  });

  test("json report omits raw correlated runtime log messages", async () => {
    const { main } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();
    const stdoutChunks: string[] = [];

    const exitCode = await main(["--review-output-key", reviewOutputKey, "--delivery-id", "delivery-28172", "--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: () => undefined },
      githubAccess: "available",
      collectArtifacts: async () => makeCollection(reviewOutputKey),
      discoverWorkspaceIds: async () => ["workspace-1"],
      queryLogs: async () => ({
        query: "ContainerAppConsoleLogs_CL",
        rows: makeLogRows(reviewOutputKey, "delivery-28172", [
          {
            message: "ReviewPlan ready rawPrompt TOKEN=abc123 diff --git",
            extra: { planStatus: "ready" },
          },
          { message: "ReviewReducer ready", extra: { reducerStatus: "ready" } },
          { message: "candidate executor metadata", extra: { candidateMode: "shadow" } },
          { message: "Review Details publication", extra: { status: "published" } },
          {
            message: "Review phase timing summary",
            extra: {
              conclusion: "success",
              published: true,
              totalDurationMs: 1234,
              phases: [
                { name: "queue wait", status: "completed", durationMs: 1 },
                { name: "workspace preparation", status: "completed", durationMs: 2 },
                { name: "retrieval/context assembly", status: "completed", durationMs: 3 },
                { name: "executor handoff", status: "completed", durationMs: 4 },
                { name: "remote runtime", status: "completed", durationMs: 5 },
                { name: "publication", status: "completed", durationMs: 6 },
              ],
            },
          },
        ]),
      }),
      evaluateS04: async () => makeS04Report(true),
    });

    const serialized = stdoutChunks.join("");
    const report = JSON.parse(serialized);
    expect(exitCode).toBe(1);
    expect(report.runtime.logMessages).toBeUndefined();
    expect(serialized).not.toContain("TOKEN=abc123");
    expect(serialized).not.toContain("diff --git");
    expect(serialized).not.toContain("rawPrompt");
    expect(report.anomalies.marker_count).toBeGreaterThan(0);
  });

  test("evaluate accepts a retry key but looks up exact GitHub-visible evidence by the normalized base key", async () => {
    const { evaluateM067S05IntegratedProof } = await loadModule();
    const baseReviewOutputKey = makeReviewOutputKey();
    const retryReviewOutputKey = `${baseReviewOutputKey}-retry-2`;
    let collectedKey: string | null = null;

    const report = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey: retryReviewOutputKey,
      generatedAt: "2026-05-09T18:05:00.000Z",
      githubAccess: "available",
      ...runtimeDeps(baseReviewOutputKey),
      collectArtifacts: async ({ reviewOutputKey }: { reviewOutputKey: string }) => {
        collectedKey = reviewOutputKey;
        return makeCollection(baseReviewOutputKey);
      },
    });

    expect(String(collectedKey)).toBe(baseReviewOutputKey);
    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m067_s05_ok");
    expect(report.identity).toMatchObject({ repo: "xbmc/xbmc", pr_number: 28172, action: "review_requested", evidence_review_output_key: baseReviewOutputKey });
    expect(report.artifactCounts).toEqual({ reviewComments: 0, issueComments: 0, reviews: 1, total: 1 });
  });

  test("evaluate requires exactly one canonical Review Details artifact with compact plan, reducer, and candidate lines", async () => {
    const { evaluateM067S05IntegratedProof, renderM067S05Report } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();

    const report = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      deliveryId: "delivery-28172",
      generatedAt: "2026-05-09T18:10:00.000Z",
      githubAccess: "available",
      ...runtimeDeps(reviewOutputKey),
      collectArtifacts: async () => makeCollection(reviewOutputKey),
    });

    expect(report).toMatchObject({
      command: "verify:m067:s05",
      generated_at: "2026-05-09T18:10:00.000Z",
      success: true,
      status_code: "m067_s05_ok",
      failing_check_id: null,
      details: {
        marker_count: 1,
        review_plan_line_count: 1,
        review_reducer_line_count: 1,
        review_candidates_line_count: 1,
      },
    });
    expect(report.checks.map((check) => [check.id, check.passed])).toEqual([
      ["M067-S05-KEY-IDENTITY", true],
      ["M067-S05-PUBLICATION-READINESS", true],
      ["M067-S05-GITHUB-VISIBLE-VOLUME", true],
      ["M067-S05-DETAILS-OBSERVABILITY", true],
      ["M067-S05-RUNTIME-LOG-EVIDENCE", true],
      ["M067-S05-NO-ANOMALY-MARKERS", true],
      ["M067-S05-S04-REGRESSION-CONTRACT", true],
    ]);

    const text = renderM067S05Report(report);
    expect(text).toContain("Status: m067_s05_ok");
    expect(text).toContain("Failing check: none");
    expect(text).not.toContain("Decision: APPROVE");
  });

  test("publication preflight distinguishes ready, missing key, wrong lane, wrong repo/pr, unavailable artifacts, publication gaps, duplicates, and access blockers", async () => {
    const { evaluateM067S05PublicationReadiness } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();

    const ready = await evaluateM067S05PublicationReadiness({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      collectArtifacts: async () => makeCollection(reviewOutputKey),
    });
    const missing = await evaluateM067S05PublicationReadiness({ repo: "xbmc/xbmc", reviewOutputKey: null });
    const wrongLane = await evaluateM067S05PublicationReadiness({ repo: "xbmc/xbmc", reviewOutputKey: makeReviewOutputKey({ action: "mention-review" }) });
    const wrongRepo = await evaluateM067S05PublicationReadiness({ repo: "xbmc/xbmc", reviewOutputKey: makeReviewOutputKey({ owner: "other", repo: "repo" }) });
    const unavailable = await evaluateM067S05PublicationReadiness({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      collectArtifacts: async () => { throw new Error("GitHub endpoint failed with body ".repeat(30)); },
    });
    const accessBlocked = await evaluateM067S05PublicationReadiness({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      collectArtifacts: async () => { throw new Error("Resource not accessible by integration"); },
    });
    const notPublished = await evaluateM067S05PublicationReadiness({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      collectArtifacts: async () => makeCollection(reviewOutputKey, []),
    });
    const duplicateArtifacts = await evaluateM067S05PublicationReadiness({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      collectArtifacts: async () => makeCollection(reviewOutputKey, [makeArtifact(reviewOutputKey, { sourceUrl: "review-1" }), makeArtifact(reviewOutputKey, { sourceUrl: "review-2" })]),
    });
    const duplicateMarker = await evaluateM067S05PublicationReadiness({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      collectArtifacts: async () => makeCollection(reviewOutputKey, [makeArtifact(reviewOutputKey, { body: `${reviewDetailsBody(reviewOutputKey)}\n<!-- kodiai:review-details:${reviewOutputKey} -->` })]),
    });
    const candidateOnly = await evaluateM067S05PublicationReadiness({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      collectArtifacts: async () => makeCollection(reviewOutputKey, [makeArtifact(reviewOutputKey, { source: "issue-comment", reviewState: null })]),
    });

    expect(ready.publication.status).toBe("ready");
    expect(missing.publication.status).toBe("missing_review_output_key");
    expect(wrongLane.publication.status).toBe("wrong_lane");
    expect(wrongRepo.publication.status).toBe("wrong_repo_or_pr");
    expect(unavailable.publication.status).toBe("github_artifact_unavailable");
    expect(accessBlocked.publication.status).toBe("publication_access_blocked");
    expect(notPublished.publication.status).toBe("review_details_not_published");
    expect(duplicateArtifacts.publication.status).toBe("duplicate_review_details");
    expect(duplicateMarker.publication.status).toBe("duplicate_review_details");
    expect(candidateOnly.publication.status).toBe("review_details_not_published");
    expect(unavailable.publication.issue.length).toBeLessThan(260);
    expect(unavailable.publication.issue).not.toContain("GitHub endpoint failed with body GitHub endpoint failed with body GitHub endpoint failed with body GitHub endpoint failed with body GitHub endpoint failed with body");
    expect(ready.publication.check_id).toBe("M067-S05-PUBLICATION-READINESS");
  });

  test("preflight-only main emits bounded publication readiness without Azure evidence lookup", async () => {
    const { main } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();
    const stdoutChunks: string[] = [];
    let queriedAzure = false;

    const exitCode = await main(["--review-output-key", reviewOutputKey, "--json", "--preflight-only"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: () => undefined },
      githubAccess: "available",
      collectArtifacts: async () => makeCollection(reviewOutputKey),
      queryLogs: async () => {
        queriedAzure = true;
        return { query: "should-not-run", rows: [] };
      },
    });

    const report = JSON.parse(stdoutChunks.join(""));
    expect(exitCode).toBe(0);
    expect(queriedAzure).toBe(false);
    expect(report.status_code).toBe("m067_s05_ok");
    expect(report.preflight.publication).toMatchObject({
      status: "ready",
      check_id: "M067-S05-PUBLICATION-READINESS",
      artifactCounts: { reviewComments: 0, issueComments: 0, reviews: 1, total: 1 },
    });
    expect(report.runtime.workspaceCount).toBe(0);
  });

  test("preflight-only main reports missing key as bounded publication blocker without collecting artifacts", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];
    let collected = false;

    const exitCode = await main(["--json", "--preflight-only"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: () => undefined },
      collectArtifacts: async () => {
        collected = true;
        return makeCollection();
      },
    });

    const report = JSON.parse(stdoutChunks.join(""));
    expect(exitCode).toBe(0);
    expect(collected).toBe(false);
    expect(report.status_code).toBe("m067_s05_skipped_missing_review_output_key");
    expect(report.preflight.publication).toMatchObject({
      status: "missing_review_output_key",
      check_id: "M067-S05-PUBLICATION-READINESS",
      artifactCounts: { reviewComments: 0, issueComments: 0, reviews: 0, total: 0 },
    });
  });

  test("evaluate classifies missing Review Details publication after a valid automatic key as publication readiness", async () => {
    const { evaluateM067S05IntegratedProof } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();

    const report = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      githubAccess: "available",
      ...runtimeDeps(reviewOutputKey),
      collectArtifacts: async () => makeCollection(reviewOutputKey, []),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M067-S05-PUBLICATION-READINESS");
    expect(report.preflight.publication.status).toBe("review_details_not_published");
    expect(report.issues.join("\n")).toContain("Review Details artifact was not published for the normalized reviewOutputKey.");
  });

  test("evaluate rejects zero artifacts, duplicate Review Details artifacts, and candidate-only GitHub artifacts", async () => {
    const { evaluateM067S05IntegratedProof } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();

    const zero = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      githubAccess: "available",
      ...runtimeDeps(reviewOutputKey),
      collectArtifacts: async () => makeCollection(reviewOutputKey, []),
    });
    const duplicate = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      githubAccess: "available",
      ...runtimeDeps(reviewOutputKey),
      collectArtifacts: async () => makeCollection(reviewOutputKey, [
        makeArtifact(reviewOutputKey, { sourceUrl: "review-1" }),
        makeArtifact(reviewOutputKey, { sourceUrl: "review-2" }),
      ]),
    });
    const candidateOnly = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      githubAccess: "available",
      ...runtimeDeps(reviewOutputKey),
      collectArtifacts: async () => makeCollection(reviewOutputKey, [
        makeArtifact(reviewOutputKey, {
          source: "issue-comment",
          sourceUrl: "https://github.com/xbmc/xbmc/pull/28172#issuecomment-1",
          reviewState: null,
          body: [
            "- Review candidates: shadow recorded=1 rejected=0 errors=0 artifact=present",
            `<!-- kodiai:review-details:${reviewOutputKey} -->`,
          ].join("\n"),
        }),
      ]),
    });

    expect(zero.failing_check_id).toBe("M067-S05-PUBLICATION-READINESS");
    expect(zero.status_code).toBe("m067_s05_contract_failed");
    expect(zero.issues).toContain("Review Details artifact was not published for the normalized reviewOutputKey.");
    expect(duplicate.issues.join("\n")).toContain("Expected exactly one visible GitHub artifact");
    expect(candidateOnly.issues.join("\n")).toContain("candidate-only GitHub artifact");
  });

  test("evaluate rejects duplicate markers, missing compact lines, malformed metadata, and raw data leakage", async () => {
    const { evaluateM067S05IntegratedProof } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();
    const duplicateMarkerBody = `${reviewDetailsBody(reviewOutputKey)}\n<!-- kodiai:review-details:${reviewOutputKey} -->`;
    const missingReducerBody = reviewDetailsBody(reviewOutputKey).replace("- Review reducer: ready kept=2 suppressed=0 rewritten=0 graphValidated=1 graphUncertain=0\n", "");
    const rawLeakBody = reviewDetailsBody(reviewOutputKey).replace("artifact=absent", "artifact=absent rawPrompt diff --git TOKEN=abc123");

    const duplicateMarker = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      githubAccess: "available",
      ...runtimeDeps(reviewOutputKey),
      collectArtifacts: async () => makeCollection(reviewOutputKey, [makeArtifact(reviewOutputKey, { body: duplicateMarkerBody })]),
    });
    const missingReducer = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      githubAccess: "available",
      ...runtimeDeps(reviewOutputKey),
      collectArtifacts: async () => makeCollection(reviewOutputKey, [makeArtifact(reviewOutputKey, { body: missingReducerBody })]),
    });
    const malformed = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      githubAccess: "available",
      ...runtimeDeps(reviewOutputKey),
      collectArtifacts: async () => makeCollection(reviewOutputKey, [makeArtifact(reviewOutputKey, { updatedAt: null })]),
    });
    const rawLeak = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      githubAccess: "available",
      ...runtimeDeps(reviewOutputKey),
      collectArtifacts: async () => makeCollection(reviewOutputKey, [makeArtifact(reviewOutputKey, { body: rawLeakBody })]),
    });

    expect(duplicateMarker.failing_check_id).toBe("M067-S05-PUBLICATION-READINESS");
    expect(duplicateMarker.preflight.publication.status).toBe("duplicate_review_details");
    expect(missingReducer.failing_check_id).toBe("M067-S05-PUBLICATION-READINESS");
    expect(missingReducer.preflight.publication.status).toBe("review_details_not_published");
    expect(malformed.failing_check_id).toBe("M067-S05-PUBLICATION-READINESS");
    expect(malformed.preflight.publication.status).toBe("review_details_not_published");
    expect(rawLeak.issues.join("\n")).toContain("Review Details leaked raw prompt, diff, candidate payload, token, secret, or object data");
  });

  test("evaluate treats GitHub artifact collector failures as bounded unavailable reports", async () => {
    const { evaluateM067S05IntegratedProof } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();

    const report = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      githubAccess: "available",
      ...runtimeDeps(reviewOutputKey),
      collectArtifacts: async () => {
        throw new Error("GitHub response body with raw data ".repeat(30));
      },
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m067_s05_github_unavailable");
    expect(report.preflight.githubAccess).toBe("unavailable");
    expect(report.issues.join("\n").length).toBeLessThan(500);
  });

  test("evaluate includes correlated runtime log evidence, phase timing, and bounded S04 regression status", async () => {
    const { evaluateM067S05IntegratedProof } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();

    const report = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      deliveryId: "delivery-28172",
      generatedAt: "2026-05-09T18:20:00.000Z",
      githubAccess: "available",
      collectArtifacts: async () => makeCollection(reviewOutputKey),
      workspaceIds: ["workspace-1"],
      queryLogs: async () => ({ query: "ContainerAppConsoleLogs_CL", rows: makeLogRows(reviewOutputKey) }),
      evaluateS04: async () => makeS04Report(true),
    });

    expect(report.success).toBe(true);
    expect(report.checks.map((check) => check.id)).toContain("M067-S05-RUNTIME-LOG-EVIDENCE");
    expect(report.checks.map((check) => check.id)).toContain("M067-S05-S04-REGRESSION-CONTRACT");
    expect(report.preflight.azureAccess).toBe("available");
    expect(report.runtime).toMatchObject({
      sourceAvailability: "present",
      workspaceCount: 1,
      matchedRowCount: 5,
      malformedRowCount: 0,
      revisionNames: ["kodiai--abc123"],
      containerAppNames: ["ca-kodiai"],
      signals: {
        reviewPlanReady: true,
        reviewReducerReady: true,
        candidateExecutorMetadata: true,
        reviewDetailsPublication: true,
        phaseTimingSummary: true,
      },
    });
    expect(report.runtime.phaseTiming.status).toBe("ok");
    expect(report.s04).toMatchObject({ success: true, status_code: "m067_s04_ok", check_ids: ["CANDIDATE-SCHEMA-SHADOW", "CANDIDATE-MCP-TOOL-CAPTURE"] });
  });

  test("evaluate fails bounded runtime evidence for malformed, drifted, and missing phase timing rows", async () => {
    const { evaluateM067S05IntegratedProof } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();
    const rows = [
      ...makeLogRows(reviewOutputKey, "other-delivery", [{ message: "ReviewPlan ready", extra: {} }]),
      ...makeLogRows(reviewOutputKey, "delivery-28172", [{ raw: `not-json ${reviewOutputKey} delivery-28172`, message: "ignored" }]),
    ];

    const report = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      deliveryId: "delivery-28172",
      githubAccess: "available",
      collectArtifacts: async () => makeCollection(reviewOutputKey),
      workspaceIds: ["workspace-1"],
      queryLogs: async () => ({ query: "ContainerAppConsoleLogs_CL", rows }),
      evaluateS04: async () => makeS04Report(true),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M067-S05-RUNTIME-LOG-EVIDENCE");
    expect(report.runtime.malformedRowCount).toBe(1);
    expect(report.runtime.driftedRowCount).toBe(1);
    expect(report.issues.join("\n")).toContain("Malformed runtime log rows found");
    expect(report.issues.join("\n")).toContain("Missing valid Review phase timing summary runtime signal");
  });

  test("evaluate scans anomaly markers in Review Details and correlated logs", async () => {
    const { evaluateM067S05IntegratedProof } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();
    const detailsAnomaly = `${reviewDetailsBody(reviewOutputKey)}\nReview plan builder failed`;
    const logRows = makeLogRows(reviewOutputKey, "delivery-28172", [
      { message: "ReviewPlan ready", extra: {} },
      { message: "ReviewReducer ready", extra: {} },
      { message: "candidate executor metadata", extra: {} },
      { message: "Review Details publication sidecar-write-failed", extra: {} },
      makeLogRows(reviewOutputKey)[4]!.parsedLog ? { message: "Review phase timing summary", extra: makeLogRows(reviewOutputKey)[4]!.parsedLog! } : { message: "Review phase timing summary", extra: {} },
    ]);

    const report = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      deliveryId: "delivery-28172",
      githubAccess: "available",
      collectArtifacts: async () => makeCollection(reviewOutputKey, [makeArtifact(reviewOutputKey, { body: detailsAnomaly })]),
      workspaceIds: ["workspace-1"],
      queryLogs: async () => ({ query: "ContainerAppConsoleLogs_CL", rows: logRows }),
      evaluateS04: async () => makeS04Report(true),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M067-S05-NO-ANOMALY-MARKERS");
    expect(report.anomalies.markers).toContain("Review plan builder failed");
    expect(report.anomalies.markers).toContain("sidecar-write-failed");
  });

  test("evaluate reports Azure and S04 failures with bounded status codes", async () => {
    const { evaluateM067S05IntegratedProof } = await loadModule();
    const reviewOutputKey = makeReviewOutputKey();

    const azureUnavailable = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      githubAccess: "available",
      collectArtifacts: async () => makeCollection(reviewOutputKey),
      discoverWorkspaceIds: async () => { throw new Error("az login required SECRET=hidden".repeat(20)); },
      evaluateS04: async () => makeS04Report(true),
    });
    const s04Failed = await evaluateM067S05IntegratedProof({
      repo: "xbmc/xbmc",
      reviewOutputKey,
      githubAccess: "available",
      collectArtifacts: async () => makeCollection(reviewOutputKey),
      ...runtimeDeps(reviewOutputKey),
      evaluateS04: async () => makeS04Report(false),
    });

    expect(azureUnavailable.status_code).toBe("m067_s05_azure_unavailable");
    expect(azureUnavailable.preflight.azureAccess).toBe("unavailable");
    expect(azureUnavailable.issues.join("\n").length).toBeLessThan(500);
    expect(s04Failed.failing_check_id).toBe("M067-S05-S04-REGRESSION-CONTRACT");
    expect(s04Failed.s04).toMatchObject({ success: false, status_code: "m067_s04_contract_failed", failing_check_id: "CANDIDATE-SCHEMA-SHADOW" });
  });

  test("main emits json output and package.json wires verify:m067:s05 to the verifier script", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];
    const reviewOutputKey = makeReviewOutputKey();

    const exitCode = await main(["--review-output-key", reviewOutputKey, "--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: () => undefined },
      githubAccess: "available",
      ...runtimeDeps(reviewOutputKey),
      collectArtifacts: async () => makeCollection(reviewOutputKey),
    });

    const report = JSON.parse(stdoutChunks.join(""));
    expect(exitCode).toBe(0);
    expect(report.command).toBe("verify:m067:s05");
    expect(report.status_code).toBe("m067_s05_ok");

    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["verify:m067:s05"]).toBe("bun scripts/verify-m067-s05.ts");
  });
});
