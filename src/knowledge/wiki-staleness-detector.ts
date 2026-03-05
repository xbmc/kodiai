/**
 * Wiki staleness detector: two-tier pipeline (heuristic + LLM) that identifies
 * wiki pages potentially outdated by recent code changes.
 *
 * Flow: GitHub merged PRs -> heuristic token-overlap scoring -> LLM evaluation (cap 20) -> Slack report.
 */

import type { Logger } from "pino";
import type { Octokit } from "@octokit/rest";
import type { Sql } from "../db/client.ts";
import { generateWithFallback } from "../llm/generate.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import type { SlackClient } from "../slack/client.ts";
import type {
  WikiStalenessDetectorOptions,
  WikiStalenessScheduler,
  WikiStalenessScanResult,
  WikiPageCandidate,
  StalePage,
  WikiStalenessRunState,
  MergedPR,
} from "./wiki-staleness-types.ts";
import { parseIssueReferences } from "../lib/issue-reference-parser.ts";

const DEFAULT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_STARTUP_DELAY_MS = 90_000; // 90 seconds
const LLM_CAP = 20; // max pages to LLM-evaluate per cycle
const MAX_SCAN_WINDOW_DAYS = 7; // cap on commit scan window regardless of threshold

// ── Run state persistence ────────────────────────────────────────────

async function loadRunState(sql: Sql): Promise<WikiStalenessRunState> {
  const rows = await sql`SELECT * FROM wiki_staleness_run_state WHERE id = 1`;
  if (rows.length === 0) {
    return {
      lastRunAt: null,
      lastCommitSha: null,
      lastMergedAt: null,
      pagesFlagged: 0,
      pagesEvaluated: 0,
      status: "pending",
      errorMessage: null,
    };
  }
  const row = rows[0]!;
  return {
    id: row.id as number,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at as string) : null,
    lastCommitSha: (row.last_commit_sha as string) ?? null,
    lastMergedAt: row.last_run_at ? new Date(row.last_run_at as string) : null,
    pagesFlagged: row.pages_flagged as number,
    pagesEvaluated: row.pages_evaluated as number,
    status: row.status as WikiStalenessRunState["status"],
    errorMessage: (row.error_message as string) ?? null,
    updatedAt: row.updated_at as string,
  };
}

async function saveRunState(sql: Sql, state: WikiStalenessRunState): Promise<void> {
  await sql`
    INSERT INTO wiki_staleness_run_state (id, last_run_at, last_commit_sha, pages_flagged, pages_evaluated, status, error_message, updated_at)
    VALUES (1, ${state.lastRunAt}, ${state.lastCommitSha}, ${state.pagesFlagged}, ${state.pagesEvaluated}, ${state.status}, ${state.errorMessage}, now())
    ON CONFLICT (id) DO UPDATE SET
      last_run_at = EXCLUDED.last_run_at,
      last_commit_sha = EXCLUDED.last_commit_sha,
      pages_flagged = EXCLUDED.pages_flagged,
      pages_evaluated = EXCLUDED.pages_evaluated,
      status = EXCLUDED.status,
      error_message = EXCLUDED.error_message,
      updated_at = now()
  `;
}

// ── Heuristic scoring ────────────────────────────────────────────────

/** Tokens too common in the Kodi domain to be meaningful for wiki<->code matching. */
export const DOMAIN_STOPWORDS = new Set([
  'player', 'video', 'audio', 'kodi', 'addon', 'addons',
  'plugin', 'core', 'utils', 'common', 'test', 'tests',
  'interface', 'service', 'manager', 'handler', 'factory',
  'component', 'module', 'helper', 'base', 'abstract',
]);

/** MediaWiki heading syntax: == Heading ==, === Subheading === */
const HEADING_REGEX = /^={2,4}\s*(.+?)\s*={2,4}$/gm;
const HEADING_WEIGHT = 3;

/**
 * Token overlap between wiki chunk text and changed file paths.
 * Filters domain stopwords and weights tokens found in MediaWiki headings 3x.
 * Exported for testing.
 */
export function heuristicScore(chunkTexts: string[], changedFilePaths: string[]): number {
  const regularTokens = new Set<string>();
  const headingTokens = new Set<string>();

  for (const text of chunkTexts) {
    // Extract heading tokens first
    for (const match of text.matchAll(HEADING_REGEX)) {
      const headingText = match[1]!;
      for (const t of headingText.toLowerCase().split(/\W+/)) {
        if (t.length > 3 && !DOMAIN_STOPWORDS.has(t)) headingTokens.add(t);
      }
    }

    // Extract regular (body) tokens, excluding heading lines
    const bodyText = text.replace(HEADING_REGEX, '');
    for (const t of bodyText.toLowerCase().split(/\W+/)) {
      if (t.length > 3 && !DOMAIN_STOPWORDS.has(t)) regularTokens.add(t);
    }
  }

  let score = 0;
  for (const filePath of changedFilePaths) {
    const pathTokens = filePath
      .toLowerCase()
      .split(/[/._-]+/)
      .filter((t) => t.length > 3 && !DOMAIN_STOPWORDS.has(t));
    for (const token of pathTokens) {
      if (headingTokens.has(token)) {
        score += HEADING_WEIGHT;
      } else if (regularTokens.has(token)) {
        score += 1;
      }
    }
  }
  return score;
}

// ── PR fetching & evidence storage ───────────────────────────────────

const MAX_PR_PAGES = 10;

/**
 * Fetch merged PRs from GitHub with file details (including patch hunks).
 * Paginates pulls.list (state:closed) filtered by merged_at >= since.
 * Enriches each PR with file details via pulls.listFiles.
 */
async function fetchMergedPRs(
  octokit: Octokit,
  owner: string,
  repo: string,
  since: Date,
  logger: Logger,
): Promise<MergedPR[]> {
  const merged: MergedPR[] = [];

  for (let page = 1; page <= MAX_PR_PAGES; page++) {
    let prs;
    try {
      const response = await octokit.rest.pulls.list({
        owner,
        repo,
        state: "closed",
        sort: "updated",
        direction: "desc",
        per_page: 100,
        page,
      });
      prs = response.data;
    } catch (err) {
      logger.error({ err, owner, repo, page }, "Failed to list PRs for staleness scan");
      break;
    }

    if (prs.length === 0) break;

    // Filter to merged PRs within the since window
    const relevantPRs = prs.filter(
      (pr) => pr.merged_at && new Date(pr.merged_at) >= since,
    );

    for (const pr of relevantPRs) {
      try {
        const filesResponse = await octokit.rest.pulls.listFiles({
          owner,
          repo,
          pull_number: pr.number,
          per_page: 100,
        });

        merged.push({
          number: pr.number,
          title: pr.title,
          body: pr.body ?? null,
          author: pr.user?.login ?? "unknown",
          mergedAt: new Date(pr.merged_at!),
          files: filesResponse.data.map((f) => ({
            filename: f.filename,
            patch: f.patch,
            additions: f.additions,
            deletions: f.deletions,
          })),
        });
      } catch (err) {
        // Fail-open: skip PRs where file details can't be fetched
        logger.warn({ err, prNumber: pr.number }, "Failed to get PR file details (skipping)");
      }
    }

    // Stop pagination early when oldest PR on page has updated_at before since
    const oldestPR = prs[prs.length - 1];
    if (oldestPR && new Date(oldestPR.updated_at) < since) break;
  }

  logger.debug({ prCount: merged.length, since: since.toISOString() }, "Fetched merged PRs");
  return merged;
}

/**
 * Store PR evidence rows for wiki staleness grounding.
 * Uses ON CONFLICT upsert for idempotent inserts per (pr_number, file_path, matched_page_id).
 */
async function storePREvidence(
  sql: Sql,
  pr: MergedPR,
  matches: Array<{ filePath: string; patch: string; pageId: number | null; pageTitle: string | null; score: number }>,
  logger: Logger,
): Promise<void> {
  // Extract issue references from PR body
  const refs = parseIssueReferences({
    prBody: pr.body ?? "",
    commitMessages: [],
  });
  const issueRefsJson = JSON.stringify(
    refs.map((r) => ({
      issueNumber: r.issueNumber,
      keyword: r.keyword,
      crossRepo: r.crossRepo,
    })),
  );

  for (const match of matches) {
    try {
      await sql`
        INSERT INTO wiki_pr_evidence (
          pr_number, pr_title, pr_description, pr_author, merged_at,
          file_path, patch, issue_references,
          matched_page_id, matched_page_title, heuristic_score
        ) VALUES (
          ${pr.number}, ${pr.title}, ${pr.body}, ${pr.author}, ${pr.mergedAt},
          ${match.filePath}, ${match.patch}, ${issueRefsJson}::jsonb,
          ${match.pageId}, ${match.pageTitle}, ${match.score}
        )
        ON CONFLICT (pr_number, file_path, matched_page_id) DO UPDATE SET
          patch = EXCLUDED.patch,
          heuristic_score = EXCLUDED.heuristic_score,
          issue_references = EXCLUDED.issue_references
      `;
    } catch (err) {
      // Fail-open: log error but don't throw (non-critical storage)
      logger.error(
        { err, prNumber: pr.number, filePath: match.filePath, pageId: match.pageId },
        "Failed to store PR evidence row (non-fatal)",
      );
    }
  }
}

// ── Heuristic pass ───────────────────────────────────────────────────

async function heuristicPass(
  sql: Sql,
  mergedPRs: MergedPR[],
  logger: Logger,
): Promise<WikiPageCandidate[]> {
  // Fetch all active wiki page chunks (limit 5000 for reasonable memory usage)
  const rows = await sql`
    SELECT page_id, page_title, page_url, chunk_text, chunk_index
    FROM wiki_pages
    WHERE deleted = false AND stale = false
    ORDER BY page_id, chunk_index
    LIMIT 5000
  `;

  // Group chunks by page_id
  const pageMap = new Map<
    number,
    { pageTitle: string; pageUrl: string; chunkTexts: string[] }
  >();

  for (const row of rows) {
    const pageId = row.page_id as number;
    if (!pageMap.has(pageId)) {
      pageMap.set(pageId, {
        pageTitle: row.page_title as string,
        pageUrl: row.page_url as string,
        chunkTexts: [],
      });
    }
    const page = pageMap.get(pageId)!;
    if (page.chunkTexts.length < 3) {
      page.chunkTexts.push(row.chunk_text as string);
    }
  }

  // Build flat list of all changed file paths from merged PRs
  const allChangedFiles: string[] = [];
  for (const pr of mergedPRs) {
    for (const file of pr.files) {
      allChangedFiles.push(file.filename);
    }
  }

  // Build file->PRs mapping for tracking which PRs affect which pages
  const fileToPRs = new Map<string, number[]>();
  for (const pr of mergedPRs) {
    for (const file of pr.files) {
      const key = file.filename.toLowerCase();
      if (!fileToPRs.has(key)) fileToPRs.set(key, []);
      fileToPRs.get(key)!.push(pr.number);
    }
  }

  // Build PR mergedAt map for recency sorting
  const prDateMap = new Map<number, number>();
  for (const pr of mergedPRs) {
    prDateMap.set(pr.number, pr.mergedAt.getTime());
  }

  // Score each page
  const candidates: WikiPageCandidate[] = [];

  for (const [pageId, page] of pageMap) {
    const score = heuristicScore(page.chunkTexts, allChangedFiles);
    if (score === 0) continue;

    // Determine which files and PRs affected this page
    const affectingFilePaths: string[] = [];
    const affectingPRSet = new Set<number>();

    // Re-check which specific files had token overlap
    const chunkTokens = new Set<string>();
    for (const text of page.chunkTexts) {
      for (const t of text.toLowerCase().split(/\W+/)) {
        if (t.length > 3) chunkTokens.add(t);
      }
    }

    for (const filePath of allChangedFiles) {
      const pathTokens = filePath
        .toLowerCase()
        .split(/[/._-]+/)
        .filter((t) => t.length > 3);
      const hasOverlap = pathTokens.some((token) => chunkTokens.has(token));
      if (hasOverlap) {
        affectingFilePaths.push(filePath);
        const prNums = fileToPRs.get(filePath.toLowerCase());
        if (prNums) prNums.forEach((n) => affectingPRSet.add(n));
      }
    }

    const affectingPRNumbers = Array.from(affectingPRSet);
    const dedupedFilePaths = [...new Set(affectingFilePaths)];

    // sortableRecencyMs: max mergedAt timestamp among affecting PRs
    let sortableRecencyMs = 0;
    for (const prNum of affectingPRNumbers) {
      const dateMs = prDateMap.get(prNum);
      if (dateMs && dateMs > sortableRecencyMs) sortableRecencyMs = dateMs;
    }

    const heuristicTier: "High" | "Medium" = score >= 3 ? "High" : "Medium";

    candidates.push({
      pageId,
      pageTitle: page.pageTitle,
      pageUrl: page.pageUrl,
      chunkTexts: page.chunkTexts,
      heuristicScore: score,
      heuristicTier,
      affectingCommitShas: [], // no longer used but kept for backward compat
      affectingPRNumbers,
      affectingFilePaths: dedupedFilePaths,
      sortableRecencyMs,
    });

    // Store PR evidence for each matched PR+file+page combination
    for (const pr of mergedPRs) {
      const matches: Array<{ filePath: string; patch: string; pageId: number | null; pageTitle: string | null; score: number }> = [];
      for (const file of pr.files) {
        if (!file.patch) continue; // skip binary/too-large files
        if (!dedupedFilePaths.includes(file.filename)) continue;
        matches.push({
          filePath: file.filename,
          patch: file.patch,
          pageId,
          pageTitle: page.pageTitle,
          score,
        });
      }
      if (matches.length > 0) {
        await storePREvidence(sql, pr, matches, logger);
      }
    }
  }

  // Sort: PRIMARY by sortableRecencyMs DESC, SECONDARY by heuristicScore DESC
  candidates.sort((a, b) => {
    const recencyDiff = b.sortableRecencyMs - a.sortableRecencyMs;
    if (recencyDiff !== 0) return recencyDiff;
    return b.heuristicScore - a.heuristicScore;
  });

  logger.debug({ candidateCount: candidates.length, pageCount: pageMap.size }, "Heuristic pass complete");
  return candidates;
}

// ── LLM evaluation ──────────────────────────────────────────────────

async function evaluateWithLlm(
  candidate: WikiPageCandidate,
  opts: WikiStalenessDetectorOptions,
  logger: Logger,
): Promise<StalePage | null> {
  const resolved = opts.taskRouter.resolve(TASK_TYPES.STALENESS_EVIDENCE);

  const changedFilesList = candidate.affectingFilePaths.slice(0, 10).join("\n");
  const chunkContent = candidate.chunkTexts.join("\n\n---\n\n");

  // Fetch stored patch evidence for this page
  let patchContent = "";
  try {
    const evidenceRows = await opts.sql`
      SELECT patch, pr_title, pr_number
      FROM wiki_pr_evidence
      WHERE matched_page_id = ${candidate.pageId}
      ORDER BY merged_at DESC
      LIMIT 5
    `;
    const patches: string[] = [];
    let totalLen = 0;
    const PATCH_CAP = 3000;
    for (const row of evidenceRows) {
      const entry = `--- PR #${row.pr_number}: ${row.pr_title} ---\n${row.patch}`;
      if (totalLen + entry.length > PATCH_CAP) {
        // Add truncated portion if we have room
        const remaining = PATCH_CAP - totalLen;
        if (remaining > 100) patches.push(entry.slice(0, remaining) + "\n[truncated]");
        break;
      }
      patches.push(entry);
      totalLen += entry.length;
    }
    patchContent = patches.join("\n\n");
  } catch (err) {
    // Fail-open: proceed without patch content
    logger.warn({ err, pageId: candidate.pageId }, "Failed to fetch PR evidence patches (proceeding without)");
  }

  const patchSection = patchContent
    ? `\n\nRelevant code changes (diff patches from recent merged PRs):\n${patchContent}`
    : "";

  const prompt = `You are evaluating whether a wiki page is outdated due to recent merged PRs.

Wiki page: "${candidate.pageTitle}"
URL: ${candidate.pageUrl}

Wiki content (excerpts):
${chunkContent}

Recently changed code files (from merged PRs):
${changedFilesList}${patchSection}

Is this wiki page likely outdated due to these code changes?
- If YES: respond with "STALE: " followed by a single sentence explaining what specifically changed and why the wiki page needs updating (e.g., "STALE: The API endpoint was renamed from /users to /accounts but the wiki still references /users").
- If NO: respond with "CURRENT" (just that word).

Your confidence in this assessment based on file overlap: ${candidate.heuristicTier}.`;

  try {
    const result = await generateWithFallback({
      taskType: TASK_TYPES.STALENESS_EVIDENCE,
      resolved,
      prompt,
      logger,
      costTracker: opts.costTracker,
      repo: `${opts.githubOwner}/${opts.githubRepo}`,
    });

    const text = result.text.trim();

    if (text.toUpperCase().startsWith("CURRENT")) {
      return null; // Not stale
    }

    const explanation = text.startsWith("STALE: ") ? text.slice(7).trim() : text;
    const confidence: "High" | "Medium" | "Low" = candidate.heuristicTier;

    return {
      pageId: candidate.pageId,
      pageTitle: candidate.pageTitle,
      pageUrl: candidate.pageUrl,
      confidence,
      explanation,
      commitSha: candidate.affectingCommitShas[0] ?? "",
      prNumber: candidate.affectingPRNumbers[0] ?? null,
      changedFilePath: candidate.affectingFilePaths[0] ?? "",
    };
  } catch (err) {
    logger.warn({ err, pageTitle: candidate.pageTitle }, "LLM staleness evaluation failed for page (fail-open)");
    return null;
  }
}

// ── Slack report delivery ────────────────────────────────────────────

async function deliverStalenessReport(deliveryOpts: {
  slackClient: SlackClient;
  channelId: string;
  stalePages: StalePage[];
  scanDate: Date;
  logger: Logger;
}): Promise<void> {
  const { slackClient, channelId, stalePages, scanDate, logger } = deliveryOpts;
  const dateStr = scanDate.toISOString().split("T")[0];

  // Split: top 5 go inline in the summary body; remainder go to thread replies only.
  const TOP_N = 5;
  const topPages = stalePages.slice(0, TOP_N);
  const remainingPages = stalePages.slice(TOP_N);

  // Build summary message body with top 5 (or all pages when <= 5) listed inline.
  const pageLines = topPages
    .map((p) => `\u2022 [${p.confidence}] <${p.pageUrl}|${p.pageTitle}> \u2014 ${p.explanation}`)
    .join("\n");

  const trailingNote =
    remainingPages.length > 0
      ? `\n_${remainingPages.length} more flagged page${remainingPages.length === 1 ? "" : "s"} in thread replies._`
      : "";

  const summaryText =
    `*Wiki Staleness Report \u2014 ${stalePages.length} page${stalePages.length === 1 ? "" : "s"} may be outdated (${dateStr})*\n` +
    pageLines +
    trailingNote;

  // Post summary message and get ts for threading
  const { ts: summaryTs } = await slackClient.postStandaloneMessage({
    channel: channelId,
    text: summaryText,
  });

  // Post one thread reply per page beyond the top 5.
  for (const page of remainingPages) {
    const replyText = `[${page.confidence}] <${page.pageUrl}|${page.pageTitle}>\nChanged: \`${page.changedFilePath}\` (${page.commitSha.slice(0, 7)}) \u2014 ${page.explanation}`;
    try {
      await slackClient.postThreadMessage({
        channel: channelId,
        threadTs: summaryTs,
        text: replyText,
      });
    } catch (err) {
      logger.warn({ err, pageTitle: page.pageTitle }, "Failed to post thread reply for stale page (non-fatal)");
    }
  }

  logger.info(
    { staleCount: stalePages.length, topInSummary: topPages.length, inThreadReplies: remainingPages.length, channelId },
    "Wiki staleness report delivered to Slack",
  );
}

// ── Main factory ─────────────────────────────────────────────────────

export function createWikiStalenessDetector(
  opts: WikiStalenessDetectorOptions,
): WikiStalenessScheduler {
  const logger = opts.logger.child({ module: "wiki-staleness-detector" });

  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let startupHandle: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  async function runScan(): Promise<WikiStalenessScanResult> {
    const startTime = Date.now();

    // Guard: empty wiki store
    const pageCount = await opts.wikiPageStore.countBySource();
    if (pageCount === 0) {
      logger.info("Wiki staleness scan skipped: no wiki pages in store");
      return {
        pagesScanned: 0,
        pagesFlagged: 0,
        pagesEvaluated: 0,
        stalePages: [],
        durationMs: 0,
        skipped: true,
        skipReason: "empty_wiki_store",
      };
    }

    // Load run state
    const runState = await loadRunState(opts.sql);

    // Determine scan window: since last successful run (or MAX_SCAN_WINDOW_DAYS ago)
    const maxWindow = new Date(Date.now() - MAX_SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const since =
      runState.lastRunAt && runState.lastRunAt > maxWindow ? runState.lastRunAt : maxWindow;

    // Mark run as pending
    await saveRunState(opts.sql, { ...runState, status: "pending", errorMessage: null });

    try {
      // Get GitHub installation
      const installationContext = await opts.githubApp.getRepoInstallationContext(
        opts.githubOwner,
        opts.githubRepo,
      );
      if (!installationContext) {
        throw new Error(`GitHub app not installed for ${opts.githubOwner}/${opts.githubRepo}`);
      }
      const octokit = await opts.githubApp.getInstallationOctokit(
        installationContext.installationId,
      );

      // Fetch merged PRs
      const mergedPRs = await fetchMergedPRs(
        octokit,
        opts.githubOwner,
        opts.githubRepo,
        since,
        logger,
      );

      if (mergedPRs.length === 0) {
        logger.info({ since }, "Wiki staleness scan: no merged PRs found in window");
        await saveRunState(opts.sql, {
          ...runState,
          lastRunAt: new Date(),
          lastCommitSha: null,
          lastMergedAt: null,
          pagesFlagged: 0,
          pagesEvaluated: 0,
          status: "success",
          errorMessage: null,
        });
        return {
          pagesScanned: 0,
          pagesFlagged: 0,
          pagesEvaluated: 0,
          stalePages: [],
          durationMs: Date.now() - startTime,
          skipped: false,
        };
      }

      // Heuristic pass
      const candidates = await heuristicPass(opts.sql, mergedPRs, logger);
      const pagesFlagged = candidates.length;

      // Cap at LLM_CAP (20). Candidates already sorted by recency DESC primary,
      // heuristicScore DESC secondary.
      const toEvaluate = candidates.slice(0, LLM_CAP);

      // LLM evaluation
      const stalePages: StalePage[] = [];
      for (const candidate of toEvaluate) {
        const result = await evaluateWithLlm(candidate, opts, logger);
        if (result) stalePages.push(result);
      }

      // Determine newest merged_at timestamp for scan window anchor
      const newestMergedAt = mergedPRs.reduce<Date | null>(
        (max, pr) => (!max || pr.mergedAt > max ? pr.mergedAt : max),
        null,
      );

      await saveRunState(opts.sql, {
        lastRunAt: new Date(),
        lastCommitSha: null, // no longer used but column exists
        lastMergedAt: newestMergedAt,
        pagesFlagged,
        pagesEvaluated: toEvaluate.length,
        status: "success",
        errorMessage: null,
      });

      // Deliver report to Slack
      if (stalePages.length > 0 && opts.wikiChannelId) {
        await deliverStalenessReport({
          slackClient: opts.slackClient,
          channelId: opts.wikiChannelId,
          stalePages,
          scanDate: new Date(),
          logger,
        });
      }

      const durationMs = Date.now() - startTime;
      logger.info(
        { pagesFlagged, pagesEvaluated: toEvaluate.length, staleCount: stalePages.length, durationMs },
        "Wiki staleness scan complete",
      );

      return {
        pagesScanned: pageCount,
        pagesFlagged,
        pagesEvaluated: toEvaluate.length,
        stalePages,
        durationMs,
        skipped: false,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "Wiki staleness scan failed");
      await saveRunState(opts.sql, { ...runState, status: "failed", errorMessage });

      // Notify channel of failure
      if (opts.wikiChannelId) {
        try {
          await opts.slackClient.postStandaloneMessage({
            channel: opts.wikiChannelId,
            text: `Wiki Staleness Scanner failed to run: ${errorMessage.slice(0, 200)}`,
          });
        } catch (notifyErr) {
          logger.warn({ err: notifyErr }, "Failed to post staleness scan failure notification");
        }
      }
      throw err;
    }
  }

  async function doScan(): Promise<WikiStalenessScanResult> {
    if (running) {
      logger.debug("Wiki staleness scan already running, skipping");
      return {
        pagesScanned: 0,
        pagesFlagged: 0,
        pagesEvaluated: 0,
        stalePages: [],
        durationMs: 0,
        skipped: true,
        skipReason: "already_running",
      };
    }
    running = true;
    try {
      return await runScan();
    } finally {
      running = false;
    }
  }

  return {
    start() {
      const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
      const delayMs = opts.delayMs ?? DEFAULT_STARTUP_DELAY_MS;
      logger.info({ intervalMs, delayMs }, "Wiki staleness detector starting");
      startupHandle = setTimeout(() => {
        void doScan().catch((err) =>
          logger.error({ err }, "Initial wiki staleness scan failed"),
        );
        intervalHandle = setInterval(() => {
          void doScan().catch((err) =>
            logger.error({ err }, "Scheduled wiki staleness scan failed"),
          );
        }, intervalMs);
      }, delayMs);
    },
    stop() {
      if (startupHandle) {
        clearTimeout(startupHandle);
        startupHandle = null;
      }
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
      logger.info("Wiki staleness detector stopped");
    },
    runScan: doScan,
  };
}
