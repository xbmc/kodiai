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
};

/** Options for a publish invocation. */
export type PublishRunOptions = {
  /** If true, format markdown but don't call GitHub API or update DB. */
  dryRun?: boolean;
  /** If provided, only publish suggestions for these page IDs. */
  pageIds?: number[];
  /** If true, skip suggestions with voice mismatch warnings. */
  groundedOnly?: boolean;
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
};
