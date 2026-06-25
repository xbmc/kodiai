import type { Logger } from "pino";
import { classifyError, formatErrorComment } from "../lib/errors.ts";
import { wrapInDetails } from "../lib/formatting.ts";
import type { AttachReviewFindingLifecycleResult } from "../review-lifecycle/handler-lifecycle.ts";

export type ExplicitMentionReviewPublishSkipReason =
  | "execution-not-success"
  | "output-already-published"
  | "result-text-findings"
  | "missing-inspection-evidence"
  | "missing-review-output-key"
  | "not-eligible";

export type ExplicitMentionReviewExecutionSnapshot = {
  conclusion: string;
  published: boolean;
  usedRepoInspectionTools?: boolean;
  resultText?: string;
  toolUseNames?: string[];
};

export type ExplicitMentionReviewPublishEvaluation = {
  eligible: boolean;
  skipReason?: ExplicitMentionReviewPublishSkipReason;
  findingLines: string[];
  hasUnpublishedFindings: boolean;
};

export function extractExplicitReviewResultFindingLines(resultText: string | undefined): string[] {
  if (!resultText) {
    return [];
  }

  const findings: string[] = [];
  const numberedFindings: Array<{
    index: number;
    path: string;
    lineNo: string;
    title: string;
  }> = [];
  const numberedSeverityByIndex = new Map<number, string>();
  let currentFilePath: string | null = null;
  let currentSeveritySection: string | null = null;
  const headingPattern = /^#{1,6}\s*\d+\.\s*\*\*\[(CRITICAL|MAJOR|MEDIUM|MINOR)\]\s+(.+?)\s+-\s+(.+?)\*\*\s*$/i;
  const inlinePattern = /^\[(CRITICAL|MAJOR|MEDIUM|MINOR)\]\s+(.+?)\s+\((\d+(?:-\d+)?)\):\s+(.+)$/i;
  const numberedPattern = /^(\d+)\.\s+\*\*(.+?):(\d+(?:-\d+)?)\*\*\s+-\s+(.+)$/;
  const severitySummaryPattern = /^-\s+\*\*\d+\s+(CRITICAL|MAJOR|MEDIUM|MINOR)\s+issues?\*\*:\s+(.+)$/i;
  const severitySectionPattern = /^#{1,6}\s+(CRITICAL|MAJOR|MEDIUM|MINOR)\s+issues\b[:\s]*$/i;
  const sectionedBoldFindingPattern = /^\*\*(\d+)\.\s+(?:\[(CRITICAL|MAJOR|MEDIUM|MINOR)\]\s+)?(.+?)\*\*\s+\((.+?):(\d+(?:-\d+)?)\)$/i;
  const fileHeaderPattern = /^###\s+(.+)$/;
  const fileScopedLinePattern = /^(\d+)\.\s+\*\*Line\s+(\d+(?:-\d+)?)\s+\[(CRITICAL|MAJOR|MEDIUM|MINOR)\]\*\*:\s+(.+)$/i;

  for (const rawLine of resultText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const severitySectionMatch = line.match(severitySectionPattern);
    if (severitySectionMatch) {
      currentSeveritySection = severitySectionMatch[1]?.toLowerCase() ?? null;
      currentFilePath = null;
      continue;
    }

    const headingMatch = line.match(headingPattern);
    if (headingMatch) {
      const severity = headingMatch[1];
      const location = headingMatch[2];
      const title = headingMatch[3];
      if (!severity || !location || !title) {
        continue;
      }
      const locationMatch = location.trim().match(/^(.*?):(\d+(?:-\d+)?)$/);
      const path = locationMatch?.[1]?.trim() || location.trim();
      const lineNo = locationMatch?.[2]?.trim() || "0";
      findings.push(`- (${findings.length + 1}) [${severity.toLowerCase()}] ${path} (${lineNo}): ${title.trim()}`);
      continue;
    }

    const inlineMatch = line.match(inlinePattern);
    if (inlineMatch) {
      const severity = inlineMatch[1];
      const path = inlineMatch[2];
      const lineNo = inlineMatch[3];
      const title = inlineMatch[4];
      if (!severity || !path || !lineNo || !title) {
        continue;
      }
      findings.push(`- (${findings.length + 1}) [${severity.toLowerCase()}] ${path.trim()} (${lineNo.trim()}): ${title.trim()}`);
      continue;
    }

    const sectionedBoldFindingMatch = line.match(sectionedBoldFindingPattern);
    if (sectionedBoldFindingMatch) {
      const severity = (sectionedBoldFindingMatch[2] ?? currentSeveritySection)?.toLowerCase();
      const title = sectionedBoldFindingMatch[3]?.trim();
      const path = sectionedBoldFindingMatch[4]?.trim();
      const lineNo = sectionedBoldFindingMatch[5]?.trim();
      if (!severity || !title || !path || !lineNo) {
        continue;
      }
      findings.push(`- (${findings.length + 1}) [${severity}] ${path} (${lineNo}): ${title}`);
      continue;
    }

    const fileHeaderMatch = line.match(fileHeaderPattern);
    if (fileHeaderMatch) {
      const candidatePath = fileHeaderMatch[1]?.trim() ?? "";
      currentFilePath = candidatePath.includes("/") && candidatePath.includes(".")
        ? candidatePath
        : null;
      continue;
    }

    const fileScopedLineMatch = line.match(fileScopedLinePattern);
    if (fileScopedLineMatch && currentFilePath) {
      const lineNo = fileScopedLineMatch[2]?.trim();
      const severity = fileScopedLineMatch[3]?.toLowerCase();
      const title = fileScopedLineMatch[4]?.trim();
      if (!lineNo || !severity || !title) {
        continue;
      }
      findings.push(`- (${findings.length + 1}) [${severity}] ${currentFilePath} (${lineNo}): ${title}`);
      continue;
    }

    const numberedMatch = line.match(numberedPattern);
    if (numberedMatch) {
      const findingIndex = Number.parseInt(numberedMatch[1] ?? "", 10);
      const path = numberedMatch[2]?.trim();
      const lineNo = numberedMatch[3]?.trim();
      const title = numberedMatch[4]?.trim();
      if (!Number.isInteger(findingIndex) || findingIndex < 1 || !path || !lineNo || !title) {
        continue;
      }
      numberedFindings.push({ index: findingIndex, path, lineNo, title });
      continue;
    }

    const severitySummaryMatch = line.match(severitySummaryPattern);
    if (severitySummaryMatch) {
      const severity = severitySummaryMatch[1]?.toLowerCase();
      const summary = severitySummaryMatch[2];
      if (!severity || !summary) {
        continue;
      }
      for (const match of summary.matchAll(/#(\d+)/g)) {
        const findingIndex = Number.parseInt(match[1] ?? "", 10);
        if (Number.isInteger(findingIndex) && findingIndex > 0) {
          numberedSeverityByIndex.set(findingIndex, severity);
        }
      }
    }
  }

  if (findings.length > 0) {
    return findings;
  }

  if (numberedFindings.length === 0) {
    return [];
  }

  return numberedFindings
    .sort((a, b) => a.index - b.index)
    .map((finding, arrayIndex) => {
      const severity = numberedSeverityByIndex.get(finding.index) ?? "major";
      return `- (${arrayIndex + 1}) [${severity}] ${finding.path} (${finding.lineNo}): ${finding.title}`;
    });
}

export function hasExplicitReviewBlockingSignals(resultText: string | undefined): boolean {
  if (!resultText) {
    return false;
  }

  const text = resultText.toLowerCase();
  if (
    text.includes("no blocking issues found")
    || text.includes("ready to merge")
    || text.includes("decision: approve")
  ) {
    return false;
  }

  return (
    /found(?:\s+\*\*\d+)?\s+(?:several|multiple|\d+)?\s*(?:blocking|critical\/major|critical and major|major and critical|critical|major)\s+issues/.test(text)
    || /cannot be merged/.test(text)
    || /should not be merged/.test(text)
    || /address before merging/.test(text)
    || /critical issues found/.test(text)
    || /\bblocking issues\b/.test(text)
  );
}

export function evaluateExplicitMentionReviewPublish(params: {
  explicitReviewRequest: boolean;
  prNumber: number | undefined;
  reviewOutputKey: string | undefined;
  result: ExplicitMentionReviewExecutionSnapshot;
}): ExplicitMentionReviewPublishEvaluation {
  const findingLines = extractExplicitReviewResultFindingLines(params.result.resultText);
  const hasUnpublishedFindings =
    params.explicitReviewRequest
    && params.prNumber !== undefined
    && !params.result.published
    && (findingLines.length > 0 || hasExplicitReviewBlockingSignals(params.result.resultText));

  const eligible =
    params.explicitReviewRequest
    && params.prNumber !== undefined
    && params.result.conclusion === "success"
    && !params.result.published
    && params.result.usedRepoInspectionTools === true
    && Boolean(params.reviewOutputKey)
    && !hasUnpublishedFindings;

  if (eligible) {
    return { eligible: true, findingLines, hasUnpublishedFindings };
  }

  const skipReason: ExplicitMentionReviewPublishSkipReason =
    params.result.conclusion !== "success"
      ? "execution-not-success"
      : params.result.published
        ? "output-already-published"
        : hasUnpublishedFindings
          ? "result-text-findings"
          : params.result.usedRepoInspectionTools !== true
            ? "missing-inspection-evidence"
            : !params.reviewOutputKey
              ? "missing-review-output-key"
              : "not-eligible";

  return {
    eligible: false,
    skipReason,
    findingLines,
    hasUnpublishedFindings,
  };
}

/** Max chars of agent result text to surface in a degraded fallback reply. */
export const MAX_FALLBACK_RESULT_TEXT_CHARS = 12_000;

/**
 * Fallback body lines when an explicit review found blocking signals but no
 * structured finding lines could be parsed from the result text.
 *
 * Rather than discard the agent's review behind a generic "not safely
 * publishable" apology, surface the result text itself — it IS the review the
 * model wrote, and showing it is strictly more useful than hiding it. The
 * generic apology is reserved as a true last resort for when there is no
 * usable text at all.
 */
export function buildExplicitReviewTextFallbackLines(resultText: string | undefined): string[] {
  const trimmed = resultText?.trim();
  if (!trimmed) {
    return [
      "Decision: NOT APPROVED",
      "Issues:",
      "- The review reported blocking issues but produced no readable output. Please re-run `@kodiai review`.",
    ];
  }
  const body = trimmed.length > MAX_FALLBACK_RESULT_TEXT_CHARS
    ? `${trimmed.slice(0, MAX_FALLBACK_RESULT_TEXT_CHARS)}\n\n…(truncated)`
    : trimmed;
  return ["Decision: NOT APPROVED", "", body];
}

export function logExplicitMentionReviewPublishSkipped(params: {
  logger: Logger;
  baseLog: Record<string, unknown>;
  evaluation: ExplicitMentionReviewPublishEvaluation;
  reviewOutputKey: string | undefined;
  result: ExplicitMentionReviewExecutionSnapshot;
  autoApprove: boolean;
}): void {
  if (params.evaluation.eligible || !params.evaluation.skipReason) {
    return;
  }

  params.logger.info(
    {
      ...params.baseLog,
      gate: "explicit-review-publish",
      gateResult: "skipped",
      skipReason: params.evaluation.skipReason,
      reviewOutputKey: params.reviewOutputKey ?? null,
      resultConclusion: params.result.conclusion,
      resultPublished: params.result.published,
      usedRepoInspectionTools: params.result.usedRepoInspectionTools ?? false,
      toolUseNames: params.result.toolUseNames ?? [],
      autoApprove: params.autoApprove,
      unpublishedFindingCount: params.evaluation.findingLines.length,
    },
    "Skipping explicit mention review publish path",
  );
}

export function buildExplicitReviewLifecycleEvidenceLine(
  lifecycleResult: AttachReviewFindingLifecycleResult | null | undefined,
): string | null {
  const projection = lifecycleResult?.projection;
  if (!projection || projection.schema !== "review-finding-lifecycle.v1" || projection.status === "unavailable") {
    return null;
  }

  const counts = projection.counts;
  const statusCounts = counts.status;
  const severityCounts = counts.severity;
  const actionabilityCounts = counts.actionability;
  return [
    `Review finding lifecycle: status=${projection.status}`,
    `counts=input:${counts.input},recorded:${counts.recorded},rejected:${counts.rejected},unsafeInputFields:${counts.unsafeInputFields}`,
    `statuses=detected:${statusCounts.detected},open:${statusCounts.open},validated:${statusCounts.validated},degraded:${statusCounts.degraded}`,
    `severity=critical:${severityCounts.critical},major:${severityCounts.major},medium:${severityCounts.medium},minor:${severityCounts.minor}`,
    `actionability=actionable:${actionabilityCounts.actionable},needs-human-review:${actionabilityCounts["needs-human-review"]},blocked:${actionabilityCounts.blocked}`,
    `rejected=${projection.rejectedReasonCodes.slice(0, 8).join(",") || "none"}`,
    `redaction=privateOnly:y,rawPrompts:n,rawModelOutput:n,candidateBodies:n,toolPayloads:n,secretLike:n,diffs:n,unboundedArrays:n,unsafeFields:${projection.redaction.unsafeInputFieldCount}`,
  ].join("; ");
}

export function buildExplicitMentionReviewPublishFailureBody(params: {
  publishErr: unknown;
  summarizeError: (err: unknown) => string;
}): string {
  const detail = params.summarizeError(params.publishErr);
  const category = classifyError(params.publishErr, false);
  return wrapInDetails(
    formatErrorComment(
      category,
      `Review execution finished, but GitHub rejected the publish step. ${detail}`,
    ),
    "Kodiai couldn't publish the review result",
  );
}
