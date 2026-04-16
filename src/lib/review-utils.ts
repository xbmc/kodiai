/**
 * Pure utility functions extracted from src/handlers/review.ts.
 *
 * All functions here take explicit parameters and have no closure over
 * handler state. This is a light extraction per DECISIONS.md
 * ("M026: Light extraction only for review.ts/mention.ts").
 */

import {
  buildKeywordParsingSection,
  DEFAULT_EMPTY_INTENT,
  type ParsedPRIntent,
} from "../lib/pr-intent-parser.ts";
import type { ResolvedReviewProfile } from "../lib/auto-profile.ts";
import type { MergeConfidence } from "../lib/merge-confidence.ts";
import type { ContributorExperienceReviewDetailsProjection } from "../contributor/experience-contract.ts";
import { SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE } from "../execution/review-prompt.ts";
import type { ReviewPhaseName, ReviewPhaseStatus, ReviewPhaseTiming } from "../execution/types.ts";
import { buildStructuralImpactSection } from "./structural-impact-formatter.ts";
import { summarizeStructuralImpactDegradation } from "../structural-impact/degradation.ts";
import type { StructuralImpactPayload } from "../structural-impact/types.ts";
import type { ReviewBoundednessContract } from "./review-boundedness.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewArea = "security" | "correctness" | "performance" | "style" | "documentation";
export type FindingSeverity = "critical" | "major" | "medium" | "minor";
export type FindingCategory = "security" | "correctness" | "performance" | "style" | "documentation";
export type ConfidenceBand = "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SEARCH_RATE_LIMIT_ERROR_MARKERS = [
  "rate limit",
  "secondary rate limit",
  "abuse detection",
  "too many requests",
];
export const SEARCH_RATE_LIMIT_BACKOFF_MAX_MS = 1_500;
export const SEARCH_RATE_LIMIT_DISCLOSURE_LINE = `> ${SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE}`;

export const PROFILE_PRESETS: Record<string, {
  severityMinLevel: FindingSeverity;
  maxComments: number;
  ignoredAreas: ReviewArea[];
  focusAreas: ReviewArea[];
}> = {
  strict: {
    severityMinLevel: "minor",
    maxComments: 15,
    ignoredAreas: [],
    focusAreas: [],
  },
  balanced: {
    severityMinLevel: "medium",
    maxComments: 7,
    ignoredAreas: ["style"],
    focusAreas: [],
  },
  minimal: {
    severityMinLevel: "major",
    maxComments: 3,
    ignoredAreas: ["style", "documentation"],
    focusAreas: ["security", "correctness"],
  },
};

const REVIEW_DETAILS_PHASE_ORDER = [
  "queue wait",
  "workspace preparation",
  "retrieval/context assembly",
  "executor handoff",
  "remote runtime",
  "publication",
] as const satisfies ReadonlyArray<ReviewPhaseName>;

export type ReviewDetailsPhaseTimingSummary = {
  totalDurationMs?: number;
  phases?: ReadonlyArray<ReviewPhaseTiming> | null;
};

export type TimeoutReviewDetailsProgress = {
  analyzedFiles: number;
  totalFiles: number;
  findingCount: number;
  retryState: string;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function ensureSearchRateLimitDisclosureInSummary(summaryBody: string): string {
  if (summaryBody.includes(SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE)) {
    return summaryBody;
  }

  const closingTag = "</details>";
  const lastCloseIdx = summaryBody.lastIndexOf(closingTag);

  if (lastCloseIdx === -1) {
    return `${summaryBody}\n\n${SEARCH_RATE_LIMIT_DISCLOSURE_LINE}`;
  }

  const before = summaryBody.slice(0, lastCloseIdx).trimEnd();
  const after = summaryBody.slice(lastCloseIdx);
  return `${before}\n\n${SEARCH_RATE_LIMIT_DISCLOSURE_LINE}\n\n${after}`;
}

export function extractSearchErrorStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function extractSearchErrorText(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";

  const message = (err as { message?: unknown }).message;
  const responseData = (err as { response?: { data?: { message?: unknown } } }).response?.data;
  const responseMessage = responseData && typeof responseData === "object"
    ? (responseData as { message?: unknown }).message
    : undefined;

  const parts = [message, responseMessage]
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.toLowerCase());

  return parts.join(" ");
}

export function isSearchRateLimitError(err: unknown): boolean {
  const status = extractSearchErrorStatus(err);
  const text = extractSearchErrorText(err);
  return (status === 403 || status === 429)
    && SEARCH_RATE_LIMIT_ERROR_MARKERS.some((marker) => text.includes(marker));
}

export function resolveRateLimitBackoffMs(err: unknown): number {
  if (typeof err !== "object" || err === null) return 0;

  const headers = (err as { response?: { headers?: Record<string, unknown> } }).response?.headers;
  if (!headers) return 0;

  const retryAfterRaw = headers["retry-after"];
  if (typeof retryAfterRaw === "string") {
    const retryAfterSeconds = Number.parseInt(retryAfterRaw, 10);
    if (!Number.isNaN(retryAfterSeconds) && retryAfterSeconds >= 0) {
      return Math.min(retryAfterSeconds * 1000, SEARCH_RATE_LIMIT_BACKOFF_MAX_MS);
    }
  }

  const resetRaw = headers["x-ratelimit-reset"];
  if (typeof resetRaw === "string") {
    const resetSeconds = Number.parseInt(resetRaw, 10);
    if (!Number.isNaN(resetSeconds)) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const deltaMs = Math.max(0, (resetSeconds - nowSeconds) * 1000);
      return Math.min(deltaMs, SEARCH_RATE_LIMIT_BACKOFF_MAX_MS);
    }
  }

  return 250;
}

export function toConfidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 75) return "high";
  if (confidence >= 50) return "medium";
  return "low";
}

export function fingerprintFindingTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");

  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const unsigned = hash >>> 0;
  return `fp-${unsigned.toString(16).padStart(8, "0")}`;
}

export function buildReviewDetailsMarker(reviewOutputKey: string): string {
  return `<!-- kodiai:review-details:${reviewOutputKey} -->`;
}

export function parseSeverityCountsFromBody(body: string): {
  critical: number;
  major: number;
  medium: number;
  minor: number;
} {
  const countMatches = (tag: string) => {
    const regex = new RegExp(`\\[${tag}\\]`, 'gi');
    return (body.match(regex) || []).length;
  };
  return {
    critical: countMatches('CRITICAL'),
    major: countMatches('MAJOR'),
    medium: countMatches('MEDIUM'),
    minor: countMatches('MINOR'),
  };
}

function isFiniteNonNegativeDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isReviewDetailsPhaseName(value: unknown): value is ReviewPhaseName {
  return typeof value === "string"
    && (REVIEW_DETAILS_PHASE_ORDER as ReadonlyArray<string>).includes(value);
}

function isReviewDetailsPhaseStatus(value: unknown): value is ReviewPhaseStatus {
  return value === "completed" || value === "degraded" || value === "unavailable";
}

function formatReviewDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  if (durationMs < 10_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  if (durationMs < 60_000) {
    return `${Math.round(durationMs / 1000)}s`;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function normalizeReviewDetailsPhase(phase: unknown): ReviewPhaseTiming | null {
  if (typeof phase !== "object" || phase === null) {
    return null;
  }

  const candidate = phase as {
    name?: unknown;
    status?: unknown;
    durationMs?: unknown;
    detail?: unknown;
  };

  if (!isReviewDetailsPhaseName(candidate.name)) {
    return null;
  }

  if (!isReviewDetailsPhaseStatus(candidate.status)) {
    return {
      name: candidate.name,
      status: "unavailable",
      detail: "invalid phase timing data",
    };
  }

  const detail = typeof candidate.detail === "string" && candidate.detail.trim().length > 0
    ? candidate.detail.trim()
    : undefined;

  if (candidate.status === "unavailable") {
    return {
      name: candidate.name,
      status: "unavailable",
      ...(detail ? { detail } : {}),
    };
  }

  if (!isFiniteNonNegativeDuration(candidate.durationMs)) {
    return {
      name: candidate.name,
      status: "unavailable",
      detail: "invalid phase timing data",
    };
  }

  return {
    name: candidate.name,
    status: candidate.status,
    durationMs: candidate.durationMs,
    ...(detail ? { detail } : {}),
  };
}

function formatReviewDetailsPhaseLine(phase: ReviewPhaseTiming): string {
  if (phase.status === "unavailable") {
    return `  - ${phase.name}: unavailable${phase.detail ? ` (${phase.detail})` : ""}`;
  }

  const durationText = isFiniteNonNegativeDuration(phase.durationMs)
    ? formatReviewDuration(phase.durationMs)
    : "unavailable";

  if (phase.status === "degraded") {
    return `  - ${phase.name}: ${durationText}${phase.detail ? ` (degraded: ${phase.detail})` : " (degraded)"}`;
  }

  return `  - ${phase.name}: ${durationText}`;
}

function formatReviewDetailsPhaseTimingSummary(summary?: ReviewDetailsPhaseTimingSummary | null): string[] {
  if (!summary) {
    return [];
  }

  const phaseMap = new Map<ReviewPhaseName, ReviewPhaseTiming>();
  if (Array.isArray(summary.phases)) {
    for (const phase of summary.phases) {
      const normalized = normalizeReviewDetailsPhase(phase);
      if (normalized && !phaseMap.has(normalized.name)) {
        phaseMap.set(normalized.name, normalized);
      }
    }
  }

  const lines: string[] = [];
  if (isFiniteNonNegativeDuration(summary.totalDurationMs)) {
    lines.push(`- Total wall-clock: ${formatReviewDuration(summary.totalDurationMs)}`);
  }

  lines.push("- Phase timings:");

  for (const name of REVIEW_DETAILS_PHASE_ORDER) {
    const phase = phaseMap.get(name) ?? {
      name,
      status: "unavailable",
      detail: "phase timing unavailable",
    } satisfies ReviewPhaseTiming;
    lines.push(formatReviewDetailsPhaseLine(phase));
  }

  return lines;
}

export function formatReviewDetailsSummary(params: {
  reviewOutputKey: string;
  filesReviewed: number;
  linesAdded: number;
  linesRemoved: number;
  findingCounts: {
    critical: number;
    major: number;
    medium: number;
    minor: number;
  };
  largePRTriage?: {
    fullCount: number;
    abbreviatedCount: number;
    mentionOnlyFiles: Array<{ filePath: string; score: number }>;
    totalFiles: number;
  };
  reviewBoundedness?: ReviewBoundednessContract | null;
  feedbackSuppressionCount?: number;
  keywordParsing?: ParsedPRIntent;
  profileSelection: ResolvedReviewProfile;
  contributorExperience: ContributorExperienceReviewDetailsProjection;
  prioritization?: {
    findingsScored: number;
    topScore: number | null;
    thresholdScore: number | null;
  };
  usageLimit?: {
    utilization: number | undefined;
    rateLimitType: string | undefined;
    resetsAt: number | undefined;
  };
  tokenUsage?: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    costUsd: number | undefined;
  };
  structuralImpact?: StructuralImpactPayload | null;
  phaseTimingSummary?: ReviewDetailsPhaseTimingSummary | null;
  timeoutProgress?: TimeoutReviewDetailsProgress | null;
}): string {
  const {
    reviewOutputKey,
    filesReviewed,
    linesAdded,
    linesRemoved,
    findingCounts,
    largePRTriage,
    reviewBoundedness,
    feedbackSuppressionCount,
    keywordParsing,
    profileSelection,
    contributorExperience,
    prioritization,
    usageLimit,
    tokenUsage,
    structuralImpact,
    phaseTimingSummary,
    timeoutProgress,
  } = params;

  const formatProfileLine = (label: string, profile: ResolvedReviewProfile): string => {
    if (profile.source === "auto") {
      return `- ${label}: ${profile.selectedProfile} (auto, lines changed: ${profile.linesChanged})`;
    }

    if (profile.source === "manual") {
      return `- ${label}: ${profile.selectedProfile} (manual config)`;
    }

    return `- ${label}: ${profile.selectedProfile} (keyword override)`;
  };

  const profileLine = profileSelection.source === "auto"
    ? `- Profile: ${profileSelection.selectedProfile} (auto, lines changed: ${profileSelection.linesChanged})`
    : profileSelection.source === "manual"
      ? `- Profile: ${profileSelection.selectedProfile} (manual config)`
      : `- Profile: ${profileSelection.selectedProfile} (keyword override)`;
  const hasBoundedProfileDetails = Boolean(reviewBoundedness && reviewBoundedness.reasonCodes.length > 0);

  const sections = [
    "<details>",
    "<summary>Review Details</summary>",
    "",
    ...(timeoutProgress
      ? [
          `- Analyzed progress before timeout: ${timeoutProgress.analyzedFiles}/${timeoutProgress.totalFiles} changed files`,
          `- Findings captured before timeout: ${timeoutProgress.findingCount} total`,
          `- Retry state: ${timeoutProgress.retryState}`,
        ]
      : [
          `- Files reviewed: ${filesReviewed}`,
          `- Findings: ${findingCounts.critical} critical, ${findingCounts.major} major, ${findingCounts.medium} medium, ${findingCounts.minor} minor`,
        ]),
    `- Lines changed: +${linesAdded} -${linesRemoved}`,
    ...(hasBoundedProfileDetails && reviewBoundedness
      ? [
          formatProfileLine("Requested profile", reviewBoundedness.requestedProfile),
          `- Effective profile: ${reviewBoundedness.effectiveProfile.selectedProfile}`,
          ...(reviewBoundedness.largePR
            ? [
                `- Bounded review: covered ${reviewBoundedness.largePR.reviewedCount}/${reviewBoundedness.largePR.totalFiles} changed files via large-PR triage (${reviewBoundedness.largePR.fullCount} full, ${reviewBoundedness.largePR.abbreviatedCount} abbreviated; ${reviewBoundedness.largePR.notReviewedCount} not reviewed)`,
              ]
            : []),
          ...(reviewBoundedness.timeout?.reductionApplied
            ? ["- Timeout auto-reduction: applied"]
            : reviewBoundedness.timeout?.reductionSkippedReason === "explicit-profile"
              ? ["- Timeout auto-reduction: skipped (explicit profile)"]
              : reviewBoundedness.timeout?.reductionSkippedReason === "config-disabled"
                ? ["- Timeout auto-reduction: skipped (config disabled)"]
                : []),
        ]
      : [profileLine]),
    `- Contributor experience: ${contributorExperience.text}`,
    `- Review completed: ${new Date().toISOString()}`,
  ];

  if (phaseTimingSummary) {
    try {
      const phaseTimingLines = formatReviewDetailsPhaseTimingSummary(phaseTimingSummary);
      if (phaseTimingLines.length > 0) {
        sections.push("", ...phaseTimingLines);
      }
    } catch {
      // Keep Review Details publication fail-open if timing formatting regresses.
    }
  }

  if (usageLimit?.utilization !== undefined) {
    const pct = Math.round(usageLimit.utilization * 100);
    const pctLeft = 100 - pct;
    const type = usageLimit.rateLimitType ?? 'usage';
    const resetStr = usageLimit.resetsAt !== undefined
      ? ` | resets ${new Date(usageLimit.resetsAt * 1000).toISOString()}`
      : '';
    sections.push(`- Claude Code usage: ${pctLeft}% of ${type} limit remaining${resetStr}`);
  }

  if (tokenUsage?.inputTokens !== undefined || tokenUsage?.outputTokens !== undefined) {
    const inp = tokenUsage?.inputTokens ?? 0;
    const out = tokenUsage?.outputTokens ?? 0;
    const costStr = tokenUsage?.costUsd !== undefined ? ` | ${tokenUsage.costUsd.toFixed(4)}` : '';
    sections.push(`- Tokens: ${inp.toLocaleString()} in / ${out.toLocaleString()} out${costStr}`);
  }

  if (largePRTriage) {
    const reviewedCount = largePRTriage.fullCount + largePRTriage.abbreviatedCount;
    const notReviewedCount = largePRTriage.totalFiles - reviewedCount;

    sections.push(
      "",
      `- Review scope: Reviewed ${reviewedCount}/${largePRTriage.totalFiles} files, prioritized by risk`,
      `- Full review: ${largePRTriage.fullCount} files | Abbreviated review: ${largePRTriage.abbreviatedCount} files | Not reviewed: ${notReviewedCount} files`,
    );

    if (largePRTriage.mentionOnlyFiles.length > 0) {
      const MAX_MENTION_ONLY_ENTRIES = 100;
      const cappedFiles = largePRTriage.mentionOnlyFiles.slice(0, MAX_MENTION_ONLY_ENTRIES);
      const remaining = largePRTriage.mentionOnlyFiles.length - cappedFiles.length;

      sections.push(
        "",
        "<details>",
        "<summary>Files not fully reviewed (sorted by risk score)</summary>",
        "",
      );

      for (const file of cappedFiles) {
        sections.push(`- ${file.filePath} (risk: ${file.score})`);
      }

      if (remaining > 0) {
        sections.push(`- ...and ${remaining} more files`);
      }

      sections.push("", "</details>");
    }
  }

  if (feedbackSuppressionCount && feedbackSuppressionCount > 0) {
    sections.push(`- ${feedbackSuppressionCount} pattern${feedbackSuppressionCount === 1 ? '' : 's'} auto-suppressed by feedback`);
  }

  if (prioritization) {
    sections.push(
      `- Prioritization: scored ${prioritization.findingsScored} findings | top score ${prioritization.topScore ?? "n/a"} | threshold score ${prioritization.thresholdScore ?? "n/a"}`,
    );
  }

  const structuralImpactSection = buildStructuralImpactSection(structuralImpact);
  if (structuralImpactSection.text) {
    const structuralImpactDegradation = summarizeStructuralImpactDegradation(structuralImpact);
    sections.push(structuralImpactSection.text);
    sections.push(
      `- Structural Impact rendered: callers ${structuralImpactSection.stats.callersRendered}/${structuralImpactSection.stats.callersTotal}${structuralImpactSection.stats.callersTruncated ? " truncated" : ""}; files ${structuralImpactSection.stats.filesRendered}/${structuralImpactSection.stats.filesTotal}${structuralImpactSection.stats.filesTruncated ? " truncated" : ""}; tests ${structuralImpactSection.stats.testsRendered}/${structuralImpactSection.stats.testsTotal}${structuralImpactSection.stats.testsTruncated ? " truncated" : ""}; unchanged evidence ${structuralImpactSection.stats.evidenceRendered}/${structuralImpactSection.stats.evidenceTotal}${structuralImpactSection.stats.evidenceTruncated ? " truncated" : ""}`,
    );
    if (structuralImpactDegradation.fallbackUsed) {
      sections.push(
        `- Structural Impact degradation: status ${structuralImpactDegradation.status}; graph ${structuralImpactDegradation.availability.graphAvailable ? "available" : "unavailable"}; corpus ${structuralImpactDegradation.availability.corpusAvailable ? "available" : "unavailable"}; signals ${structuralImpactDegradation.truthfulnessSignals.join(", ")}`,
      );
    }
  }

  const keywordSection = buildKeywordParsingSection(
    keywordParsing ?? DEFAULT_EMPTY_INTENT,
  );
  sections.push(keywordSection);

  sections.push(
    "",
    "</details>",
    "",
    buildReviewDetailsMarker(reviewOutputKey),
  );

  return sections.join("\n");
}

export function normalizeSeverity(value: string | undefined): FindingSeverity | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "critical" || normalized === "major" || normalized === "medium" || normalized === "minor") {
    return normalized;
  }
  return null;
}

export function normalizeCategory(value: string | undefined): FindingCategory {
  if (!value) return "correctness";
  const normalized = value.trim().toLowerCase();
  if (normalized === "security") return "security";
  if (normalized === "correctness" || normalized === "error-handling") return "correctness";
  if (normalized === "performance" || normalized === "resource-management" || normalized === "concurrency") {
    return "performance";
  }
  if (normalized === "style") return "style";
  if (normalized === "documentation") return "documentation";
  return "correctness";
}

export function parseInlineCommentMetadata(body: string): {
  severity: FindingSeverity | null;
  category: FindingCategory;
  title: string;
} {
  const text = body.replace(/<!--\s*kodiai:review-output-key:[\s\S]*?-->/gi, "").trim();
  const yamlMatch = text.match(/^```yaml\s*([\s\S]*?)```/i);

  if (yamlMatch) {
    const metadataLines = (yamlMatch[1] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(":"));
    const metadata = new Map<string, string>();
    for (const line of metadataLines) {
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      metadata.set(key, value);
    }

    const titleSection = text.slice(yamlMatch[0].length).trim();
    const titleLine = titleSection
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "Untitled finding";
    const title = titleLine.replace(/^\*\*(.+)\*\*$/, "$1").trim();

    return {
      severity: normalizeSeverity(metadata.get("severity")),
      category: normalizeCategory(metadata.get("category")),
      title,
    };
  }

  const firstLine = text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  const severityPrefix = firstLine.match(/^\[(critical|major|medium|minor)\]\s*(.*)$/i);
  if (severityPrefix) {
    return {
      severity: normalizeSeverity(severityPrefix[1]),
      category: "correctness",
      title: (severityPrefix[2] || "Untitled finding").trim(),
    };
  }

  return {
    severity: null,
    category: "correctness",
    title: firstLine || "Untitled finding",
  };
}

/**
 * Normalize a user-authored skip pattern for backward compatibility.
 * - "docs/" -> "docs/**"   (directory shorthand)
 * - "*.md"  -> "**\/*.md"  (extension-only matches nested files)
 */
export function normalizeSkipPattern(pattern: string): string {
  const p = pattern.trim();
  if (p.endsWith("/")) return `${p}**`;
  if (p.startsWith("*.")) return `**/${p}`;
  return p;
}

export function renderApprovalConfidence(mc: MergeConfidence): string {
  const emoji = mc.level === "high" ? ":green_circle:" : mc.level === "medium" ? ":yellow_circle:" : ":red_circle:";
  const label = mc.level === "high" ? "High" : mc.level === "medium" ? "Review Recommended" : "Careful Review Required";
  return `${emoji} **Merge Confidence: ${label}** — ${mc.rationale[0] ?? ""}`;
}

export function splitGitLines(output: string): string[] {
  return output.trim().split("\n").filter(Boolean);
}

export function isReviewTriggerEnabled(
  action: string,
  triggers: {
    onOpened: boolean;
    onReadyForReview: boolean;
    onReviewRequested: boolean;
    onSynchronize?: boolean;
  },
): boolean {
  if (action === "opened") return triggers.onOpened;
  if (action === "ready_for_review") return triggers.onReadyForReview;
  if (action === "review_requested") return triggers.onReviewRequested;
  if (action === "synchronize") return triggers.onSynchronize ?? false;
  return false;
}

export function normalizeReviewerLogin(login: string): string {
  return login.trim().toLowerCase().replace(/\[bot\]$/i, "");
}

/**
 * Split a full unified diff (multi-file) into per-file segments.
 * Returns an array of `{ filename, patch }` objects for each file in the diff.
 */
export function splitDiffByFile(diffContent: string): Array<{ filename: string; patch: string }> {
  const DIFF_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
  const lines = diffContent.split("\n");
  const files: Array<{ filename: string; patch: string }> = [];
  let currentFilename: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headerMatch = DIFF_HEADER_RE.exec(line);
    if (headerMatch) {
      if (currentFilename !== null && currentLines.length > 0) {
        files.push({ filename: currentFilename, patch: currentLines.join("\n") });
      }
      currentFilename = headerMatch[2]!;
      currentLines = [];
    } else if (currentFilename !== null) {
      currentLines.push(line);
    }
  }
  if (currentFilename !== null && currentLines.length > 0) {
    files.push({ filename: currentFilename, patch: currentLines.join("\n") });
  }

  return files;
}
