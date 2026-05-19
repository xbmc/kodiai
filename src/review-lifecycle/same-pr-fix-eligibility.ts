import { createHash } from "node:crypto";
import { buildPrDiffCommentabilityIndex, type PrDiffCommentabilityIndex } from "../execution/formatter-suggestions.ts";
import { scanOutgoingForSecrets } from "../lib/sanitizer.ts";
import type { FindingCategory, FindingSeverity } from "../lib/review-utils.ts";

export type SamePrFixEligibilityReasonCode =
  | "eligible"
  | "missing-replacement"
  | "unmappable-location"
  | "duplicate-fix"
  | "max-fixes-exceeded"
  | "secret-detected"
  | "reducer-denied"
  | "candidate-denied"
  | "formatter-owned"
  | "line-not-commentable";

export type SamePrFixCandidateInput = {
  filePath?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  title?: string | null;
  severity?: FindingSeverity | string | null;
  category?: FindingCategory | string | null;
  replacementText?: string | null;
  candidateApproved?: boolean | null;
  reducerApproved?: boolean | null;
  findingIdentity?: string | null;
  candidateFingerprint?: string | null;
  reducerFingerprint?: string | null;
  lifecycleId?: string | null;
  rawPrompt?: string | null;
  rawModelOutput?: string | null;
  rawCandidateBody?: string | null;
  rawToolPayload?: unknown;
  rawDiffText?: string | null;
};

export type SamePrFixOwnedRange = {
  path: string;
  startLine: number;
  endLine: number;
};

export type SamePrFixDraft = {
  identity: string;
  path: string;
  line: number;
  startLine?: number;
  side: "RIGHT";
  body: string;
  title: string;
  severity: FindingSeverity | string;
  category: FindingCategory | string;
  reason: "eligible";
};

export type SamePrFixEligibilityOutcome = {
  index: number;
  identity: string;
  reason: SamePrFixEligibilityReasonCode;
  path?: string;
  line?: number;
  startLine?: number;
};

export type SamePrFixEligibilitySummary = {
  schema: "same-pr-fix-eligibility.v1";
  reviewOutputKey?: string;
  deliveryId?: string;
  status: "eligible" | "empty" | "blocked" | "capped" | "mixed";
  counts: {
    input: number;
    eligible: number;
    blocked: number;
    omitted: number;
    capped: number;
  };
  reasonCounts: Partial<Record<SamePrFixEligibilityReasonCode, number>>;
  omittedReasonCounts: Partial<Record<SamePrFixEligibilityReasonCode, number>>;
  redaction: {
    privateOnly: true;
    rawPromptsIncluded: false;
    rawModelOutputIncluded: false;
    candidateBodiesIncluded: false;
    toolPayloadsIncluded: false;
    diffsIncluded: false;
    unboundedDiffsIncluded: false;
    secretDetected: boolean;
  };
};

export type SamePrFixEligibilityInput = {
  reviewOutputKey?: string | null;
  deliveryId?: string | null;
  prDiffText?: string | null;
  prDiffIndex?: PrDiffCommentabilityIndex | null;
  formatterOwnedRanges?: ReadonlyArray<SamePrFixOwnedRange | null | undefined> | null;
  maxSuggestions: number;
  seenIdentities?: Iterable<string> | null;
  candidates?: ReadonlyArray<SamePrFixCandidateInput | null | undefined> | null;
};

export type SamePrFixEligibilityResult = {
  drafts: SamePrFixDraft[];
  outcomes: SamePrFixEligibilityOutcome[];
  summary: SamePrFixEligibilitySummary;
};

const MAX_TITLE_LENGTH = 120;
const MAX_REPLACEMENT_CHARS = 8_000;
const MAX_CONTEXT_TOKEN_LENGTH = 40;
const REASON_CODES: readonly SamePrFixEligibilityReasonCode[] = [
  "eligible",
  "missing-replacement",
  "unmappable-location",
  "duplicate-fix",
  "max-fixes-exceeded",
  "secret-detected",
  "reducer-denied",
  "candidate-denied",
  "formatter-owned",
  "line-not-commentable",
];

export function reduceSamePrFixEligibility(input: SamePrFixEligibilityInput): SamePrFixEligibilityResult {
  const candidates = (Array.isArray(input.candidates) ? input.candidates : []).filter(
    (candidate): candidate is SamePrFixCandidateInput => Boolean(candidate),
  );
  const prDiffIndex = input.prDiffIndex ?? buildPrDiffCommentabilityIndex(input.prDiffText ?? "");
  const formatterOwnedRanges = normalizeOwnedRanges(input.formatterOwnedRanges);
  const seenIdentities = new Set(input.seenIdentities ?? []);
  const drafts: SamePrFixDraft[] = [];
  const outcomes: SamePrFixEligibilityOutcome[] = [];
  const reasonCounts: Partial<Record<SamePrFixEligibilityReasonCode, number>> = {};
  const omittedReasonCounts: Partial<Record<SamePrFixEligibilityReasonCode, number>> = {};
  const maxSuggestions = normalizeMaxSuggestions(input.maxSuggestions);
  let secretDetected = false;

  candidates.forEach((candidate, index) => {
    const normalized = normalizeCandidate(candidate, input, index);
    const identity = normalized.identity;
    const baseOutcome = {
      index,
      identity,
      ...(normalized.path ? { path: normalized.path } : {}),
      ...(normalized.startLine ? { startLine: normalized.startLine } : {}),
      ...(normalized.line ? { line: normalized.line } : {}),
    };

    const secretScan = normalized.replacementText ? scanOutgoingForSecrets(normalized.replacementText) : { blocked: false };
    if (secretScan.blocked) secretDetected = true;

    const reason = classifyCandidate({
      candidate,
      normalized,
      prDiffIndex,
      formatterOwnedRanges,
      seenIdentities,
      maxReached: drafts.length >= maxSuggestions,
      secretDetected: secretScan.blocked,
    });

    incrementReason(reasonCounts, reason);
    if (reason === "eligible") {
      seenIdentities.add(identity);
      const draft = toDraft(normalized);
      drafts.push(draft);
      outcomes.push({ ...baseOutcome, reason });
      return;
    }

    if (reason === "max-fixes-exceeded") {
      incrementReason(omittedReasonCounts, reason);
    }

    outcomes.push({ ...baseOutcome, reason });
  });

  const blocked = outcomes.filter((outcome) => outcome.reason !== "eligible" && outcome.reason !== "max-fixes-exceeded").length;
  const capped = reasonCounts["max-fixes-exceeded"] ?? 0;
  const omitted = capped;

  return {
    drafts,
    outcomes,
    summary: {
      schema: "same-pr-fix-eligibility.v1",
      ...optionalToken("reviewOutputKey", input.reviewOutputKey),
      ...optionalToken("deliveryId", input.deliveryId),
      status: summarizeStatus(candidates.length, drafts.length, blocked, capped),
      counts: {
        input: candidates.length,
        eligible: drafts.length,
        blocked,
        omitted,
        capped,
      },
      reasonCounts: orderReasonCounts(reasonCounts),
      omittedReasonCounts: orderReasonCounts(omittedReasonCounts),
      redaction: {
        privateOnly: true,
        rawPromptsIncluded: false,
        rawModelOutputIncluded: false,
        candidateBodiesIncluded: false,
        toolPayloadsIncluded: false,
        diffsIncluded: false,
        unboundedDiffsIncluded: false,
        secretDetected,
      },
    },
  };
}

function classifyCandidate(input: {
  candidate: SamePrFixCandidateInput;
  normalized: NormalizedSamePrFixCandidate;
  prDiffIndex: PrDiffCommentabilityIndex;
  formatterOwnedRanges: SamePrFixOwnedRange[];
  seenIdentities: Set<string>;
  maxReached: boolean;
  secretDetected: boolean;
}): SamePrFixEligibilityReasonCode {
  if (!input.normalized.replacementText) return "missing-replacement";
  if (!input.normalized.path || !input.normalized.startLine || !input.normalized.line) return "unmappable-location";
  if (input.secretDetected) return "secret-detected";
  if (input.candidate.reducerApproved === false) return "reducer-denied";
  if (input.candidate.candidateApproved === false) return "candidate-denied";
  if (isFormatterOwned(input.formatterOwnedRanges, input.normalized.path, input.normalized.startLine, input.normalized.line)) {
    return "formatter-owned";
  }
  if (!isCommentable(input.prDiffIndex, input.normalized.path, input.normalized.startLine, input.normalized.line)) {
    return "line-not-commentable";
  }
  if (input.seenIdentities.has(input.normalized.identity)) return "duplicate-fix";
  if (input.maxReached) return "max-fixes-exceeded";
  return "eligible";
}

type NormalizedSamePrFixCandidate = {
  identity: string;
  path: string;
  startLine: number;
  line: number;
  title: string;
  severity: FindingSeverity | string;
  category: FindingCategory | string;
  replacementText: string;
};

function normalizeCandidate(
  candidate: SamePrFixCandidateInput,
  input: SamePrFixEligibilityInput,
  index: number,
): NormalizedSamePrFixCandidate {
  const path = normalizePath(candidate.filePath);
  const startLine = normalizeLine(candidate.startLine);
  const endLine = normalizeLine(candidate.endLine) ?? startLine;
  const orderedStart = startLine && endLine ? Math.min(startLine, endLine) : (startLine ?? 0);
  const orderedEnd = startLine && endLine ? Math.max(startLine, endLine) : (endLine ?? 0);
  const replacementText = normalizeReplacement(candidate.replacementText);
  const title = normalizeTitle(candidate.title);
  const severity = normalizeContextToken(candidate.severity, "medium");
  const category = normalizeContextToken(candidate.category, "correctness");

  const identity = stableFixIdentity({
    reviewOutputKey: normalizeOptionalString(input.reviewOutputKey),
    deliveryId: normalizeOptionalString(input.deliveryId),
    findingIdentity: normalizeOptionalString(candidate.findingIdentity),
    candidateFingerprint: normalizeOptionalString(candidate.candidateFingerprint),
    reducerFingerprint: normalizeOptionalString(candidate.reducerFingerprint),
    lifecycleId: normalizeOptionalString(candidate.lifecycleId),
    index,
    path,
    startLine: orderedStart,
    endLine: orderedEnd,
    title,
    replacementText,
  });

  return {
    identity,
    path,
    startLine: orderedStart,
    line: orderedEnd,
    title,
    severity,
    category,
    replacementText,
  };
}

function toDraft(candidate: NormalizedSamePrFixCandidate): SamePrFixDraft {
  return {
    identity: candidate.identity,
    path: candidate.path,
    ...(candidate.startLine === candidate.line ? {} : { startLine: candidate.startLine }),
    line: candidate.line,
    side: "RIGHT",
    body: formatSuggestionBody(candidate),
    title: candidate.title,
    severity: candidate.severity,
    category: candidate.category,
    reason: "eligible",
  };
}

function formatSuggestionBody(candidate: NormalizedSamePrFixCandidate): string {
  return [
    `**Fix suggestion:** ${candidate.title}`,
    `Severity: ${candidate.severity} · Category: ${candidate.category}`,
    "",
    "```suggestion",
    candidate.replacementText,
    "```",
  ].join("\n");
}

function normalizePath(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().replace(/\\/g, "/").replace(/^b\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..") || /^[a-zA-Z]:\//.test(normalized)) {
    return "";
  }
  return normalized.slice(0, 512);
}

function normalizeLine(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return undefined;
  return Math.floor(value);
}

function normalizeReplacement(value: unknown): string {
  if (typeof value !== "string") return "";
  const stripped = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
  const bounded = stripped.length > MAX_REPLACEMENT_CHARS ? stripped.slice(0, MAX_REPLACEMENT_CHARS) : stripped;
  return bounded.trim().length > 0 ? bounded.replace(/\n+$/g, "") : "";
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== "string") return "Untitled fix";
  const normalized = value.trim().replace(/[\r\n|]+/g, " ").replace(/\s+/g, " ").slice(0, MAX_TITLE_LENGTH);
  return normalized || "Untitled fix";
}

function normalizeContextToken(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_CONTEXT_TOKEN_LENGTH);
  return normalized || fallback;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

function normalizeOwnedRanges(values: SamePrFixEligibilityInput["formatterOwnedRanges"]): SamePrFixOwnedRange[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((range) => {
    if (!range) return [];
    const path = normalizePath(range.path);
    const startLine = normalizeLine(range.startLine);
    const endLine = normalizeLine(range.endLine) ?? startLine;
    if (!path || !startLine || !endLine) return [];
    return [{ path, startLine: Math.min(startLine, endLine), endLine: Math.max(startLine, endLine) }];
  });
}

function isFormatterOwned(ranges: readonly SamePrFixOwnedRange[], path: string, startLine: number, endLine: number): boolean {
  return ranges.some((range) =>
    range.path === path
    && startLine <= range.endLine
    && endLine >= range.startLine
  );
}

function isCommentable(index: PrDiffCommentabilityIndex, path: string, startLine: number, endLine: number): boolean {
  const commentableLines = index.get(path);
  if (!commentableLines) return false;
  for (let line = startLine; line <= endLine; line += 1) {
    if (!commentableLines.has(line)) return false;
  }
  return true;
}

function stableFixIdentity(input: {
  reviewOutputKey?: string;
  deliveryId?: string;
  findingIdentity?: string;
  candidateFingerprint?: string;
  reducerFingerprint?: string;
  lifecycleId?: string;
  index: number;
  path: string;
  startLine: number;
  endLine: number;
  title: string;
  replacementText: string;
}): string {
  const explicitIdentity = input.findingIdentity ?? input.candidateFingerprint ?? input.reducerFingerprint ?? input.lifecycleId;
  const replacementHash = createHash("sha256").update(input.replacementText).digest("hex").slice(0, 16);
  const canonical = [
    input.reviewOutputKey ?? "",
    input.deliveryId ?? "",
    explicitIdentity ?? `index:${input.index}`,
    input.path,
    input.startLine || "",
    input.endLine || "",
    input.title.toLowerCase().replace(/\s+/g, " ").trim(),
    replacementHash,
  ].join("\u001f");
  return `sprf-${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`;
}

function normalizeMaxSuggestions(value: number): number {
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(value));
}

function incrementReason(
  counts: Partial<Record<SamePrFixEligibilityReasonCode, number>>,
  reason: SamePrFixEligibilityReasonCode,
): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function orderReasonCounts(
  counts: Partial<Record<SamePrFixEligibilityReasonCode, number>>,
): Partial<Record<SamePrFixEligibilityReasonCode, number>> {
  const ordered: Partial<Record<SamePrFixEligibilityReasonCode, number>> = {};
  for (const reason of REASON_CODES) {
    if (counts[reason]) ordered[reason] = counts[reason];
  }
  return ordered;
}

function summarizeStatus(
  inputCount: number,
  eligible: number,
  blocked: number,
  capped: number,
): SamePrFixEligibilitySummary["status"] {
  if (inputCount === 0) return "empty";
  if (capped > 0 && blocked === 0 && eligible > 0) return "capped";
  if (eligible > 0 && (blocked > 0 || capped > 0)) return "mixed";
  if (eligible > 0) return "eligible";
  if (capped > 0) return "capped";
  return "blocked";
}

function optionalToken<K extends "reviewOutputKey" | "deliveryId">(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  const normalized = normalizeOptionalString(value);
  return normalized ? { [key]: normalized } as Partial<Record<K, string>> : {};
}
