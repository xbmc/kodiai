/**
 * Wiki staleness detector: two-tier pipeline (heuristic + LLM) that identifies
 * wiki pages potentially outdated by recent code changes.
 *
 * Flow: GitHub commits -> heuristic token-overlap scoring -> LLM evaluation (cap 20) -> Slack report.
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
} from "./wiki-staleness-types.ts";

const DEFAULT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_STARTUP_DELAY_MS = 90_000; // 90 seconds
const LLM_CAP = 20; // max pages to LLM-evaluate per cycle
const MAX_SCAN_WINDOW_DAYS = 7; // cap on commit scan window regardless of threshold
const MAX_COMMITS = 200; // cap total commits fetched to prevent runaway API calls

// ── Run state persistence ────────────────────────────────────────────

async function loadRunState(sql: Sql): Promise<WikiStalenessRunState> {
  const rows = await sql`SELECT * FROM wiki_staleness_run_state WHERE id = 1`;
  if (rows.length === 0) {
    return {
      lastRunAt: null,
      lastCommitSha: null,
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

// ── GitHub commit fetching ───────────────────────────────────────────

type CommitWithFiles = { sha: string; files: string[]; date: Date };

async function fetchChangedFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  since: Date,
  logger: Logger,
): Promise<CommitWithFiles[]> {
  let commits: Array<{ sha: string; date: Date }>;
  try {
    const allCommits = await octokit.paginate(octokit.repos.listCommits, {
      owner,
      repo,
      since: since.toISOString(),
      per_page: 100,
    });

    // Cap at MAX_COMMITS
    commits = allCommits.slice(0, MAX_COMMITS).map((c) => ({
      sha: c.sha,
      date: c.commit.author?.date ? new Date(c.commit.author.date) : new Date(),
    }));
  } catch (err) {
    logger.error({ err, owner, repo }, "Failed to list commits for staleness scan");
    return [];
  }

  if (commits.length === 0) return [];

  logger.debug({ commitCount: commits.length, since: since.toISOString() }, "Fetching commit file details");

  const results: CommitWithFiles[] = [];
  for (const commit of commits) {
    try {
      const detail = await octokit.repos.getCommit({ owner, repo, ref: commit.sha });
      const files = (detail.data.files ?? []).map((f) => f.filename);
      results.push({ sha: commit.sha, files, date: commit.date });
    } catch (err) {
      // Fail-open: skip individual commits that can't be fetched
      logger.warn({ err, sha: commit.sha }, "Failed to get commit detail (skipping)");
    }
  }

  return results;
}

// ── Heuristic scoring ────────────────────────────────────────────────

/**
 * Token overlap between wiki chunk text and changed file paths.
 * Exported for testing.
 */
export function heuristicScore(chunkTexts: string[], changedFilePaths: string[]): number {
  const chunkTokens = new Set<string>();
  for (const text of chunkTexts) {
    for (const t of text.toLowerCase().split(/\W+/)) {
      if (t.length > 3) chunkTokens.add(t);
    }
  }

  let score = 0;
  for (const filePath of changedFilePaths) {
    const pathTokens = filePath
      .toLowerCase()
      .split(/[/._-]+/)
      .filter((t) => t.length > 3);
    for (const token of pathTokens) {
      if (chunkTokens.has(token)) score++;
    }
  }
  return score;
}

// ── Heuristic pass ───────────────────────────────────────────────────

async function heuristicPass(
  sql: Sql,
  changedCommits: CommitWithFiles[],
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

  // Build flat list of all changed file paths and sha->date map
  const allChangedFiles: string[] = [];
  const shaDateMap = new Map<string, number>();
  for (const commit of changedCommits) {
    const dateMs = commit.date.getTime();
    shaDateMap.set(commit.sha, dateMs);
    for (const file of commit.files) {
      allChangedFiles.push(file);
    }
  }

  // Build file->sha mapping for tracking which commits affect which pages
  const fileToShas = new Map<string, string[]>();
  for (const commit of changedCommits) {
    for (const file of commit.files) {
      const key = file.toLowerCase();
      if (!fileToShas.has(key)) fileToShas.set(key, []);
      fileToShas.get(key)!.push(commit.sha);
    }
  }

  // Score each page
  const candidates: WikiPageCandidate[] = [];

  for (const [pageId, page] of pageMap) {
    const score = heuristicScore(page.chunkTexts, allChangedFiles);
    if (score === 0) continue;

    // Determine which files and commits affected this page
    const affectingFilePaths: string[] = [];
    const affectingShaSet = new Set<string>();

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
        const shas = fileToShas.get(filePath.toLowerCase());
        if (shas) shas.forEach((sha) => affectingShaSet.add(sha));
      }
    }

    const affectingCommitShas = Array.from(affectingShaSet);

    // sortableRecencyMs: max commit timestamp among affecting commits
    let sortableRecencyMs = 0;
    for (const sha of affectingCommitShas) {
      const dateMs = shaDateMap.get(sha);
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
      affectingCommitShas,
      affectingFilePaths: [...new Set(affectingFilePaths)], // deduplicate
      sortableRecencyMs,
    });
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

  const prompt = `You are evaluating whether a wiki page is outdated due to recent code changes.

Wiki page: "${candidate.pageTitle}"
URL: ${candidate.pageUrl}

Wiki content (excerpts):
${chunkContent}

Recently changed code files:
${changedFilesList}

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

      // Fetch changed files from commits
      const changedCommits = await fetchChangedFiles(
        octokit,
        opts.githubOwner,
        opts.githubRepo,
        since,
        logger,
      );

      if (changedCommits.length === 0) {
        logger.info({ since }, "Wiki staleness scan: no commits found in window");
        await saveRunState(opts.sql, {
          ...runState,
          lastRunAt: new Date(),
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
      const candidates = await heuristicPass(opts.sql, changedCommits, logger);
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

      // Determine newest commit SHA for scan window anchor
      const newestCommitSha = changedCommits[0]?.sha ?? runState.lastCommitSha;

      await saveRunState(opts.sql, {
        lastRunAt: new Date(),
        lastCommitSha: newestCommitSha ?? null,
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
