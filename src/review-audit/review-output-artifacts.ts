import {
  buildReviewOutputMarker,
  extractReviewOutputKey,
  parseReviewOutputKey,
  type ParsedReviewOutputKey,
} from "../handlers/review-idempotency.ts";
import {
  classifyReviewOutputLane,
  type ReviewArtifactSource,
  type ReviewAuditLane,
} from "./recent-review-sample.ts";

const DEFAULT_PER_PAGE = 100;
const REQUIRED_DETAILS_WRAPPER = "<summary>kodiai response</summary>";

export type ReviewOutputArtifact = {
  prNumber: number;
  prUrl: string;
  source: ReviewArtifactSource;
  sourceUrl: string | null;
  updatedAt: string | null;
  reviewOutputKey: string;
  lane: ReviewAuditLane | null;
  action: string;
  body: string | null;
  reviewState: string | null;
};

export type ReviewOutputArtifactCounts = {
  reviewComments: number;
  issueComments: number;
  reviews: number;
  total: number;
};

export type ReviewOutputArtifactCollection = {
  requestedReviewOutputKey: string;
  prUrl: string;
  artifactCounts: ReviewOutputArtifactCounts;
  artifacts: ReviewOutputArtifact[];
};

export type CollapsedApproveReviewBodyValidation = {
  valid: boolean;
  bodyPresent: boolean;
  hasDecisionApprove: boolean;
  hasIssuesNone: boolean;
  hasEvidenceHeading: boolean;
  hasOnlyEvidenceBullets: boolean;
  evidenceBulletCount: number;
  hasExactMarker: boolean;
  hasDetailsWrapper: boolean;
  issues: string[];
};

export type ExactReviewOutputProofStatus =
  | "ok"
  | "missing_artifact"
  | "duplicate_artifacts"
  | "invalid_artifact_metadata"
  | "wrong_artifact_source"
  | "wrong_review_state"
  | "body_drift";

export type ExactReviewOutputProof = {
  ok: boolean;
  status: ExactReviewOutputProofStatus;
  artifact: ReviewOutputArtifact | null;
  validation: CollapsedApproveReviewBodyValidation | null;
  issues: string[];
};

type ReviewCommentLike = {
  body?: string | null;
  html_url?: string;
  updated_at?: string;
};

type IssueCommentLike = {
  body?: string | null;
  html_url?: string;
  updated_at?: string;
};

type ReviewLike = {
  body?: string | null;
  html_url?: string;
  submitted_at?: string;
  updated_at?: string;
  state?: string;
};

export type ReviewOutputArtifactsOctokit = {
  rest: {
    pulls: {
      listReviewComments(args: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page?: number;
        page?: number;
        sort?: string;
        direction?: string;
      }): Promise<{ data: ReviewCommentLike[] }>;
      listReviews(args: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page?: number;
        page?: number;
      }): Promise<{ data: ReviewLike[] }>;
    };
    issues: {
      listComments(args: {
        owner: string;
        repo: string;
        issue_number: number;
        per_page?: number;
        page?: number;
        sort?: string;
        direction?: string;
      }): Promise<{ data: IssueCommentLike[] }>;
    };
  };
};

export class ReviewOutputArtifactCollectionError extends Error {
  code: "invalid_review_output_key" | "review_output_artifact_collection_failed";
  endpoint?: "reviewComments" | "issueComments" | "reviews";

  constructor(params: {
    code: "invalid_review_output_key" | "review_output_artifact_collection_failed";
    message: string;
    endpoint?: "reviewComments" | "issueComments" | "reviews";
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "ReviewOutputArtifactCollectionError";
    this.code = params.code;
    this.endpoint = params.endpoint;
    if (params.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = params.cause;
    }
  }
}

function buildPrUrl(parsed: ParsedReviewOutputKey): string {
  return `https://github.com/${parsed.owner}/${parsed.repo}/pull/${parsed.prNumber}`;
}

function getReviewTimestamp(review: ReviewLike): string | null {
  return review.submitted_at ?? review.updated_at ?? null;
}

function normalizeReviewState(state: string | null | undefined): string | null {
  const normalized = state?.trim().toUpperCase();
  return normalized ? normalized : null;
}

function matchesRequestedReviewOutputKey(params: {
  body: string | null | undefined;
  requestedReviewOutputKey: string;
  parsedRequestedKey: ParsedReviewOutputKey;
}): boolean {
  const extracted = extractReviewOutputKey(params.body);
  if (!extracted || extracted !== params.requestedReviewOutputKey) {
    return false;
  }

  const parsedExtracted = parseReviewOutputKey(extracted);
  if (!parsedExtracted) {
    return false;
  }

  return parsedExtracted.owner === params.parsedRequestedKey.owner
    && parsedExtracted.repo === params.parsedRequestedKey.repo
    && parsedExtracted.prNumber === params.parsedRequestedKey.prNumber
    && parsedExtracted.action === params.parsedRequestedKey.action
    && parsedExtracted.effectiveDeliveryId === params.parsedRequestedKey.effectiveDeliveryId
    && parsedExtracted.headSha === params.parsedRequestedKey.headSha;
}

function buildArtifact(params: {
  parsedRequestedKey: ParsedReviewOutputKey;
  source: ReviewArtifactSource;
  sourceUrl: string | undefined;
  updatedAt: string | null | undefined;
  body: string | null | undefined;
  reviewState?: string | null;
}): ReviewOutputArtifact | null {
  if (!matchesRequestedReviewOutputKey({
    body: params.body,
    requestedReviewOutputKey: params.parsedRequestedKey.reviewOutputKey,
    parsedRequestedKey: params.parsedRequestedKey,
  })) {
    return null;
  }

  return {
    prNumber: params.parsedRequestedKey.prNumber,
    prUrl: buildPrUrl(params.parsedRequestedKey),
    source: params.source,
    sourceUrl: params.sourceUrl ?? null,
    updatedAt: params.updatedAt ?? null,
    reviewOutputKey: params.parsedRequestedKey.reviewOutputKey,
    lane: classifyReviewOutputLane(params.parsedRequestedKey.action),
    action: params.parsedRequestedKey.action,
    body: params.body ?? null,
    reviewState: normalizeReviewState(params.reviewState),
  };
}

async function collectPagedArtifacts<T>(params: {
  endpoint: "reviewComments" | "issueComments" | "reviews";
  fetchPage: (args: { page: number; per_page: number }) => Promise<T[]>;
  buildArtifact: (item: T) => ReviewOutputArtifact | null;
}): Promise<ReviewOutputArtifact[]> {
  const artifacts: ReviewOutputArtifact[] = [];

  for (let page = 1; ; page += 1) {
    let data: T[];
    try {
      data = await params.fetchPage({ page, per_page: DEFAULT_PER_PAGE });
    } catch (error) {
      throw new ReviewOutputArtifactCollectionError({
        code: "review_output_artifact_collection_failed",
        endpoint: params.endpoint,
        message: `Failed to collect review output artifacts from ${params.endpoint}.`,
        cause: error,
      });
    }

    for (const item of data) {
      const artifact = params.buildArtifact(item);
      if (artifact) {
        artifacts.push(artifact);
      }
    }

    if (data.length < DEFAULT_PER_PAGE) {
      break;
    }
  }

  return artifacts;
}

export async function collectReviewOutputArtifacts(params: {
  octokit: ReviewOutputArtifactsOctokit;
  reviewOutputKey: string;
}): Promise<ReviewOutputArtifactCollection> {
  const parsedRequestedKey = parseReviewOutputKey(params.reviewOutputKey);
  if (!parsedRequestedKey) {
    throw new ReviewOutputArtifactCollectionError({
      code: "invalid_review_output_key",
      message: "Malformed reviewOutputKey.",
    });
  }

  const reviewComments = await collectPagedArtifacts({
    endpoint: "reviewComments",
    fetchPage: async ({ page, per_page }) => {
      const { data } = await params.octokit.rest.pulls.listReviewComments({
        owner: parsedRequestedKey.owner,
        repo: parsedRequestedKey.repo,
        pull_number: parsedRequestedKey.prNumber,
        per_page,
        page,
        sort: "created",
        direction: "desc",
      });
      return data;
    },
    buildArtifact: (item: ReviewCommentLike) => buildArtifact({
      parsedRequestedKey,
      source: "review-comment",
      sourceUrl: item.html_url,
      updatedAt: item.updated_at,
      body: item.body,
    }),
  });

  const issueComments = await collectPagedArtifacts({
    endpoint: "issueComments",
    fetchPage: async ({ page, per_page }) => {
      const { data } = await params.octokit.rest.issues.listComments({
        owner: parsedRequestedKey.owner,
        repo: parsedRequestedKey.repo,
        issue_number: parsedRequestedKey.prNumber,
        per_page,
        page,
        sort: "created",
        direction: "desc",
      });
      return data;
    },
    buildArtifact: (item: IssueCommentLike) => buildArtifact({
      parsedRequestedKey,
      source: "issue-comment",
      sourceUrl: item.html_url,
      updatedAt: item.updated_at,
      body: item.body,
    }),
  });

  const reviews = await collectPagedArtifacts({
    endpoint: "reviews",
    fetchPage: async ({ page, per_page }) => {
      const { data } = await params.octokit.rest.pulls.listReviews({
        owner: parsedRequestedKey.owner,
        repo: parsedRequestedKey.repo,
        pull_number: parsedRequestedKey.prNumber,
        per_page,
        page,
      });
      return data;
    },
    buildArtifact: (item: ReviewLike) => buildArtifact({
      parsedRequestedKey,
      source: "review",
      sourceUrl: item.html_url,
      updatedAt: getReviewTimestamp(item),
      body: item.body,
      reviewState: item.state,
    }),
  });

  const artifacts = [...reviewComments, ...issueComments, ...reviews];

  return {
    requestedReviewOutputKey: parsedRequestedKey.reviewOutputKey,
    prUrl: buildPrUrl(parsedRequestedKey),
    artifactCounts: {
      reviewComments: reviewComments.length,
      issueComments: issueComments.length,
      reviews: reviews.length,
      total: artifacts.length,
    },
    artifacts,
  };
}

export function validateCollapsedApproveReviewBody(params: {
  reviewOutputKey: string;
  body: string | null | undefined;
}): CollapsedApproveReviewBodyValidation {
  const body = typeof params.body === "string" ? params.body : null;
  const marker = buildReviewOutputMarker(params.reviewOutputKey);

  if (!body) {
    return {
      valid: false,
      bodyPresent: false,
      hasDecisionApprove: false,
      hasIssuesNone: false,
      hasEvidenceHeading: false,
      hasOnlyEvidenceBullets: false,
      evidenceBulletCount: 0,
      hasExactMarker: false,
      hasDetailsWrapper: false,
      issues: ["Approval body is missing."],
    };
  }

  const hasDetailsWrapper = body.includes(REQUIRED_DETAILS_WRAPPER)
    && body.includes("<details>")
    && body.includes("</details>");
  const hasExactMarker = body.includes(marker);
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === "<details>");
  const end = lines.findIndex((line) => line.trim() === "</details>");
  const wrappedContent = start !== -1 && end !== -1 && end > start
    ? lines.slice(start + 1, end)
    : lines;
  const content = wrappedContent
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .filter((line) => !line.trim().startsWith("<summary>"))
    .filter((line) => line.trim() !== marker)
    .map((line) => line.trim());

  const hasDecisionApprove = content[0] === "Decision: APPROVE";
  const hasIssuesNone = content[1] === "Issues: none";
  const hasEvidenceHeading = content[2] === "Evidence:";
  const evidenceLines = content.slice(3);
  const hasOnlyEvidenceBullets = evidenceLines.every((line) => line.startsWith("- "));
  const evidenceBulletCount = evidenceLines.filter((line) => line.startsWith("- ")).length;

  const issues: string[] = [];
  if (!hasDetailsWrapper) {
    issues.push("Approval body must use collapsed <details> wrapper text.");
  }
  if (!hasDecisionApprove) {
    issues.push("Approval body must start with 'Decision: APPROVE'.");
  }
  if (!hasIssuesNone) {
    issues.push("Approval body must include 'Issues: none'.");
  }
  if (!hasEvidenceHeading) {
    issues.push("Approval body must include 'Evidence:'.");
  }
  if (!hasOnlyEvidenceBullets) {
    issues.push("Approval body must contain only Decision: APPROVE, Issues: none, Evidence:, and 1-3 bullet lines.");
  }
  if (evidenceBulletCount < 1 || evidenceBulletCount > 3) {
    issues.push("Approval body must include 1-3 evidence bullets.");
  }
  if (!hasExactMarker) {
    issues.push("Approval body must include the exact review-output marker for the requested reviewOutputKey.");
  }

  return {
    valid: issues.length === 0,
    bodyPresent: true,
    hasDecisionApprove,
    hasIssuesNone,
    hasEvidenceHeading,
    hasOnlyEvidenceBullets,
    evidenceBulletCount,
    hasExactMarker,
    hasDetailsWrapper,
    issues,
  };
}

export function evaluateExactReviewOutputProof(
  collection: ReviewOutputArtifactCollection,
): ExactReviewOutputProof {
  const totalArtifacts = collection.artifacts.length;

  if (totalArtifacts === 0) {
    return {
      ok: false,
      status: "missing_artifact",
      artifact: null,
      validation: null,
      issues: ["No GitHub artifacts matched the requested reviewOutputKey."],
    };
  }

  if (totalArtifacts !== 1) {
    return {
      ok: false,
      status: "duplicate_artifacts",
      artifact: null,
      validation: null,
      issues: [
        `Expected exactly one visible GitHub artifact for reviewOutputKey, found ${totalArtifacts} (reviewComments=${collection.artifactCounts.reviewComments} issueComments=${collection.artifactCounts.issueComments} reviews=${collection.artifactCounts.reviews}).`,
      ],
    };
  }

  const artifact = collection.artifacts[0]!;
  const metadataIssues: string[] = [];

  if (!artifact.sourceUrl) {
    metadataIssues.push("Matching artifact is missing sourceUrl.");
  }
  if (!artifact.updatedAt) {
    metadataIssues.push("Matching artifact is missing updatedAt timestamp.");
  }
  if (!artifact.body) {
    metadataIssues.push("Matching artifact is missing body.");
  }
  if (artifact.source === "review" && !artifact.reviewState) {
    metadataIssues.push("Matching review artifact is missing reviewState.");
  }

  if (metadataIssues.length > 0) {
    return {
      ok: false,
      status: "invalid_artifact_metadata",
      artifact,
      validation: artifact.body
        ? validateCollapsedApproveReviewBody({
            reviewOutputKey: collection.requestedReviewOutputKey,
            body: artifact.body,
          })
        : null,
      issues: metadataIssues,
    };
  }

  if (artifact.source !== "review") {
    return {
      ok: false,
      status: "wrong_artifact_source",
      artifact,
      validation: null,
      issues: [
        `Expected the sole matching GitHub artifact to be a pull request review, found ${artifact.source}.`,
      ],
    };
  }

  if (artifact.reviewState !== "APPROVED") {
    return {
      ok: false,
      status: "wrong_review_state",
      artifact,
      validation: null,
      issues: [
        `Expected the sole matching review to have state APPROVED, found ${artifact.reviewState}.`,
      ],
    };
  }

  const validation = validateCollapsedApproveReviewBody({
    reviewOutputKey: collection.requestedReviewOutputKey,
    body: artifact.body,
  });
  if (!validation.valid) {
    return {
      ok: false,
      status: "body_drift",
      artifact,
      validation,
      issues: [...validation.issues],
    };
  }

  return {
    ok: true,
    status: "ok",
    artifact,
    validation,
    issues: [],
  };
}
