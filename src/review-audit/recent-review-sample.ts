import {
  extractReviewOutputKey,
  parseReviewOutputKey,
} from "../handlers/review-idempotency.ts";

export type ReviewAuditLane = "automatic" | "explicit";
export type ReviewArtifactSource = "review" | "issue-comment" | "review-comment";

export type RecentReviewArtifact = {
  prNumber: number;
  prUrl: string;
  source: ReviewArtifactSource;
  sourceUrl: string;
  updatedAt: string;
  reviewOutputKey: string;
  lane: ReviewAuditLane;
  action: string;
};

export type RecentReviewSampleSelection = {
  perLaneLimit: number;
  totalLimit: number;
  candidateLaneCounts: Record<ReviewAuditLane, number>;
  selectedLaneCounts: Record<ReviewAuditLane, number>;
  fillCount: number;
};

export type RecentReviewSampleResult = {
  artifacts: RecentReviewArtifact[];
  selection: RecentReviewSampleSelection;
};

type PullRequestRef = {
  number: number;
  html_url: string;
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
};

export type RecentReviewAuditOctokit = {
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

const AUTOMATIC_REVIEW_ACTIONS = new Set([
  "opened",
  "ready_for_review",
  "review_requested",
  "synchronize",
]);

const EXPLICIT_REVIEW_ACTIONS = new Set(["mention-review"]);

function normalizeAction(action: string): string {
  return action.trim().toLowerCase();
}

function getReviewTimestamp(record: ReviewLike): string | null {
  return record.submitted_at ?? record.updated_at ?? null;
}

function compareArtifactsByRecency(a: RecentReviewArtifact, b: RecentReviewArtifact): number {
  const timeDiff = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  if (timeDiff !== 0) {
    return timeDiff;
  }

  return b.prNumber - a.prNumber;
}

function buildArtifact(params: {
  source: ReviewArtifactSource;
  sourceUrl: string | undefined;
  updatedAt: string | null | undefined;
  body: string | null | undefined;
  owner: string;
  repo: string;
  pullRequest: PullRequestRef;
}): RecentReviewArtifact | null {
  const reviewOutputKey = extractReviewOutputKey(params.body);
  if (!reviewOutputKey || !params.updatedAt || !params.sourceUrl) {
    return null;
  }

  const parsed = parseReviewOutputKey(reviewOutputKey);
  if (!parsed) {
    return null;
  }

  if (
    parsed.owner !== params.owner.toLowerCase()
    || parsed.repo !== params.repo.toLowerCase()
    || parsed.prNumber !== params.pullRequest.number
  ) {
    return null;
  }

  const lane = classifyReviewOutputLane(parsed.action);
  if (!lane) {
    return null;
  }

  return {
    prNumber: params.pullRequest.number,
    prUrl: params.pullRequest.html_url,
    source: params.source,
    sourceUrl: params.sourceUrl,
    updatedAt: params.updatedAt,
    reviewOutputKey,
    lane,
    action: parsed.action,
  };
}

export function classifyReviewOutputLane(action: string): ReviewAuditLane | null {
  const normalizedAction = normalizeAction(action);
  if (AUTOMATIC_REVIEW_ACTIONS.has(normalizedAction)) {
    return "automatic";
  }
  if (EXPLICIT_REVIEW_ACTIONS.has(normalizedAction)) {
    return "explicit";
  }
  return null;
}

export async function collectLatestReviewArtifacts(params: {
  octokit: RecentReviewAuditOctokit;
  owner: string;
  repo: string;
  pullRequests: PullRequestRef[];
}): Promise<RecentReviewArtifact[]> {
  const artifacts: RecentReviewArtifact[] = [];

  for (const pullRequest of params.pullRequests) {
    const candidates: RecentReviewArtifact[] = [];

    const reviewComments = await params.octokit.rest.pulls.listReviewComments({
      owner: params.owner,
      repo: params.repo,
      pull_number: pullRequest.number,
      per_page: 100,
      page: 1,
      sort: "created",
      direction: "desc",
    });
    for (const reviewComment of reviewComments.data) {
      const artifact = buildArtifact({
        source: "review-comment",
        sourceUrl: reviewComment.html_url,
        updatedAt: reviewComment.updated_at,
        body: reviewComment.body,
        owner: params.owner,
        repo: params.repo,
        pullRequest,
      });
      if (artifact) {
        candidates.push(artifact);
      }
    }

    const issueComments = await params.octokit.rest.issues.listComments({
      owner: params.owner,
      repo: params.repo,
      issue_number: pullRequest.number,
      per_page: 100,
      page: 1,
      sort: "created",
      direction: "desc",
    });
    for (const issueComment of issueComments.data) {
      const artifact = buildArtifact({
        source: "issue-comment",
        sourceUrl: issueComment.html_url,
        updatedAt: issueComment.updated_at,
        body: issueComment.body,
        owner: params.owner,
        repo: params.repo,
        pullRequest,
      });
      if (artifact) {
        candidates.push(artifact);
      }
    }

    const reviews = await params.octokit.rest.pulls.listReviews({
      owner: params.owner,
      repo: params.repo,
      pull_number: pullRequest.number,
      per_page: 100,
      page: 1,
    });
    for (const review of reviews.data) {
      const artifact = buildArtifact({
        source: "review",
        sourceUrl: review.html_url,
        updatedAt: getReviewTimestamp(review),
        body: review.body,
        owner: params.owner,
        repo: params.repo,
        pullRequest,
      });
      if (artifact) {
        candidates.push(artifact);
      }
    }

    if (candidates.length === 0) {
      continue;
    }

    candidates.sort(compareArtifactsByRecency);
    artifacts.push(candidates[0]!);
  }

  return artifacts.sort(compareArtifactsByRecency);
}

export function selectRecentReviewSample(
  artifacts: RecentReviewArtifact[],
  options?: {
    perLaneLimit?: number;
    totalLimit?: number;
  },
): RecentReviewSampleResult {
  const perLaneLimit = Math.max(1, options?.perLaneLimit ?? 6);
  const totalLimit = Math.max(1, options?.totalLimit ?? 12);
  const sortedArtifacts = [...artifacts].sort(compareArtifactsByRecency);

  const candidateLaneCounts: Record<ReviewAuditLane, number> = {
    automatic: sortedArtifacts.filter((artifact) => artifact.lane === "automatic").length,
    explicit: sortedArtifacts.filter((artifact) => artifact.lane === "explicit").length,
  };

  const selected: RecentReviewArtifact[] = [];
  const selectedPrNumbers = new Set<number>();

  for (const lane of ["automatic", "explicit"] as const) {
    const laneArtifacts = sortedArtifacts.filter((artifact) => artifact.lane === lane);
    for (const artifact of laneArtifacts.slice(0, perLaneLimit)) {
      selected.push(artifact);
      selectedPrNumbers.add(artifact.prNumber);
      if (selected.length >= totalLimit) {
        break;
      }
    }
    if (selected.length >= totalLimit) {
      break;
    }
  }

  const initialSelectionCount = selected.length;

  if (selected.length < totalLimit) {
    for (const artifact of sortedArtifacts) {
      if (selected.length >= totalLimit) {
        break;
      }
      if (selectedPrNumbers.has(artifact.prNumber)) {
        continue;
      }
      selected.push(artifact);
      selectedPrNumbers.add(artifact.prNumber);
    }
  }

  selected.sort(compareArtifactsByRecency);

  const selectedLaneCounts: Record<ReviewAuditLane, number> = {
    automatic: selected.filter((artifact) => artifact.lane === "automatic").length,
    explicit: selected.filter((artifact) => artifact.lane === "explicit").length,
  };

  return {
    artifacts: selected,
    selection: {
      perLaneLimit,
      totalLimit,
      candidateLaneCounts,
      selectedLaneCounts,
      fillCount: Math.max(0, selected.length - initialSelectionCount),
    },
  };
}
