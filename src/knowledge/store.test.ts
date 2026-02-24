import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import postgres from "postgres";
import { createKnowledgeStore } from "./store.ts";
import type { KnowledgeStore } from "./types.ts";
import type { Sql } from "../db/client.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://kodiai:kodiai@localhost:5432/kodiai";

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => mockLogger,
  level: "silent",
} as unknown as import("pino").Logger;

let sql: Sql;
let store: KnowledgeStore;

/** Truncate all knowledge-related tables for test isolation. */
async function truncateAll(): Promise<void> {
  await sql`TRUNCATE
    review_checkpoints,
    feedback_reactions,
    suppression_log,
    findings,
    dep_bump_merge_history,
    global_patterns,
    author_cache,
    run_state,
    reviews
    CASCADE`;
}

beforeAll(async () => {
  sql = postgres(DATABASE_URL, { max: 5, idle_timeout: 20, connect_timeout: 10 });
  store = createKnowledgeStore({ sql, logger: mockLogger });
});

afterAll(async () => {
  await sql.end();
});

describe("KnowledgeStore", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test("recordReview returns integer id and persists review row", async () => {
    const reviewId = await store.recordReview({
      repo: "owner/repo",
      prNumber: 42,
      headSha: "abc123",
      deliveryId: "delivery-1",
      filesAnalyzed: 12,
      linesChanged: 400,
      findingsCritical: 1,
      findingsMajor: 2,
      findingsMedium: 3,
      findingsMinor: 4,
      findingsTotal: 10,
      suppressionsApplied: 2,
      configSnapshot: '{"mode":"enhanced"}',
      durationMs: 1234,
      model: "claude-sonnet-4-5-20250929",
      conclusion: "success",
    });

    expect(Number.isInteger(reviewId)).toBe(true);
    expect(reviewId).toBeGreaterThan(0);

    const [row] = await sql`SELECT * FROM reviews WHERE id = ${reviewId}`;
    expect(row).toBeTruthy();
    expect(row.repo).toBe("owner/repo");
    expect(row.pr_number).toBe(42);
    expect(row.files_analyzed).toBe(12);
    expect(row.findings_total).toBe(10);
    expect(row.suppressions_applied).toBe(2);
  });

  test("recordFindings batch inserts findings linked to review", async () => {
    const reviewId = await store.recordReview({
      repo: "owner/repo",
      prNumber: 7,
      filesAnalyzed: 2,
      linesChanged: 30,
      findingsCritical: 0,
      findingsMajor: 1,
      findingsMedium: 0,
      findingsMinor: 0,
      findingsTotal: 1,
      suppressionsApplied: 0,
      conclusion: "success",
    });

    await store.recordFindings([
      {
        reviewId,
        filePath: "src/api/auth.ts",
        startLine: 10,
        endLine: 12,
        severity: "major",
        category: "security",
        confidence: 90,
        title: "Missing auth check",
        suppressed: false,
      },
    ]);

    const [finding] = await sql`SELECT * FROM findings WHERE review_id = ${reviewId}`;
    expect(finding).toBeTruthy();
    expect(finding.file_path).toBe("src/api/auth.ts");
    expect(finding.severity).toBe("major");
    expect(finding.category).toBe("security");
    expect(finding.suppressed).toBe(false);
  });

  test("recordFindings persists deterministic comment linkage fields", async () => {
    const reviewId = await store.recordReview({
      repo: "owner/repo",
      prNumber: 77,
      filesAnalyzed: 1,
      linesChanged: 10,
      findingsCritical: 0,
      findingsMajor: 1,
      findingsMedium: 0,
      findingsMinor: 0,
      findingsTotal: 1,
      suppressionsApplied: 0,
      conclusion: "success",
    });

    await store.recordFindings([
      {
        reviewId,
        commentId: 1234,
        commentSurface: "pull_request_review_comment",
        reviewOutputKey: "kodiai-review-output:v1:test",
        filePath: "src/handler.ts",
        severity: "major",
        category: "correctness",
        confidence: 80,
        title: "Guard undefined access",
        suppressed: false,
      },
    ]);

    const [finding] = await sql`
      SELECT comment_id, comment_surface, review_output_key FROM findings WHERE review_id = ${reviewId}
    `;
    expect(finding.comment_id).toBe(1234);
    expect(finding.comment_surface).toBe("pull_request_review_comment");
    expect(finding.review_output_key).toBe("kodiai-review-output:v1:test");
  });

  test("recordFeedbackReactions is append-only and deduplicates by repo/comment/reaction", async () => {
    const reviewId = await store.recordReview({
      repo: "owner/repo",
      prNumber: 88,
      filesAnalyzed: 1,
      linesChanged: 10,
      findingsCritical: 0,
      findingsMajor: 1,
      findingsMedium: 0,
      findingsMinor: 0,
      findingsTotal: 1,
      suppressionsApplied: 0,
      conclusion: "success",
    });

    await store.recordFindings([
      {
        reviewId,
        commentId: 222,
        commentSurface: "pull_request_review_comment",
        reviewOutputKey: "kodiai-review-output:v1:feedback",
        filePath: "src/api/routes.ts",
        severity: "major",
        category: "security",
        confidence: 91,
        title: "Sanitize request body",
        suppressed: false,
      },
    ]);

    const [findingRow] = await sql`SELECT id FROM findings WHERE review_id = ${reviewId}`;

    await store.recordFeedbackReactions([
      {
        repo: "owner/repo",
        reviewId,
        findingId: findingRow.id,
        commentId: 222,
        commentSurface: "pull_request_review_comment",
        reactionId: 9001,
        reactionContent: "+1",
        reactorLogin: "alice",
        reactedAt: "2026-02-12T00:00:00Z",
        severity: "major",
        category: "security",
        filePath: "src/api/routes.ts",
        title: "Sanitize request body",
      },
      {
        repo: "owner/repo",
        reviewId,
        findingId: findingRow.id,
        commentId: 222,
        commentSurface: "pull_request_review_comment",
        reactionId: 9002,
        reactionContent: "-1",
        reactorLogin: "bob",
        reactedAt: "2026-02-12T00:05:00Z",
        severity: "major",
        category: "security",
        filePath: "src/api/routes.ts",
        title: "Sanitize request body",
      },
      {
        repo: "owner/repo",
        reviewId,
        findingId: findingRow.id,
        commentId: 222,
        commentSurface: "pull_request_review_comment",
        reactionId: 9001,
        reactionContent: "+1",
        reactorLogin: "alice",
        reactedAt: "2026-02-12T00:00:00Z",
        severity: "major",
        category: "security",
        filePath: "src/api/routes.ts",
        title: "Sanitize request body",
      },
    ]);

    const rows = await sql`
      SELECT reaction_content, reactor_login, severity, category, file_path, title
      FROM feedback_reactions WHERE finding_id = ${findingRow.id} ORDER BY reaction_id ASC
    `;

    expect(rows).toHaveLength(2);
    expect(rows[0]?.reaction_content).toBe("+1");
    expect(rows[1]?.reaction_content).toBe("-1");
    expect(rows[0]?.reactor_login).toBe("alice");
    expect(rows[1]?.reactor_login).toBe("bob");
    expect(rows[0]?.severity).toBe("major");
    expect(rows[0]?.category).toBe("security");
    expect(rows[0]?.file_path).toBe("src/api/routes.ts");
    expect(rows[0]?.title).toBe("Sanitize request body");
  });

  test("listRecentFindingCommentCandidates returns linked findings for repo", async () => {
    const reviewId = await store.recordReview({
      repo: "owner/repo",
      prNumber: 89,
      filesAnalyzed: 1,
      linesChanged: 5,
      findingsCritical: 0,
      findingsMajor: 1,
      findingsMedium: 0,
      findingsMinor: 0,
      findingsTotal: 1,
      suppressionsApplied: 0,
      conclusion: "success",
    });

    await store.recordFindings([
      {
        reviewId,
        commentId: 444,
        commentSurface: "pull_request_review_comment",
        reviewOutputKey: "kodiai-review-output:v1:candidate",
        filePath: "src/candidate.ts",
        severity: "major",
        category: "correctness",
        confidence: 70,
        title: "Candidate finding",
        suppressed: false,
      },
    ]);

    const candidates = await store.listRecentFindingCommentCandidates("owner/repo", 10);
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.commentId).toBe(444);
    expect(candidates[0]?.commentSurface).toBe("pull_request_review_comment");
    expect(candidates[0]?.reviewOutputKey).toBe("kodiai-review-output:v1:candidate");
    expect(candidates[0]?.filePath).toBe("src/candidate.ts");
  });

  test("getFindingByCommentId returns finding metadata and null when missing", async () => {
    const reviewId = await store.recordReview({
      repo: "owner/repo",
      prNumber: 90,
      filesAnalyzed: 1,
      linesChanged: 5,
      findingsCritical: 0,
      findingsMajor: 1,
      findingsMedium: 0,
      findingsMinor: 0,
      findingsTotal: 1,
      suppressionsApplied: 0,
      conclusion: "success",
    });

    await store.recordFindings([
      {
        reviewId,
        commentId: 5566,
        commentSurface: "pull_request_review_comment",
        reviewOutputKey: "kodiai-review-output:v1:finding",
        filePath: "src/thread.ts",
        startLine: 27,
        severity: "major",
        category: "correctness",
        confidence: 88,
        title: "Guard nullable value",
        suppressed: false,
      },
    ]);

    const finding = await store.getFindingByCommentId?.({
      repo: "owner/repo",
      commentId: 5566,
    });
    expect(finding).toEqual({
      severity: "major",
      category: "correctness",
      filePath: "src/thread.ts",
      startLine: 27,
      title: "Guard nullable value",
    });

    const missing = await store.getFindingByCommentId?.({
      repo: "owner/repo",
      commentId: 999999,
    });
    expect(missing).toBeNull();
  });

  test("upsertAuthorCache persists and retrieves author cache rows", async () => {
    await store.upsertAuthorCache?.({
      repo: "owner/repo",
      authorLogin: "alice",
      tier: "regular",
      authorAssociation: "CONTRIBUTOR",
      prCount: 3,
    });

    const cached = await store.getAuthorCache?.({
      repo: "owner/repo",
      authorLogin: "alice",
    });

    expect(cached).toBeTruthy();
    expect(cached!.tier).toBe("regular");
    expect(cached!.authorAssociation).toBe("CONTRIBUTOR");
    expect(cached!.prCount).toBe(3);
    expect(cached!.cachedAt).toBeTruthy();
  });

  test("upsertAuthorCache skips write when repo identity is missing", async () => {
    await store.upsertAuthorCache?.({
      repo: "",
      authorLogin: "alice",
      tier: "regular",
      authorAssociation: "CONTRIBUTOR",
      prCount: 1,
    });

    const [countRow] = await sql`SELECT COUNT(*) AS count FROM author_cache`;
    expect(Number(countRow.count)).toBe(0);
  });

  test("recordSuppressionLog stores suppression entries", async () => {
    const reviewId = await store.recordReview({
      repo: "owner/repo",
      prNumber: 9,
      filesAnalyzed: 1,
      linesChanged: 10,
      findingsCritical: 0,
      findingsMajor: 0,
      findingsMedium: 1,
      findingsMinor: 0,
      findingsTotal: 1,
      suppressionsApplied: 1,
      conclusion: "success",
    });

    await store.recordSuppressionLog([
      {
        reviewId,
        pattern: "missing JSDoc",
        matchedCount: 2,
        findingIds: [11, 12],
      },
    ]);

    const [row] = await sql`SELECT * FROM suppression_log WHERE review_id = ${reviewId}`;
    expect(row).toBeTruthy();
    expect(row.pattern).toBe("missing JSDoc");
    expect(row.matched_count).toBe(2);
    expect(row.finding_ids).toBe("[11,12]");
  });

  test("recordGlobalPattern upserts anonymized aggregate counts", async () => {
    await store.recordGlobalPattern({
      severity: "major",
      category: "correctness",
      confidenceBand: "high",
      patternFingerprint: "fp-abc123",
      count: 2,
    });
    await store.recordGlobalPattern({
      severity: "major",
      category: "correctness",
      confidenceBand: "high",
      patternFingerprint: "fp-abc123",
      count: 3,
    });

    const [row] = await sql`
      SELECT severity, category, confidence_band, pattern_fingerprint, count
      FROM global_patterns WHERE pattern_fingerprint = ${"fp-abc123"}
    `;
    expect(row.severity).toBe("major");
    expect(row.category).toBe("correctness");
    expect(row.confidence_band).toBe("high");
    expect(row.pattern_fingerprint).toBe("fp-abc123");
    expect(row.count).toBe(5);
  });

  test("recordDepBumpMergeHistory persists idempotent dep bump merge row", async () => {
    await store.recordDepBumpMergeHistory({
      repo: "owner/repo",
      prNumber: 123,
      mergedAt: "2026-02-15T00:00:00Z",
      deliveryId: "delivery-merge-1",
      source: "dependabot",
      signalsJson: '["title","sender"]',
      packageName: "lodash",
      oldVersion: "4.17.21",
      newVersion: "4.17.22",
      semverBumpType: "patch",
      mergeConfidenceLevel: "high",
      mergeConfidenceRationaleJson: '["title-match"]',
      advisoryStatus: "none",
      advisoryMaxSeverity: "unknown",
      isSecurityBump: false,
    });

    await store.recordDepBumpMergeHistory({
      repo: "owner/repo",
      prNumber: 123,
      source: "dependabot",
      packageName: "lodash",
    });

    const [countRow] = await sql`
      SELECT COUNT(*) AS count FROM dep_bump_merge_history WHERE repo = ${"owner/repo"} AND pr_number = ${123}
    `;
    const [row] = await sql`
      SELECT repo, pr_number, source, package_name, semver_bump_type
      FROM dep_bump_merge_history WHERE repo = ${"owner/repo"} AND pr_number = ${123}
    `;

    expect(Number(countRow.count)).toBe(1);
    expect(row.repo).toBe("owner/repo");
    expect(row.pr_number).toBe(123);
    expect(row.source).toBe("dependabot");
    expect(row.package_name).toBe("lodash");
    expect(row.semver_bump_type).toBe("patch");
  });

  test("getRepoStats returns aggregate totals and top files", async () => {
    const reviewId = await store.recordReview({
      repo: "owner/repo",
      prNumber: 1,
      filesAnalyzed: 3,
      linesChanged: 50,
      findingsCritical: 1,
      findingsMajor: 1,
      findingsMedium: 0,
      findingsMinor: 0,
      findingsTotal: 2,
      suppressionsApplied: 1,
      conclusion: "success",
    });

    await store.recordFindings([
      {
        reviewId,
        filePath: "src/a.ts",
        severity: "critical",
        category: "security",
        confidence: 99,
        title: "Critical issue",
        suppressed: false,
      },
      {
        reviewId,
        filePath: "src/a.ts",
        severity: "major",
        category: "correctness",
        confidence: 80,
        title: "Major issue",
        suppressed: true,
        suppressionPattern: "false positive",
      },
    ]);

    const stats = await store.getRepoStats("owner/repo");
    expect(stats.totalReviews).toBe(1);
    expect(stats.totalFindings).toBe(2);
    expect(stats.findingsBySeverity.critical).toBe(1);
    expect(stats.findingsBySeverity.major).toBe(1);
    expect(stats.totalSuppressed).toBe(1);
    expect(stats.avgFindingsPerReview).toBe(2);
    expect(stats.avgConfidence).toBe(89.5);
    expect(stats.topFiles[0]).toEqual({ path: "src/a.ts", findingCount: 2 });
  });

  test("getRepoTrends returns daily aggregate rows", async () => {
    const reviewId = await store.recordReview({
      repo: "owner/repo",
      prNumber: 3,
      filesAnalyzed: 2,
      linesChanged: 20,
      findingsCritical: 0,
      findingsMajor: 1,
      findingsMedium: 1,
      findingsMinor: 0,
      findingsTotal: 2,
      suppressionsApplied: 1,
      conclusion: "success",
    });

    await store.recordFindings([
      {
        reviewId,
        filePath: "src/trends.ts",
        severity: "major",
        category: "correctness",
        confidence: 70,
        title: "Issue A",
        suppressed: false,
      },
      {
        reviewId,
        filePath: "src/trends.ts",
        severity: "medium",
        category: "performance",
        confidence: 60,
        title: "Issue B",
        suppressed: true,
      },
    ]);

    const trends = await store.getRepoTrends("owner/repo", 30);
    expect(trends.length).toBeGreaterThan(0);
    expect(trends[0]?.reviewCount).toBe(1);
    expect(trends[0]?.findingsCount).toBe(2);
    expect(trends[0]?.suppressionsCount).toBe(1);
    expect(trends[0]?.avgConfidence).toBe(65);
  });

  test("empty repo returns zeroed stats and empty trends", async () => {
    const stats = await store.getRepoStats("unknown/repo");
    expect(stats.totalReviews).toBe(0);
    expect(stats.totalFindings).toBe(0);
    expect(stats.totalSuppressed).toBe(0);
    expect(stats.avgFindingsPerReview).toBe(0);
    expect(stats.avgConfidence).toBe(0);
    expect(stats.topFiles).toEqual([]);

    const trends = await store.getRepoTrends("unknown/repo", 30);
    expect(trends).toEqual([]);
  });

  test("enforces foreign key constraints", async () => {
    expect(
      store.recordFindings([
        {
          reviewId: 999_999,
          filePath: "src/nope.ts",
          severity: "minor",
          category: "style",
          confidence: 10,
          title: "Orphan finding",
          suppressed: false,
        },
      ]),
    ).rejects.toThrow();

    expect(
      store.recordFeedbackReactions([
        {
          repo: "owner/repo",
          reviewId: 999_998,
          findingId: 999_999,
          commentId: 1,
          commentSurface: "pull_request_review_comment",
          reactionId: 1,
          reactionContent: "+1",
          reactorLogin: "eve",
          severity: "minor",
          category: "style",
          filePath: "src/nope.ts",
          title: "Orphan reaction",
        },
      ]),
    ).rejects.toThrow();
  });

  describe("run state", () => {
    test("checkAndClaimRun returns new for first run", async () => {
      const result = await store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 10,
        baseSha: "base-aaa",
        headSha: "head-bbb",
        deliveryId: "delivery-1",
        action: "opened",
      });

      expect(result.shouldProcess).toBe(true);
      expect(result.reason).toBe("new");
      expect(result.runKey).toBe("owner/repo:pr-10:base-base-aaa:head-head-bbb");
      expect(result.supersededRunKeys).toEqual([]);
    });

    test("checkAndClaimRun returns duplicate for same SHA pair", async () => {
      const params = {
        repo: "owner/repo",
        prNumber: 11,
        baseSha: "base-111",
        headSha: "head-222",
        deliveryId: "delivery-first",
        action: "opened",
      };

      const first = await store.checkAndClaimRun(params);
      expect(first.shouldProcess).toBe(true);
      expect(first.reason).toBe("new");

      const second = await store.checkAndClaimRun({
        ...params,
        deliveryId: "delivery-second",
      });
      expect(second.shouldProcess).toBe(false);
      expect(second.reason).toBe("duplicate");
    });

    test("force push supersedes prior runs", async () => {
      const firstRun = await store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 12,
        baseSha: "base-aaa",
        headSha: "head-old",
        deliveryId: "delivery-a",
        action: "opened",
      });
      expect(firstRun.shouldProcess).toBe(true);
      expect(firstRun.reason).toBe("new");

      const secondRun = await store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 12,
        baseSha: "base-aaa",
        headSha: "head-new",
        deliveryId: "delivery-b",
        action: "opened",
      });
      expect(secondRun.shouldProcess).toBe(true);
      expect(secondRun.reason).toBe("superseded-prior");
      expect(secondRun.supersededRunKeys).toContain(firstRun.runKey);

      const [row] = await sql`SELECT status, superseded_by FROM run_state WHERE run_key = ${firstRun.runKey}`;
      expect(row.status).toBe("superseded");
      expect(row.superseded_by).toBe(secondRun.runKey);
    });

    test("completeRun marks run as completed", async () => {
      const result = await store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 13,
        baseSha: "base-ccc",
        headSha: "head-ddd",
        deliveryId: "delivery-c",
        action: "opened",
      });
      expect(result.shouldProcess).toBe(true);

      await store.completeRun(result.runKey);

      const [row] = await sql`SELECT status, completed_at FROM run_state WHERE run_key = ${result.runKey}`;
      expect(row.status).toBe("completed");
      expect(row.completed_at).toBeTruthy();
    });

    test("purgeOldRuns removes old completed runs", async () => {
      const result = await store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 14,
        baseSha: "base-eee",
        headSha: "head-fff",
        deliveryId: "delivery-d",
        action: "opened",
      });
      await store.completeRun(result.runKey);

      // Manually backdate the run for purge testing
      await sql`
        UPDATE run_state SET created_at = now() - interval '60 days' WHERE run_key = ${result.runKey}
      `;

      const purged = await store.purgeOldRuns(30);
      expect(purged).toBeGreaterThanOrEqual(1);

      const rows = await sql`SELECT * FROM run_state WHERE run_key = ${result.runKey}`;
      expect(rows.length).toBe(0);
    });

    test("different delivery IDs for same SHA pair are still duplicates", async () => {
      const first = await store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 15,
        baseSha: "base-ggg",
        headSha: "head-hhh",
        deliveryId: "delivery-x",
        action: "opened",
      });
      expect(first.shouldProcess).toBe(true);

      const second = await store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 15,
        baseSha: "base-ggg",
        headSha: "head-hhh",
        deliveryId: "delivery-y",
        action: "opened",
      });
      expect(second.shouldProcess).toBe(false);
      expect(second.reason).toBe("duplicate");
      expect(second.runKey).toBe(first.runKey);
    });
  });

  describe("incremental re-review queries", () => {
    test("getLastReviewedHeadSha returns null when no completed review exists", async () => {
      expect(await store.getLastReviewedHeadSha({ repo: "owner/repo", prNumber: 99 })).toBeNull();

      await store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 99,
        baseSha: "base-aaa",
        headSha: "head-pending",
        deliveryId: "delivery-pending",
        action: "opened",
      });
      expect(await store.getLastReviewedHeadSha({ repo: "owner/repo", prNumber: 99 })).toBeNull();
    });

    test("getLastReviewedHeadSha returns head_sha of most recent completed review", async () => {
      const first = await store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 100,
        baseSha: "base-aaa",
        headSha: "head-first",
        deliveryId: "delivery-first",
        action: "opened",
      });
      await store.completeRun(first.runKey);

      expect(await store.getLastReviewedHeadSha({ repo: "owner/repo", prNumber: 100 })).toBe("head-first");

      const second = await store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 100,
        baseSha: "base-aaa",
        headSha: "head-second",
        deliveryId: "delivery-second",
        action: "synchronize",
      });
      await store.completeRun(second.runKey);

      expect(await store.getLastReviewedHeadSha({ repo: "owner/repo", prNumber: 100 })).toBe("head-second");
    });

    test("getPriorReviewFindings returns unsuppressed findings from latest completed review", async () => {
      const run = await store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 200,
        baseSha: "base-aaa",
        headSha: "head-review-1",
        deliveryId: "delivery-review-1",
        action: "opened",
      });
      await store.completeRun(run.runKey);

      const reviewId = await store.recordReview({
        repo: "owner/repo",
        prNumber: 200,
        headSha: "head-review-1",
        deliveryId: "delivery-review-1",
        filesAnalyzed: 3,
        linesChanged: 50,
        findingsCritical: 0,
        findingsMajor: 1,
        findingsMedium: 1,
        findingsMinor: 0,
        findingsTotal: 2,
        suppressionsApplied: 1,
        conclusion: "success",
      });

      await store.recordFindings([
        {
          reviewId,
          filePath: "src/api/routes.ts",
          startLine: 10,
          endLine: 15,
          severity: "major",
          category: "security",
          confidence: 90,
          title: "Missing auth check",
          suppressed: false,
          commentId: 555,
        },
        {
          reviewId,
          filePath: "src/api/utils.ts",
          startLine: 20,
          severity: "medium",
          category: "correctness",
          confidence: 70,
          title: "Potential null dereference",
          suppressed: false,
        },
        {
          reviewId,
          filePath: "src/api/routes.ts",
          startLine: 30,
          severity: "minor",
          category: "style",
          confidence: 50,
          title: "Use const instead of let",
          suppressed: true,
          suppressionPattern: "style:let-vs-const",
        },
      ]);

      const findings = await store.getPriorReviewFindings({ repo: "owner/repo", prNumber: 200 });
      expect(findings).toHaveLength(2);

      expect(findings[0]?.filePath).toBe("src/api/routes.ts");
      expect(findings[0]?.title).toBe("Missing auth check");
      expect(findings[0]?.severity).toBe("major");
      expect(findings[0]?.category).toBe("security");
      expect(findings[0]?.startLine).toBe(10);
      expect(findings[0]?.endLine).toBe(15);
      expect(findings[0]?.commentId).toBe(555);
      expect(findings[0]?.titleFingerprint).toBeTruthy();
      expect(typeof findings[0]?.titleFingerprint).toBe("string");

      expect(findings[1]?.filePath).toBe("src/api/utils.ts");
      expect(findings[1]?.title).toBe("Potential null dereference");
      expect(findings[1]?.startLine).toBe(20);
      expect(findings[1]?.endLine).toBeNull();
      expect(findings[1]?.commentId).toBeNull();
    });

    test("getPriorReviewFindings returns empty array when no completed review exists", async () => {
      const findings = await store.getPriorReviewFindings({ repo: "owner/repo", prNumber: 999 });
      expect(findings).toEqual([]);
    });
  });
});
