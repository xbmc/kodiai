/**
 * Type definitions for the wiki update publisher pipeline.
 *
 * Consumed by wiki-publisher.ts (Phase 124) and
 * scripts/publish-wiki-updates.ts (CLI entry point).
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { GitHubApp } from "../auth/github-app.ts";

/** Options for creating a wiki publisher instance. */
export type WikiPublisherOptions = {
  sql: Sql;
  githubApp: GitHubApp;
  logger: Logger;
  /** Target repo owner (default: "xbmc"). */
  owner?: string;
  /** Target wiki repo name (default: "wiki"). */
  repo?: string;
  /** GitHub owner for PR link URLs (default: "xbmc"). */
  prOwner?: string;
  /** GitHub repo for PR link URLs (default: "xbmc"). */
  prRepo?: string;
  /** Minimum milliseconds between comment API calls (default: 3000). */
  commentDelayMs?: number;
};

/** Result from a publish run. */
export type PublishResult = {
  /** The issue number created (null if dry-run or pre-flight failure). */
  issueNumber: number | null;
  /** The issue URL (null if dry-run or pre-flight failure). */
  issueUrl: string | null;
  /** Number of pages with comments posted. */
  pagesPosted: number;
  /** Number of pages skipped due to errors. */
  pagesSkipped: number;
  /** Total suggestions published across all pages. */
  suggestionsPublished: number;
  /** Page titles that were skipped with error reasons. */
  skippedPages: Array<{ pageTitle: string; reason: string }>;
  /** Formatted markdown output (populated in dry-run mode). */
  dryRunOutput?: string;
  /** Populated when retrofitPreview: true — per-page planned actions (no mutation). */
  retrofitPreviewResult?: RetrofitPreviewResult;
};

/** Options for a publish invocation. */
export type PublishRunOptions = {
  /** If true, format markdown but don't call GitHub API or update DB. */
  dryRun?: boolean;
  /** If provided, only publish suggestions for these page IDs. */
  pageIds?: number[];
  /** If true, skip suggestions with voice mismatch warnings. */
  groundedOnly?: boolean;
  /** If true, scan existing issue for wiki comments and report planned actions without mutating. */
  retrofitPreview?: boolean;
  /** Issue number to scan for retrofit-preview mode, OR an existing issue to target for live publish.
   *  When provided and `retrofitPreview` is false, the publisher skips `issues.create` and posts
   *  directly to this issue via `issues.get` + `upsertWikiPageComment`. */
  issueNumber?: number;
};

/** A page's grouped suggestions ready for comment formatting. */
export type PageSuggestionGroup = {
  pageId: number;
  pageTitle: string;
  suggestions: Array<{
    sectionHeading: string | null;
    suggestion: string;
    whySummary: string;
    citingPrs: Array<{ prNumber: number; prTitle: string }>;
    voiceMismatchWarning: boolean;
  }>;
};

/** Result of posting a single page comment. */
export type PagePostResult = {
  pageId: number;
  pageTitle: string;
  commentId: number | null;
  success: boolean;
  error?: string;
  suggestionsCount: number;
  prsCount: number;
  hasVoiceWarnings: boolean;
  /** Whether an existing comment was updated or a new one was created. */
  commentAction?: 'updated' | 'created';
};

/** Per-page planned action for retrofit-preview mode. */
export type RetrofitPageAction = {
  pageId: number;
  pageTitle: string;
  /** 'update' = existing marker comment found; 'create' = no existing comment; 'no-op' = already published. */
  action: 'update' | 'create' | 'no-op';
  existingCommentId: number | null;
};

/** Result of a retrofit-preview run (read-only scan of existing issue comments). */
export type RetrofitPreviewResult = {
  actions: RetrofitPageAction[];
  issueNumber: number;
};
