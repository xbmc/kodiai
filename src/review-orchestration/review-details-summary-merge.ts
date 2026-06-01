import type { ReviewBoundednessContract } from "../lib/review-boundedness.ts";
import { ensureReviewBoundednessDisclosureInSummary } from "../lib/review-boundedness.ts";
import {
  parseSeverityCountsFromBody,
} from "../lib/review-finding-metadata.ts";
import { ensureSearchRateLimitDisclosureInSummary } from "../lib/search-rate-limit.ts";

export function unwrapKodiaiResponseDetails(summaryBody: string): string {
  return summaryBody.replace(
    /\n?<details>\s*\n?<summary>kodiai response<\/summary>\s*\n+([\s\S]*?)\n<\/details>\n?/,
    (_match, inner: string) => `\n${inner.trim()}\n`,
  ).trim();
}

export function ensureVisibleApprovalDecision(summaryBody: string): string {
  if (!summaryBody.includes("Decision: APPROVE")) {
    return summaryBody;
  }

  if (summaryBody.trimStart().startsWith("Decision: APPROVE")) {
    return summaryBody;
  }

  const leadingWhitespaceLength = summaryBody.length - summaryBody.trimStart().length;
  const leadingWhitespace = summaryBody.slice(0, leadingWhitespaceLength);
  const rest = summaryBody
    .slice(leadingWhitespaceLength)
    .replace(/(^|\n)Decision: APPROVE\n*/g, "$1")
    .trimStart();
  return `${leadingWhitespace}Decision: APPROVE\n\n${rest}`;
}

export function mergeReviewDetailsIntoSummaryBody(params: {
  summaryBody: string;
  reviewDetailsBlock: string;
  requireDegradationDisclosure: boolean;
  reviewBoundedness?: ReviewBoundednessContract | null;
}): string {
  let updatedReviewDetails = params.reviewDetailsBlock;
  let summaryBody = ensureVisibleApprovalDecision(
    unwrapKodiaiResponseDetails(
      ensureReviewBoundednessDisclosureInSummary(
        params.summaryBody,
        params.reviewBoundedness,
      ),
    ),
  );
  if (params.requireDegradationDisclosure) {
    summaryBody = ensureSearchRateLimitDisclosureInSummary(summaryBody);
  }

  const bodyCounts = parseSeverityCountsFromBody(summaryBody);
  const bodyTotal = bodyCounts.critical + bodyCounts.major + bodyCounts.medium + bodyCounts.minor;
  if (bodyTotal > 0) {
    updatedReviewDetails = updatedReviewDetails.replace(
      /- Findings: (\d+) critical, (\d+) major, (\d+) medium, (\d+) minor/,
      (_match, c, ma, me, mi) => {
        const total = {
          critical: parseInt(c, 10) + bodyCounts.critical,
          major: parseInt(ma, 10) + bodyCounts.major,
          medium: parseInt(me, 10) + bodyCounts.medium,
          minor: parseInt(mi, 10) + bodyCounts.minor,
        };
        return `- Findings: ${total.critical} critical, ${total.major} major, ${total.medium} medium, ${total.minor} minor (includes ${bodyTotal} from summary observations)`;
      },
    );
  }

  const existingReviewDetailsPattern = /\n?<details>\s*\n?<summary>Review Details<\/summary>[\s\S]*?<\/details>(?:\n?\s*<!--\s*kodiai:review-details:[^>]+-->)?\n?/;
  if (existingReviewDetailsPattern.test(summaryBody)) {
    return summaryBody.replace(existingReviewDetailsPattern, `\n\n${updatedReviewDetails}\n\n`).trim();
  }

  const closingTag = "</details>";
  const firstCloseIdx = summaryBody.indexOf(closingTag);
  if (firstCloseIdx === -1) {
    return `${summaryBody}\n\n${updatedReviewDetails}`;
  }

  const insertionIdx = firstCloseIdx + closingTag.length;
  const before = summaryBody.slice(0, insertionIdx).trimEnd();
  const after = summaryBody.slice(insertionIdx).trimStart();
  return after ? `${before}\n\n${updatedReviewDetails}\n\n${after}` : `${before}\n\n${updatedReviewDetails}`;
}
