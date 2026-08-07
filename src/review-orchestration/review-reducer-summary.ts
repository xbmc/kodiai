import type {
  RepoDoctrineReducerProjection,
  ReviewReducerCounts,
  ReviewReducerDetailsSummary,
  ReviewReducerStatus,
} from "./review-reducer-types.ts";

/**
 * Public-safe projection of a reducer run into a single bounded summary line.
 *
 * Separate from the reducer itself because it is pure presentation with one
 * hard requirement the reducer does not share: everything here ends up in a
 * PR-visible details block, so tokens are sanitized and the whole string is
 * length-bounded. Keeping it apart makes that redaction boundary obvious
 * rather than buried at the end of a 900-line module.
 */
const MAX_SUMMARY_LENGTH = 240;
const MAX_REASON_LENGTH = 64;

export function toReviewReducerDetailsSummary(resultLike: {
  status: ReviewReducerStatus;
  counts: ReviewReducerCounts;
  reason?: string;
  repoDoctrine?: Partial<RepoDoctrineReducerProjection> | null;
}): ReviewReducerDetailsSummary {
  const { counts } = resultLike;
  const reason = resultLike.status === "degraded"
    ? ` reason=${sanitizeSummaryToken(resultLike.reason ?? "unknown")}`
    : "";
  const repoDoctrine = normalizeRepoDoctrineReducerProjection(resultLike.repoDoctrine);

  return {
    label: "Review reducer",
    status: resultLike.status,
    text: boundSummary([
      `Review reducer: ${resultLike.status}`,
      `input=${formatCount(counts.input)}`,
      `kept=${formatCount(counts.kept)}`,
      `suppressed=${formatCount(counts.suppressed)}`,
      `rewritten=${formatCount(counts.rewritten)}`,
      `deprioritized=${formatCount(counts.deprioritized)}`,
      `lowConfidence=${formatCount(counts.lowConfidence)}`,
      `auditEvents=${formatCount(counts.auditEvents)}`,
      `severityDemoted=${formatCount(counts.severityDemoted)}`,
      `graphValidated=${formatCount(counts.graphValidated)}`,
      `graphUncertain=${formatCount(counts.graphUncertain)}${reason}`,
      `doctrine=${formatRepoDoctrineReducerProjection(repoDoctrine)}`,
    ].join(" ")),
  };
}


export function normalizeRepoDoctrineReducerProjection(input: Partial<RepoDoctrineReducerProjection> | null | undefined): RepoDoctrineReducerProjection {
  const status = input?.status === "applied" || input?.status === "degraded" || input?.status === "disabled" || input?.status === "skipped"
    ? input.status
    : "skipped";
  const reasonCodes = Array.isArray(input?.reasonCodes)
    ? input.reasonCodes.map((reason) => sanitizeSummaryToken(String(reason))).filter(Boolean).slice(0, 8)
    : [];
  if (reasonCodes.length === 0) reasonCodes.push(status === "applied" ? "none" : status);
  return {
    status,
    contractCount: normalizeReducerCount(input?.contractCount),
    matchedCount: normalizeReducerCount(input?.matchedCount),
    omittedCount: normalizeReducerCount(input?.omittedCount),
    reasonCodes,
  };
}

function normalizeReducerCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function formatRepoDoctrineReducerProjection(doctrine: RepoDoctrineReducerProjection): string {
  return `${doctrine.status}/${doctrine.contractCount}/${doctrine.matchedCount}/${doctrine.omittedCount} reasons=${doctrine.reasonCodes.slice(0, 4).join(",")}`;
}

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "0";
  }

  return Math.floor(value).toString();
}

export function sanitizeSummaryToken(value: string): string {
  const normalized = value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_REASON_LENGTH);

  return normalized || "unknown";
}

function boundSummary(value: string): string {
  return value.length <= MAX_SUMMARY_LENGTH ? value : `${value.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
}
