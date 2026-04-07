import type { Logger } from "pino";
import { sanitizeContent } from "../lib/sanitizer.ts";
import type { GeneratedRuleStore, GeneratedRuleRecord } from "./generated-rule-store.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum number of active rules injected into the review prompt. */
export const DEFAULT_ACTIVE_RULES_LIMIT = 10;

/** Absolute cap — prevents prompt overload regardless of caller config. */
const ABSOLUTE_ACTIVE_RULES_CAP = 20;

/**
 * Maximum characters allowed in a single sanitized rule text.
 * Rules exceeding this length are truncated before injection.
 */
export const MAX_RULE_TEXT_CHARS = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SanitizedActiveRule = {
  id: number;
  title: string;
  ruleText: string;
  signalScore: number;
  memberCount: number;
};

export type GetActiveRulesResult = {
  rules: SanitizedActiveRule[];
  /** How many active rules existed in the store before the limit was applied. */
  totalActive: number;
  /** How many rules were truncated due to MAX_RULE_TEXT_CHARS. */
  truncatedCount: number;
};

// ---------------------------------------------------------------------------
// Sanitization helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a single rule record for safe prompt injection:
 * - Runs full sanitizeContent pipeline (strips HTML comments, invisible chars,
 *   token redaction, etc.)
 * - Truncates ruleText to MAX_RULE_TEXT_CHARS with a visible marker
 *
 * Returns the sanitized record and whether truncation occurred.
 */
export function sanitizeRule(rule: GeneratedRuleRecord): {
  sanitized: SanitizedActiveRule;
  truncated: boolean;
} {
  const sanitizedTitle = sanitizeContent(rule.title).trim();
  const sanitizedText = sanitizeContent(rule.ruleText).trim();

  let truncated = false;
  let ruleText = sanitizedText;
  if (sanitizedText.length > MAX_RULE_TEXT_CHARS) {
    ruleText = sanitizedText.slice(0, MAX_RULE_TEXT_CHARS).trimEnd() + "…";
    truncated = true;
  }

  return {
    sanitized: {
      id: rule.id,
      title: sanitizedTitle,
      ruleText,
      signalScore: rule.signalScore,
      memberCount: rule.memberCount,
    },
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export type GetActiveRulesOptions = {
  store: GeneratedRuleStore;
  repo: string;
  logger: Logger;
  /** Max rules to inject (default: DEFAULT_ACTIVE_RULES_LIMIT; hard cap: ABSOLUTE_ACTIVE_RULES_CAP). */
  limit?: number;
};

/**
 * Fetch and sanitize active rules for a repo, ready for prompt injection.
 *
 * Observability:
 * - Logs injected rule count, truncation count, and whether rules were capped.
 * - Fail-open: if the store throws, logs a warn and returns an empty result so
 *   the review proceeds without generated rules rather than failing entirely.
 */
export async function getActiveRulesForPrompt(
  opts: GetActiveRulesOptions,
): Promise<GetActiveRulesResult> {
  const { store, repo, logger } = opts;
  const requestedLimit = opts.limit ?? DEFAULT_ACTIVE_RULES_LIMIT;
  const effectiveLimit = Math.min(requestedLimit, ABSOLUTE_ACTIVE_RULES_CAP);

  // Fetch one extra to detect whether results were capped without running COUNT.
  const fetchLimit = effectiveLimit + 1;

  let rawRules: GeneratedRuleRecord[];
  try {
    rawRules = await store.getActiveRulesForRepo(repo, fetchLimit);
  } catch (err) {
    logger.warn(
      { err, repo },
      "active-rules: failed to fetch active rules — proceeding without generated rules",
    );
    return { rules: [], totalActive: 0, truncatedCount: 0 };
  }

  const wasCapped = rawRules.length > effectiveLimit;
  // Exact when uncapped; lower bound when capped because we fetched one extra row.
  const totalActive = rawRules.length;
  const cappedRules = rawRules.slice(0, effectiveLimit);

  let truncatedCount = 0;
  const sanitizedRules: SanitizedActiveRule[] = [];

  for (const rule of cappedRules) {
    const { sanitized, truncated } = sanitizeRule(rule);
    if (truncated) truncatedCount++;
    sanitizedRules.push(sanitized);
  }

  logger.info(
    {
      repo,
      injectedCount: sanitizedRules.length,
      truncatedCount,
      wasCapped,
      effectiveLimit,
    },
    "active-rules: rules prepared for prompt injection",
  );

  return {
    rules: sanitizedRules,
    totalActive,
    truncatedCount,
  };
}

// ---------------------------------------------------------------------------
// Prompt section formatter
// ---------------------------------------------------------------------------

/**
 * Format sanitized active rules as a markdown section for the review prompt.
 * Returns empty string when no rules are provided.
 */
export function formatActiveRulesSection(rules: SanitizedActiveRule[]): string {
  if (rules.length === 0) return "";

  const lines: string[] = [
    "## Generated Review Rules",
    "",
    "The following rules were inferred from patterns in prior code reviews for this repository.",
    "Apply them with the same weight as the standard review guidelines above.",
    "Each rule has a signal score (0–1) reflecting how consistently the pattern appeared.",
    "",
  ];

  for (const rule of rules) {
    lines.push(`### ${rule.title} (signal: ${rule.signalScore.toFixed(2)})`);
    lines.push("");
    lines.push(rule.ruleText);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
