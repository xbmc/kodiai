import pino from "pino";
import { createGitHubApp } from "../src/auth/github-app.ts";
import {
  buildReviewOutputMarker,
  parseReviewOutputKey,
  type ParsedReviewOutputKey,
} from "../src/handlers/review-idempotency.ts";

type AccessState = "available" | "missing" | "unavailable";

const DEFAULT_PER_PAGE = 100;
const DEFAULT_REPO = "xbmc/kodiai";
const DEFAULT_RESOURCE_GROUP = "rg-kodiai";
const SUGGESTION_FENCE_REGEX = /```suggestion(?:\s|\n)[\s\S]*?```/i;
const MAX_ERROR_TEXT_LENGTH = 240;

type LiveOctokit = Awaited<ReturnType<ReturnType<typeof createGitHubApp>["getInstallationOctokit"]>>;

export type M066S05StatusCode =
  | "m066_s05_ok"
  | "m066_s05_invalid_arg"
  | "m066_s05_missing_github_access"
  | "m066_s05_github_unavailable"
  | "m066_s05_no_matching_review"
  | "m066_s05_duplicate_reviews"
  | "m066_s05_wrong_review_state"
  | "m066_s05_no_suggestion_comment"
  | "m066_s05_malformed_github_data";

export type M066S05Review = {
  id?: number | null;
  body?: string | null;
  state?: string | null;
  html_url?: string | null;
  pull_request_url?: string | null;
  submitted_at?: string | null;
  updated_at?: string | null;
};

export type M066S05ReviewComment = {
  id?: number | null;
  body?: string | null;
  html_url?: string | null;
  pull_request_review_id?: number | null;
  updated_at?: string | null;
};

export type M066S05ProofCollection = {
  prUrl: string;
  reviews: M066S05Review[];
  reviewComments: M066S05ReviewComment[];
};

export type M066S05Report = {
  command: "verify:m066:s05";
  generated_at: string;
  repo: string | null;
  review_output_key: string | null;
  delivery_id: string | null;
  success: boolean;
  status_code: M066S05StatusCode;
  preflight: {
    githubAccess: AccessState;
  };
  proof: {
    pr_number: number | null;
    pr_url: string | null;
    review_id: number | null;
    review_url: string | null;
    first_suggestion_comment_id: number | null;
    first_suggestion_comment_url: string | null;
    matched_review_output_key: string | null;
  };
  artifactCounts: {
    reviews: number;
    matchingReviews: number;
    reviewComments: number;
    matchingSuggestionComments: number;
  };
  issues: string[];
};

type VerifyM066S05Args = {
  help: boolean;
  json: boolean;
  repo: string;
  reviewOutputKey: string | null;
  deliveryId: string | null;
  invalidArg: string | null;
};

type ValidatedArgs = {
  repo: string;
  reviewOutputKey: string;
  deliveryId: string;
  prNumber: number;
  parsedKey: ParsedReviewOutputKey;
};

type EvaluateParams = {
  repo: string;
  reviewOutputKey: string;
  deliveryId?: string | null;
  generatedAt?: string;
  githubAccess?: AccessState;
  collectProof?: (params: ValidatedArgs) => Promise<M066S05ProofCollection>;
};

function normalizeIdentifier(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRepo(repo: string | null | undefined): string | null {
  const normalized = normalizeIdentifier(repo);
  if (!normalized) {
    return null;
  }

  const parts = normalized.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }

  return `${parts[0]}/${parts[1]}`;
}

function readOptionValue(args: string[], index: number): { value: string | null; consumed: boolean } {
  const candidate = args[index + 1];
  if (typeof candidate !== "string" || candidate.startsWith("--")) {
    return { value: null, consumed: false };
  }

  return { value: candidate, consumed: true };
}

export function parseVerifyM066S05Args(args: string[]): VerifyM066S05Args {
  let repo = DEFAULT_REPO;
  let reviewOutputKey: string | null = null;
  let deliveryId: string | null = null;
  let invalidArg: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h" || arg === "--json") {
      continue;
    }

    if (arg === "--repo") {
      const { value, consumed } = readOptionValue(args, index);
      if (!value) {
        invalidArg = "Missing value for --repo.";
        break;
      }
      repo = value;
      if (consumed) {
        index += 1;
      }
      continue;
    }

    if (arg === "--review-output-key") {
      const { value, consumed } = readOptionValue(args, index);
      if (!value) {
        invalidArg = "Missing value for --review-output-key.";
        break;
      }
      reviewOutputKey = value;
      if (consumed) {
        index += 1;
      }
      continue;
    }

    if (arg === "--delivery-id") {
      const { value, consumed } = readOptionValue(args, index);
      if (!value) {
        invalidArg = "Missing value for --delivery-id.";
        break;
      }
      deliveryId = value;
      if (consumed) {
        index += 1;
      }
      continue;
    }

    invalidArg = `Unknown argument: ${arg}.`;
    break;
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    repo,
    reviewOutputKey,
    deliveryId,
    invalidArg,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m066:s05 -- --repo <owner/repo> --review-output-key <key> [--delivery-id <id>] [--json]",
    "",
    "Options:",
    `  --repo               Repository to verify (default: ${DEFAULT_REPO})`,
    "  --review-output-key  Required formatter-suggestion reviewOutputKey captured from the deployed run",
    "  --delivery-id        Optional delivery id cross-check; must match the encoded key when provided",
    "  --json               Print machine-readable JSON output",
    "  --help               Show this help",
    "",
    "Environment:",
    "  GITHUB_APP_ID + GITHUB_PRIVATE_KEY(_BASE64)  Required for live GitHub proof",
  ].join("\n");
}

function hasGitHubEnv(): boolean {
  return Boolean(process.env.GITHUB_APP_ID && (process.env.GITHUB_PRIVATE_KEY || process.env.GITHUB_PRIVATE_KEY_BASE64));
}

async function loadPrivateKeyFromEnv(): Promise<string> {
  const keyEnv = process.env.GITHUB_PRIVATE_KEY ?? process.env.GITHUB_PRIVATE_KEY_BASE64;
  if (!keyEnv) {
    throw new Error("Missing GitHub App private key environment variable.");
  }

  if (keyEnv.startsWith("-----BEGIN")) {
    return keyEnv;
  }

  if (keyEnv.startsWith("/") || keyEnv.startsWith("./")) {
    return await Bun.file(keyEnv).text();
  }

  return atob(keyEnv);
}

function buildGitHubAppConfig(repo: string, githubPrivateKey: string) {
  return {
    githubAppId: process.env.GITHUB_APP_ID!,
    githubPrivateKey,
    webhookSecret: "unused",
    slackSigningSecret: "unused",
    slackBotToken: "unused",
    slackBotUserId: "unused",
    slackKodiaiChannelId: "unused",
    slackDefaultRepo: repo,
    slackAssistantModel: "unused",
    port: 0,
    logLevel: "info",
    botAllowList: [],
    slackWikiChannelId: "",
    wikiStalenessThresholdDays: 30,
    wikiGithubOwner: "",
    wikiGithubRepo: "",
    botUserPat: "",
    botUserLogin: "",
    addonRepos: [],
    mcpInternalBaseUrl: "",
    acaJobImage: "",
    acaResourceGroup: DEFAULT_RESOURCE_GROUP,
    acaJobName: "caj-kodiai-agent",
  };
}

async function createLiveGitHubContext(repo: string): Promise<{
  octokit: LiveOctokit;
  owner: string;
  repoName: string;
}> {
  const normalizedRepo = normalizeRepo(repo);
  if (!normalizedRepo) {
    throw new Error(`Invalid repo '${repo}'. Expected owner/repo.`);
  }

  const [owner, repoName] = normalizedRepo.split("/") as [string, string];
  const logger = pino({ level: "silent" });
  const githubPrivateKey = await loadPrivateKeyFromEnv();
  const githubApp = createGitHubApp(buildGitHubAppConfig(normalizedRepo, githubPrivateKey) as never, logger);
  await githubApp.initialize();

  const installationContext = await githubApp.getRepoInstallationContext(owner, repoName);
  if (!installationContext) {
    throw new Error(`GitHub App is not installed on ${normalizedRepo}.`);
  }

  const octokit = await githubApp.getInstallationOctokit(installationContext.installationId);
  return { octokit, owner, repoName };
}

async function collectPaged<T>(fetchPage: (args: { page: number; per_page: number }) => Promise<T[]>): Promise<T[]> {
  const items: T[] = [];

  for (let page = 1; ; page += 1) {
    const data = await fetchPage({ page, per_page: DEFAULT_PER_PAGE });
    items.push(...data);
    if (data.length < DEFAULT_PER_PAGE) {
      return items;
    }
  }
}

async function collectProofLive(params: ValidatedArgs): Promise<M066S05ProofCollection> {
  const live = await createLiveGitHubContext(params.repo);
  const prUrl = `https://github.com/${params.parsedKey.owner}/${params.parsedKey.repo}/pull/${params.prNumber}`;

  const reviews = await collectPaged<M066S05Review>(async ({ page, per_page }) => {
    const { data } = await live.octokit.rest.pulls.listReviews({
      owner: live.owner,
      repo: live.repoName,
      pull_number: params.prNumber,
      per_page,
      page,
    });
    return data as M066S05Review[];
  });

  const reviewComments = await collectPaged<M066S05ReviewComment>(async ({ page, per_page }) => {
    const { data } = await live.octokit.rest.pulls.listReviewComments({
      owner: live.owner,
      repo: live.repoName,
      pull_number: params.prNumber,
      per_page,
      page,
      sort: "created",
      direction: "desc",
    });
    return data as M066S05ReviewComment[];
  });

  return { prUrl, reviews, reviewComments };
}

function createBaseReport(params: {
  generatedAt?: string;
  repo?: string | null;
  reviewOutputKey?: string | null;
  deliveryId?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
  statusCode: M066S05StatusCode;
  success: boolean;
  githubAccess?: AccessState;
  reviewId?: number | null;
  reviewUrl?: string | null;
  suggestionCommentId?: number | null;
  suggestionCommentUrl?: string | null;
  artifactCounts?: Partial<M066S05Report["artifactCounts"]>;
  issues?: string[];
}): M066S05Report {
  return {
    command: "verify:m066:s05",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    repo: params.repo ?? null,
    review_output_key: params.reviewOutputKey ?? null,
    delivery_id: params.deliveryId ?? null,
    success: params.success,
    status_code: params.statusCode,
    preflight: {
      githubAccess: params.githubAccess ?? "missing",
    },
    proof: {
      pr_number: params.prNumber ?? null,
      pr_url: params.prUrl ?? null,
      review_id: params.reviewId ?? null,
      review_url: params.reviewUrl ?? null,
      first_suggestion_comment_id: params.suggestionCommentId ?? null,
      first_suggestion_comment_url: params.suggestionCommentUrl ?? null,
      matched_review_output_key: params.reviewOutputKey ?? null,
    },
    artifactCounts: {
      reviews: params.artifactCounts?.reviews ?? 0,
      matchingReviews: params.artifactCounts?.matchingReviews ?? 0,
      reviewComments: params.artifactCounts?.reviewComments ?? 0,
      matchingSuggestionComments: params.artifactCounts?.matchingSuggestionComments ?? 0,
    },
    issues: params.issues ?? [],
  };
}

function validateArgs(params: {
  repo: string;
  reviewOutputKey: string | null | undefined;
  deliveryId?: string | null;
}): ValidatedArgs | { issues: string[] } {
  const issues: string[] = [];
  const normalizedRepo = normalizeRepo(params.repo);
  const normalizedReviewOutputKey = normalizeIdentifier(params.reviewOutputKey);
  const normalizedDeliveryId = normalizeIdentifier(params.deliveryId);

  if (!normalizedReviewOutputKey) {
    issues.push("Missing required --review-output-key.");
    return { issues };
  }

  if (!normalizedRepo) {
    issues.push(`Invalid repo '${params.repo}'. Expected owner/repo.`);
  }

  const parsedKey = parseReviewOutputKey(normalizedReviewOutputKey);
  if (!parsedKey) {
    issues.push("Malformed --review-output-key.");
  } else {
    if (parsedKey.action !== "mention-format-suggestions") {
      issues.push("--review-output-key must encode the mention-format-suggestions action.");
    }
    if (normalizedDeliveryId && normalizedDeliveryId !== parsedKey.effectiveDeliveryId) {
      issues.push("Provided --delivery-id does not match the delivery id encoded in --review-output-key.");
    }
    if (normalizedRepo && normalizedRepo !== parsedKey.repoFullName) {
      issues.push("Provided --repo does not match the repository encoded in --review-output-key.");
    }
  }

  if (issues.length > 0) {
    return { issues };
  }

  return {
    repo: normalizedRepo!,
    reviewOutputKey: normalizedReviewOutputKey,
    deliveryId: parsedKey!.effectiveDeliveryId,
    prNumber: parsedKey!.prNumber,
    parsedKey: parsedKey!,
  };
}

function boundedErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_ERROR_TEXT_LENGTH
    ? `${message.slice(0, MAX_ERROR_TEXT_LENGTH)}…`
    : message;
}

function isMissingGitHubAccessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("GitHub App is not installed")
    || message.includes("Missing GitHub App private key")
    || message.includes("Bad credentials")
    || message.includes("Resource not accessible by integration");
}

function stateOf(review: M066S05Review): string | null {
  const normalized = review.state?.trim().toUpperCase();
  return normalized ? normalized : null;
}

function bodyContainsRequestedMarker(body: string | null | undefined, reviewOutputKey: string): boolean {
  return typeof body === "string" && body.includes(buildReviewOutputMarker(reviewOutputKey));
}

function hasSuggestionFence(body: string | null | undefined): boolean {
  return typeof body === "string" && SUGGESTION_FENCE_REGEX.test(body);
}

function evaluateCollection(params: {
  generatedAt: string;
  validated: ValidatedArgs;
  githubAccess: AccessState;
  collection: M066S05ProofCollection;
}): M066S05Report {
  const matchingReviews = params.collection.reviews.filter((review) =>
    bodyContainsRequestedMarker(review.body, params.validated.reviewOutputKey));
  const artifactCounts = {
    reviews: params.collection.reviews.length,
    matchingReviews: matchingReviews.length,
    reviewComments: params.collection.reviewComments.length,
    matchingSuggestionComments: 0,
  };

  if (matchingReviews.length === 0) {
    return createBaseReport({
      generatedAt: params.generatedAt,
      repo: params.validated.repo,
      reviewOutputKey: params.validated.reviewOutputKey,
      deliveryId: params.validated.deliveryId,
      prNumber: params.validated.prNumber,
      prUrl: params.collection.prUrl,
      statusCode: "m066_s05_no_matching_review",
      success: false,
      githubAccess: params.githubAccess,
      artifactCounts,
      issues: ["No pull request review body contained the requested review-output marker."],
    });
  }

  if (matchingReviews.length > 1) {
    return createBaseReport({
      generatedAt: params.generatedAt,
      repo: params.validated.repo,
      reviewOutputKey: params.validated.reviewOutputKey,
      deliveryId: params.validated.deliveryId,
      prNumber: params.validated.prNumber,
      prUrl: params.collection.prUrl,
      statusCode: "m066_s05_duplicate_reviews",
      success: false,
      githubAccess: params.githubAccess,
      artifactCounts,
      issues: [`Expected exactly one matching pull request review, found ${matchingReviews.length}.`],
    });
  }

  const review = matchingReviews[0]!;
  const metadataIssues: string[] = [];
  if (typeof review.id !== "number") {
    metadataIssues.push("Matching review is missing numeric id.");
  }
  if (!review.html_url) {
    metadataIssues.push("Matching review is missing html_url.");
  }
  if (!review.body) {
    metadataIssues.push("Matching review is missing body.");
  }

  if (metadataIssues.length > 0) {
    return createBaseReport({
      generatedAt: params.generatedAt,
      repo: params.validated.repo,
      reviewOutputKey: params.validated.reviewOutputKey,
      deliveryId: params.validated.deliveryId,
      prNumber: params.validated.prNumber,
      prUrl: params.collection.prUrl,
      statusCode: "m066_s05_malformed_github_data",
      success: false,
      githubAccess: params.githubAccess,
      artifactCounts,
      issues: metadataIssues,
    });
  }

  if (stateOf(review) !== "COMMENTED") {
    return createBaseReport({
      generatedAt: params.generatedAt,
      repo: params.validated.repo,
      reviewOutputKey: params.validated.reviewOutputKey,
      deliveryId: params.validated.deliveryId,
      prNumber: params.validated.prNumber,
      prUrl: params.collection.prUrl,
      statusCode: "m066_s05_wrong_review_state",
      success: false,
      githubAccess: params.githubAccess,
      reviewId: review.id,
      reviewUrl: review.html_url,
      artifactCounts,
      issues: [`Expected matching pull request review state COMMENTED, found ${stateOf(review) ?? "unavailable"}.`],
    });
  }

  const suggestionComments = params.collection.reviewComments.filter((comment) =>
    comment.pull_request_review_id === review.id && hasSuggestionFence(comment.body));
  artifactCounts.matchingSuggestionComments = suggestionComments.length;

  if (suggestionComments.length === 0) {
    return createBaseReport({
      generatedAt: params.generatedAt,
      repo: params.validated.repo,
      reviewOutputKey: params.validated.reviewOutputKey,
      deliveryId: params.validated.deliveryId,
      prNumber: params.validated.prNumber,
      prUrl: params.collection.prUrl,
      statusCode: "m066_s05_no_suggestion_comment",
      success: false,
      githubAccess: params.githubAccess,
      reviewId: review.id,
      reviewUrl: review.html_url,
      artifactCounts,
      issues: ["No associated review comment for the matching review contains a fenced ```suggestion block."],
    });
  }

  const firstSuggestionComment = suggestionComments[0]!;
  const suggestionMetadataIssues: string[] = [];
  if (typeof firstSuggestionComment.id !== "number") {
    suggestionMetadataIssues.push("First suggestion review comment is missing numeric id.");
  }
  if (!firstSuggestionComment.html_url) {
    suggestionMetadataIssues.push("First suggestion review comment is missing html_url.");
  }

  if (suggestionMetadataIssues.length > 0) {
    return createBaseReport({
      generatedAt: params.generatedAt,
      repo: params.validated.repo,
      reviewOutputKey: params.validated.reviewOutputKey,
      deliveryId: params.validated.deliveryId,
      prNumber: params.validated.prNumber,
      prUrl: params.collection.prUrl,
      statusCode: "m066_s05_malformed_github_data",
      success: false,
      githubAccess: params.githubAccess,
      reviewId: review.id,
      reviewUrl: review.html_url,
      artifactCounts,
      issues: suggestionMetadataIssues,
    });
  }

  return createBaseReport({
    generatedAt: params.generatedAt,
    repo: params.validated.repo,
    reviewOutputKey: params.validated.reviewOutputKey,
    deliveryId: params.validated.deliveryId,
    prNumber: params.validated.prNumber,
    prUrl: params.collection.prUrl,
    statusCode: "m066_s05_ok",
    success: true,
    githubAccess: params.githubAccess,
    reviewId: review.id,
    reviewUrl: review.html_url,
    suggestionCommentId: firstSuggestionComment.id,
    suggestionCommentUrl: firstSuggestionComment.html_url,
    artifactCounts,
    issues: [],
  });
}

export async function evaluateM066S05(params: EvaluateParams): Promise<M066S05Report> {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const validated = validateArgs({
    repo: params.repo,
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
  });

  if ("issues" in validated) {
    const normalizedReviewOutputKey = normalizeIdentifier(params.reviewOutputKey);
    const parsedKey = normalizedReviewOutputKey ? parseReviewOutputKey(normalizedReviewOutputKey) : null;
    return createBaseReport({
      generatedAt,
      repo: normalizeRepo(params.repo) ?? params.repo,
      reviewOutputKey: normalizedReviewOutputKey,
      deliveryId: normalizeIdentifier(params.deliveryId) ?? parsedKey?.effectiveDeliveryId ?? null,
      prNumber: parsedKey?.prNumber ?? null,
      statusCode: "m066_s05_invalid_arg",
      success: false,
      githubAccess: "missing",
      issues: validated.issues,
    });
  }

  let githubAccess = params.githubAccess ?? (hasGitHubEnv() ? "available" : "missing");
  if (githubAccess === "missing") {
    return createBaseReport({
      generatedAt,
      repo: validated.repo,
      reviewOutputKey: validated.reviewOutputKey,
      deliveryId: validated.deliveryId,
      prNumber: validated.prNumber,
      statusCode: "m066_s05_missing_github_access",
      success: false,
      githubAccess,
      issues: ["GitHub App credentials are unavailable for live formatter-suggestion verification."],
    });
  }

  let collection: M066S05ProofCollection;
  try {
    collection = await (params.collectProof ?? collectProofLive)(validated);
  } catch (error) {
    const statusCode = isMissingGitHubAccessError(error)
      ? "m066_s05_missing_github_access"
      : "m066_s05_github_unavailable";
    githubAccess = statusCode === "m066_s05_missing_github_access" ? "missing" : "unavailable";
    return createBaseReport({
      generatedAt,
      repo: validated.repo,
      reviewOutputKey: validated.reviewOutputKey,
      deliveryId: validated.deliveryId,
      prNumber: validated.prNumber,
      statusCode,
      success: false,
      githubAccess,
      issues: [
        statusCode === "m066_s05_missing_github_access"
          ? `GitHub access is unavailable for ${validated.repo}: ${boundedErrorText(error)}`
          : `GitHub formatter-suggestion proof collection failed: ${boundedErrorText(error)}`,
      ],
    });
  }

  return evaluateCollection({
    generatedAt,
    validated,
    githubAccess,
    collection,
  });
}

export function renderM066S05Report(report: M066S05Report): string {
  const lines = [
    "# M066 S05 — Formatter Suggestion Live Verifier",
    "",
    `Status: ${report.status_code}`,
    `Repo: ${report.repo ?? "unavailable"}`,
    `Review output key: ${report.review_output_key ?? "unavailable"}`,
    `Delivery id: ${report.delivery_id ?? "unavailable"}`,
    `Preflight: github=${report.preflight.githubAccess}`,
    `Artifact counts: reviews=${report.artifactCounts.reviews} matching_reviews=${report.artifactCounts.matchingReviews} review_comments=${report.artifactCounts.reviewComments} matching_suggestion_comments=${report.artifactCounts.matchingSuggestionComments}`,
    `Pull request: ${report.proof.pr_url ?? "unavailable"}`,
    `Review ID: ${report.proof.review_id ?? "unavailable"}`,
    `Review URL: ${report.proof.review_url ?? "unavailable"}`,
    `First suggestion comment ID: ${report.proof.first_suggestion_comment_id ?? "unavailable"}`,
    `First suggestion comment URL: ${report.proof.first_suggestion_comment_url ?? "unavailable"}`,
  ];

  if (report.issues.length > 0) {
    lines.push("", "Issues:");
    for (const issue of report.issues) {
      lines.push(`- ${issue}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    githubAccess?: AccessState;
    collectProof?: (params: ValidatedArgs) => Promise<M066S05ProofCollection>;
    evaluate?: (params: { repo: string; reviewOutputKey: string; deliveryId?: string | null }) => Promise<M066S05Report>;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const options = parseVerifyM066S05Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (options.invalidArg) {
    const report = createBaseReport({
      repo: normalizeRepo(options.repo) ?? options.repo,
      reviewOutputKey: normalizeIdentifier(options.reviewOutputKey),
      deliveryId: normalizeIdentifier(options.deliveryId),
      statusCode: "m066_s05_invalid_arg",
      success: false,
      issues: [options.invalidArg],
    });
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM066S05Report(report));
    return 1;
  }

  const validated = validateArgs({
    repo: options.repo,
    reviewOutputKey: options.reviewOutputKey,
    deliveryId: options.deliveryId,
  });
  if ("issues" in validated) {
    const normalizedReviewOutputKey = normalizeIdentifier(options.reviewOutputKey);
    const parsedKey = normalizedReviewOutputKey ? parseReviewOutputKey(normalizedReviewOutputKey) : null;
    const report = createBaseReport({
      repo: normalizeRepo(options.repo) ?? options.repo,
      reviewOutputKey: normalizedReviewOutputKey,
      deliveryId: normalizeIdentifier(options.deliveryId) ?? parsedKey?.effectiveDeliveryId ?? null,
      prNumber: parsedKey?.prNumber ?? null,
      statusCode: "m066_s05_invalid_arg",
      success: false,
      issues: validated.issues,
    });
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM066S05Report(report));
    return 1;
  }

  const report = await (deps?.evaluate ?? ((evaluateParams) => evaluateM066S05({
    repo: evaluateParams.repo,
    reviewOutputKey: evaluateParams.reviewOutputKey,
    deliveryId: evaluateParams.deliveryId,
    githubAccess: deps?.githubAccess,
    collectProof: deps?.collectProof,
  })))(validated);

  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM066S05Report(report));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
