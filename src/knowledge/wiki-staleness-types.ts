import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { WikiPageStore } from "./wiki-types.ts";
import type { TaskRouter } from "../llm/task-router.ts";
import type { CostTracker } from "../llm/cost-tracker.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { SlackClient } from "../slack/client.ts";

/** A single wiki page candidate (grouped from wiki_pages chunks). */
export type WikiPageCandidate = {
  pageId: number;
  pageTitle: string;
  pageUrl: string;
  /** Representative chunk texts (up to 3, for LLM evaluation). */
  chunkTexts: string[];
  /** Heuristic score: count of path-token overlaps with changed files. */
  heuristicScore: number;
  /** Confidence tier from heuristic: "High" | "Medium" */
  heuristicTier: "High" | "Medium";
  /** The commit SHA(s) most recently associated with score contribution. */
  affectingCommitShas: string[];
  /** The changed file path(s) that contributed to the heuristic score. */
  affectingFilePaths: string[];
  /**
   * Unix timestamp (ms) of the most recent commit that contributed to this
   * candidate's score. Used as primary sort key for LLM evaluation ordering
   * when the 20-page cap applies (recency-first per locked decision).
   */
  sortableRecencyMs: number;
};

/** A confirmed stale page after LLM evaluation. */
export type StalePage = {
  pageId: number;
  pageTitle: string;
  pageUrl: string;
  /** Confidence tier (may be upgraded/downgraded by LLM). */
  confidence: "High" | "Medium" | "Low";
  /** One-line LLM-generated explanation of why the page is stale. */
  explanation: string;
  /** Commit SHA of most recent affecting commit. */
  commitSha: string;
  /** File path that most directly triggered staleness. */
  changedFilePath: string;
};

/** Result from a single staleness scan run. */
export type WikiStalenessScanResult = {
  pagesScanned: number;
  pagesFlagged: number;
  pagesEvaluated: number;
  stalePages: StalePage[];
  durationMs: number;
  skipped: boolean;
  skipReason?: string;
};

/** Run state record stored in wiki_staleness_run_state table. */
export type WikiStalenessRunState = {
  id?: number;
  lastRunAt: Date | null;
  lastCommitSha: string | null;
  pagesFlagged: number;
  pagesEvaluated: number;
  status: "success" | "failed" | "pending";
  errorMessage: string | null;
  updatedAt?: string;
};

/** Options for creating a wiki staleness detector. */
export type WikiStalenessDetectorOptions = {
  sql: Sql;
  wikiPageStore: WikiPageStore;
  githubApp: GitHubApp;
  slackClient: SlackClient;
  taskRouter: TaskRouter;
  costTracker?: CostTracker;
  logger: Logger;
  /** GitHub owner for commit scanning (e.g. "xbmc"). */
  githubOwner: string;
  /** GitHub repo for commit scanning (e.g. "xbmc"). */
  githubRepo: string;
  /** Slack channel ID to post reports to (e.g. "C12345"). */
  wikiChannelId: string;
  /** Days to look back for commits (default 30). Controls scan window cap. */
  stalenessThresholdDays: number;
  /** Interval override for testing (ms). Default: 7 days. */
  intervalMs?: number;
  /** Startup delay override for testing (ms). Default: 90s. */
  delayMs?: number;
};

/** Public interface returned by createWikiStalenessDetector. */
export type WikiStalenessScheduler = {
  start(): void;
  stop(): void;
  runScan(): Promise<WikiStalenessScanResult>;
};
