export type IssueCommentMarkerLookupOctokit = {
  rest: {
    issues: {
      listComments(args: {
        owner: string;
        repo: string;
        issue_number: number;
        per_page: number;
        page: number;
        sort?: "created" | "updated";
        direction?: "asc" | "desc";
      }): Promise<{
        data: Array<{
          id?: number;
          body?: string | null;
          created_at?: string | null;
          user?: {
            login?: string | null;
          } | null;
        }>;
      }>;
    };
  };
};

export type ReviewCommentMarkerLookupOctokit = {
  rest: {
    pulls: {
      listReviewComments(args: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: number;
        page: number;
        sort?: "created" | "updated";
        direction?: "asc" | "desc";
      }): Promise<{
        data: Array<{
          id?: number;
          body?: string | null;
          path?: string | null;
          line?: number | null;
          start_line?: number | null;
        }>;
      }>;
    };
  };
};

export type PullReviewMarkerLookupOctokit = {
  rest: {
    pulls: {
      listReviews(args: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: number;
        page: number;
      }): Promise<{
        data: Array<{
          id?: number;
          body?: string | null;
        }>;
      }>;
    };
  };
};

export type IssueCommentMarkerMatch = {
  id: number;
  body?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  html_url?: string | null;
  user?: {
    login?: string | null;
  } | null;
};

type IssueCommentMarkerCandidate = {
  id?: number;
  body?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  html_url?: string | null;
  user?: {
    login?: string | null;
  } | null;
};

export type ReviewCommentMarkerMatch = {
  id: number;
  body?: string | null;
  path?: string | null;
  line?: number | null;
  start_line?: number | null;
};

export type ReviewCommentPaged = {
  id?: number;
  body?: string | null;
  html_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  in_reply_to_id?: number;
  path?: string | null;
  line?: number | null;
  start_line?: number | null;
  user?: {
    login?: string | null;
  } | null;
};

export type PullReviewMarkerMatch = {
  id: number;
  body: string;
};

export type IssueCommentPaged = IssueCommentMarkerCandidate;

export type PullReviewPaged = {
  id?: number;
  body?: string | null;
  html_url?: string | null;
  submitted_at?: string | null;
  updated_at?: string | null;
  state?: string | null;
};

export type MarkerScanResult = {
  found: boolean;
  scanned: number;
  hitCap: boolean;
};

export type IssueCommentScanResult = {
  scanned: number;
  stopped: boolean;
  hitCap: boolean;
};

export type ReviewCommentListResult = {
  comments: ReviewCommentPaged[];
  scannedPages: number;
  hitPageCap: boolean;
};

export type IssueCommentListResult = {
  comments: IssueCommentPaged[];
  scannedPages: number;
  hitPageCap: boolean;
};

export type PullReviewListResult = {
  reviews: PullReviewPaged[];
  scannedPages: number;
  hitPageCap: boolean;
};

const DEFAULT_REVIEW_COMMENT_LIST_MAX_PAGES = 10;

export async function listReviewCommentsPaged(
  octokit: ReviewCommentMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    prNumber: number;
    perPage?: number;
    maxPages?: number;
    sort?: "created" | "updated";
    direction?: "asc" | "desc";
  },
): Promise<ReviewCommentListResult> {
  const perPage = params.perPage ?? 100;
  const maxPages = params.maxPages ?? DEFAULT_REVIEW_COMMENT_LIST_MAX_PAGES;
  const comments: ReviewCommentPaged[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await octokit.rest.pulls.listReviewComments({
      owner: params.owner,
      repo: params.repo,
      pull_number: params.prNumber,
      per_page: perPage,
      page,
      ...(params.sort ? { sort: params.sort } : {}),
      ...(params.direction ? { direction: params.direction } : {}),
    });

    comments.push(...(data as ReviewCommentPaged[]));
    if (data.length < perPage) {
      return { comments, scannedPages: page, hitPageCap: false };
    }
  }

  return { comments, scannedPages: maxPages, hitPageCap: true };
}

export async function listIssueCommentsPaged(
  octokit: IssueCommentMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    issueNumber: number;
    perPage?: number;
    maxPages?: number;
    sort?: "created" | "updated";
    direction?: "asc" | "desc";
  },
): Promise<IssueCommentListResult> {
  const perPage = params.perPage ?? 100;
  const maxPages = params.maxPages ?? Number.POSITIVE_INFINITY;
  const comments: IssueCommentPaged[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await octokit.rest.issues.listComments({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issueNumber,
      per_page: perPage,
      page,
      ...(params.sort ? { sort: params.sort } : {}),
      ...(params.direction ? { direction: params.direction } : {}),
    });

    comments.push(...(data as IssueCommentPaged[]));
    if (data.length < perPage) {
      return { comments, scannedPages: page, hitPageCap: false };
    }
  }

  return { comments, scannedPages: maxPages, hitPageCap: true };
}

export async function listPullReviewsPaged(
  octokit: PullReviewMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    prNumber: number;
    perPage?: number;
    maxPages?: number;
  },
): Promise<PullReviewListResult> {
  const perPage = params.perPage ?? 100;
  const maxPages = params.maxPages ?? Number.POSITIVE_INFINITY;
  const reviews: PullReviewPaged[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await octokit.rest.pulls.listReviews({
      owner: params.owner,
      repo: params.repo,
      pull_number: params.prNumber,
      per_page: perPage,
      page,
    });

    reviews.push(...(data as PullReviewPaged[]));
    if (data.length < perPage) {
      return { reviews, scannedPages: page, hitPageCap: false };
    }
  }

  return { reviews, scannedPages: maxPages, hitPageCap: true };
}

export async function scanIssueCommentsPaged(
  octokit: IssueCommentMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    issueNumber: number;
    perPage?: number;
    maxItems?: number;
    sort?: "created" | "updated";
    direction?: "asc" | "desc";
    onComment: (comment: IssueCommentMarkerCandidate) => boolean;
  },
): Promise<IssueCommentScanResult> {
  const perPage = params.perPage ?? 100;
  const maxItems = params.maxItems ?? Number.POSITIVE_INFINITY;
  let scanned = 0;

  for (let page = 1; scanned < maxItems; page += 1) {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issueNumber,
      per_page: perPage,
      page,
      ...(params.sort ? { sort: params.sort } : {}),
      ...(params.direction ? { direction: params.direction } : {}),
    });

    for (const comment of comments) {
      scanned += 1;
      if (params.onComment(comment)) {
        return { scanned, stopped: true, hitCap: false };
      }
      if (scanned >= maxItems) {
        break;
      }
    }

    if (comments.length < perPage) {
      return { scanned, stopped: false, hitCap: false };
    }
  }

  return { scanned, stopped: false, hitCap: true };
}

async function scanIssueCommentsByMarkerPaged(
  octokit: IssueCommentMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    issueNumber: number;
    marker: string;
    perPage?: number;
    maxItems?: number;
    onMatch: (comment: IssueCommentMarkerCandidate) => boolean;
  },
): Promise<MarkerScanResult> {
  let found = false;

  const result = await scanIssueCommentsPaged(octokit, {
    ...params,
    onComment: (comment) => {
      if (comment.body?.includes(params.marker) !== true) {
        return false;
      }
      found = true;
      return params.onMatch(comment);
    },
  });

  return { found, scanned: result.scanned, hitCap: result.hitCap };
}

async function scanReviewCommentsByMarkerPaged(
  octokit: ReviewCommentMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    prNumber: number;
    marker: string;
    perPage?: number;
    maxItems?: number;
    sort?: "created" | "updated";
    direction?: "asc" | "desc";
    onMatch: (comment: {
      id?: number;
      body?: string | null;
      path?: string | null;
      line?: number | null;
      start_line?: number | null;
    }) => boolean;
  },
): Promise<MarkerScanResult> {
  const perPage = params.perPage ?? 100;
  const maxItems = params.maxItems ?? Number.POSITIVE_INFINITY;
  let scanned = 0;
  let found = false;

  for (let page = 1; scanned < maxItems; page += 1) {
    const { data: comments } = await octokit.rest.pulls.listReviewComments({
      owner: params.owner,
      repo: params.repo,
      pull_number: params.prNumber,
      per_page: perPage,
      page,
      ...(params.sort ? { sort: params.sort } : {}),
      ...(params.direction ? { direction: params.direction } : {}),
    });

    for (const comment of comments) {
      scanned += 1;
      if (comment.body?.includes(params.marker) === true) {
        found = true;
        if (params.onMatch(comment)) {
          return { found: true, scanned, hitCap: false };
        }
      }
      if (scanned >= maxItems) {
        break;
      }
    }

    if (comments.length < perPage) {
      return { found, scanned, hitCap: false };
    }
  }

  return { found, scanned, hitCap: true };
}

async function scanPullReviewsByMarkerPaged(
  octokit: PullReviewMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    prNumber: number;
    marker: string;
    perPage?: number;
    maxItems?: number;
    onMatch: (review: PullReviewPaged) => boolean;
  },
): Promise<MarkerScanResult> {
  const perPage = params.perPage ?? 100;
  const maxItems = params.maxItems ?? Number.POSITIVE_INFINITY;
  let scanned = 0;
  let found = false;

  for (let page = 1; scanned < maxItems; page += 1) {
    const { data: reviews } = await octokit.rest.pulls.listReviews({
      owner: params.owner,
      repo: params.repo,
      pull_number: params.prNumber,
      per_page: perPage,
      page,
    });

    for (const review of reviews as PullReviewPaged[]) {
      scanned += 1;
      if (typeof review.body === "string" && review.body.includes(params.marker)) {
        found = true;
        if (params.onMatch(review)) {
          return { found: true, scanned, hitCap: false };
        }
      }
      if (scanned >= maxItems) {
        break;
      }
    }

    if (reviews.length < perPage) {
      return { found, scanned, hitCap: false };
    }
  }

  return { found, scanned, hitCap: true };
}

export async function scanIssueCommentMarkerPaged(
  octokit: IssueCommentMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    issueNumber: number;
    marker: string;
    perPage?: number;
    maxItems?: number;
  },
): Promise<MarkerScanResult> {
  return scanIssueCommentsByMarkerPaged(octokit, {
    ...params,
    onMatch: () => true,
  });
}

export async function scanReviewCommentMarkerPaged(
  octokit: ReviewCommentMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    prNumber: number;
    marker: string;
    perPage?: number;
    maxItems?: number;
    sort?: "created" | "updated";
    direction?: "asc" | "desc";
  },
): Promise<MarkerScanResult> {
  return scanReviewCommentsByMarkerPaged(octokit, {
    ...params,
    onMatch: () => true,
  });
}

export async function scanPullReviewMarkerPaged(
  octokit: PullReviewMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    prNumber: number;
    marker: string;
    perPage?: number;
    maxItems?: number;
  },
): Promise<MarkerScanResult> {
  return scanPullReviewsByMarkerPaged(octokit, {
    ...params,
    onMatch: () => true,
  });
}

export async function hasIssueCommentMarkerPaged(
  octokit: IssueCommentMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    issueNumber: number;
    marker: string;
    perPage?: number;
  },
): Promise<boolean> {
  const result = await scanIssueCommentsByMarkerPaged(octokit, {
    ...params,
    onMatch: () => true,
  });
  return result.found;
}

export async function findIssueCommentByMarkerPaged(
  octokit: IssueCommentMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    issueNumber: number;
    marker: string;
    perPage?: number;
  },
): Promise<IssueCommentMarkerMatch | undefined> {
  let match: IssueCommentMarkerMatch | undefined;

  await scanIssueCommentsByMarkerPaged(octokit, {
    ...params,
    onMatch: (comment) => {
      if (typeof comment.id !== "number") {
        return false;
      }
      match = {
        id: comment.id,
        body: comment.body,
        created_at: comment.created_at,
        user: comment.user,
      };
      return true;
    },
  });

  return match;
}

export async function findIssueCommentsByMarkerPaged(
  octokit: IssueCommentMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    issueNumber: number;
    marker: string;
    perPage?: number;
  },
): Promise<IssueCommentMarkerMatch[]> {
  const matches: IssueCommentMarkerMatch[] = [];

  await scanIssueCommentsByMarkerPaged(octokit, {
    ...params,
    onMatch: (comment) => {
      if (typeof comment.id !== "number") {
        return false;
      }
      matches.push({
        id: comment.id,
        body: comment.body,
        created_at: comment.created_at,
        user: comment.user,
      });
      return false;
    },
  });

  return matches;
}

export async function hasReviewCommentMarkerPaged(
  octokit: ReviewCommentMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    prNumber: number;
    marker: string;
    perPage?: number;
    sort?: "created" | "updated";
    direction?: "asc" | "desc";
  },
): Promise<boolean> {
  const result = await scanReviewCommentsByMarkerPaged(octokit, {
    ...params,
    onMatch: () => true,
  });
  return result.found;
}

export async function findReviewCommentsByMarkerPaged(
  octokit: ReviewCommentMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    prNumber: number;
    marker: string;
    perPage?: number;
    sort?: "created" | "updated";
    direction?: "asc" | "desc";
  },
): Promise<ReviewCommentMarkerMatch[]> {
  const matches: ReviewCommentMarkerMatch[] = [];

  await scanReviewCommentsByMarkerPaged(octokit, {
    ...params,
    onMatch: (comment) => {
      if (typeof comment.id !== "number") {
        return false;
      }
      matches.push({
        id: comment.id,
        body: comment.body,
        path: comment.path,
        line: comment.line,
        start_line: comment.start_line,
      });
      return false;
    },
  });

  return matches;
}

export async function findPullReviewByMarkerPaged(
  octokit: PullReviewMarkerLookupOctokit,
  params: {
    owner: string;
    repo: string;
    prNumber: number;
    marker: string;
    perPage?: number;
    maxItems?: number;
  },
): Promise<PullReviewMarkerMatch | null> {
  let latestMatch: PullReviewMarkerMatch | null = null;

  await scanPullReviewsByMarkerPaged(octokit, {
    ...params,
    onMatch: (review) => {
      if (
        typeof review.id === "number"
        && typeof review.body === "string"
        && review.body.includes(params.marker)
      ) {
        latestMatch = { id: review.id, body: review.body };
      }
      return false;
    },
  });

  return latestMatch;
}
