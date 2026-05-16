import pino from "pino";
import { createGitHubApp } from "../src/auth/github-app.ts";
import {
  parseReviewOutputKey,
  type ParsedReviewOutputKey,
} from "../src/handlers/review-idempotency.ts";
import {
  collectReviewOutputArtifacts,
  type ReviewOutputArtifact,
  type ReviewOutputArtifactCollection,
  type ReviewOutputArtifactsOctokit,
} from "../src/review-audit/review-output-artifacts.ts";
import {
  discoverLogAnalyticsWorkspaceIds,
  queryReviewAuditLogs,
  type NormalizedLogAnalyticsRow,
} from "../src/review-audit/log-analytics.ts";
import {
  buildPhaseTimingEvidence,
  REVIEW_PHASE_TIMING_LOG_MESSAGE,
  type PhaseTimingEvidenceResult,
} from "../src/review-audit/phase-timing-evidence.ts";
import {
  evaluateM067S04CandidateSeamContract,
  type M067S04Report,
} from "./verify-m067-s04.ts";

const DEFAULT_REPO = "xbmc/xbmc";
const REQUIRED_PR_NUMBER = 28172;
const DEFAULT_RESOURCE_GROUP = "rg-kodiai";
const MAX_ERROR_TEXT_LENGTH = 240;
const DEFAULT_TIMESPAN = "P14D";
const DEFAULT_QUERY_LIMIT = 200;
const ALLOWED_ACTIONS = new Set(["opened", "ready_for_review", "review_requested", "synchronize"]);
const RAW_LEAK_MARKERS = [
  "rawPrompt",
  "rawDiff",
  "diff --git",
  "TOKEN=",
  "SECRET=",
  "PRIVATE KEY",
  "candidate payload",
];

function rawLeakMarkerLabel(marker: string): string {
  if (marker.includes("TOKEN")) {
    return "raw-leak:credential";
  }
  if (marker.includes("SECRET") || marker.includes("PRIVATE KEY")) {
    return "raw-leak:secret";
  }
  if (marker.includes("diff")) {
    return "raw-leak:diff";
  }
  return "raw-leak:raw-payload";
}

const ANOMALY_MARKERS = [
  "Review plan builder failed",
  "Review reducer degraded",
  "candidate-metadata-missing",
  "sidecar-write-failed",
  "canonical-surface-missing-review-details",
  "review-details-output degraded",
  "degraded review-details-output",
  "raw candidate",
  "candidate payload",
];

export const M067_S05_CHECK_IDS = [
  "M067-S05-KEY-IDENTITY",
  "M067-S05-PUBLICATION-READINESS",
  "M067-S05-GITHUB-VISIBLE-VOLUME",
  "M067-S05-DETAILS-OBSERVABILITY",
  "M067-S05-RUNTIME-LOG-EVIDENCE",
  "M067-S05-NO-ANOMALY-MARKERS",
  "M067-S05-S04-REGRESSION-CONTRACT",
] as const;

export type M067S05CheckId = (typeof M067_S05_CHECK_IDS)[number];
export type AccessState = "available" | "missing" | "unavailable";

export type M067S05StatusCode =
  | "m067_s05_ok"
  | "m067_s05_skipped_missing_review_output_key"
  | "m067_s05_invalid_arg"
  | "m067_s05_missing_github_access"
  | "m067_s05_github_unavailable"
  | "m067_s05_azure_unavailable"
  | "m067_s05_contract_failed";

export type VerifyM067S05Args = {
  help: boolean;
  json: boolean;
  preflightOnly: boolean;
  repo: string;
  reviewOutputKey: string | null;
  deliveryId: string | null;
  invalidArg: string | null;
};

export type M067S05ValidatedArgs = {
  repo: string;
  reviewOutputKey: string;
  evidenceReviewOutputKey: string;
  deliveryId: string;
  parsedKey: ParsedReviewOutputKey;
  parsedEvidenceKey: ParsedReviewOutputKey;
};

export type M067S05PublicationReadinessStatus =
  | "ready"
  | "missing_review_output_key"
  | "wrong_lane"
  | "wrong_repo_or_pr"
  | "github_artifact_unavailable"
  | "review_details_not_published"
  | "duplicate_review_details"
  | "publication_access_blocked";

export type M067S05PublicationReadiness = {
  status: M067S05PublicationReadinessStatus;
  check_id: "M067-S05-PUBLICATION-READINESS";
  artifactCounts: ReviewOutputArtifactCollection["artifactCounts"];
  issue: string;
};

export type M067S05PublicationReadinessReport = {
  publication: M067S05PublicationReadiness;
  validated: M067S05ValidatedArgs | null;
  collection: ReviewOutputArtifactCollection | null;
};

export type M067S05Check = {
  id: M067S05CheckId;
  passed: boolean;
  status_code: string;
  detail: string;
};

export type M067S05DetailsEvidence = {
  marker_count: number;
  review_plan_line_count: number;
  review_reducer_line_count: number;
  review_candidates_line_count: number;
  review_plan_line: string;
  review_reducer_line: string;
  review_candidates_line: string;
};

export type M067S05RuntimeEvidence = {
  sourceAvailability: "present" | "missing" | "unavailable";
  workspaceCount: number;
  matchedRowCount: number;
  malformedRowCount: number;
  driftedRowCount: number;
  duplicatePhaseTimingRowCount: number;
  revisionNames: string[];
  containerAppNames: string[];
  anomalyMarkers: string[];
  signals: {
    reviewPlanReady: boolean;
    reviewReducerReady: boolean;
    candidateExecutorMetadata: boolean;
    reviewDetailsPublication: boolean;
    phaseTimingSummary: boolean;
  };
  phaseTiming: PhaseTimingEvidenceResult;
};

export type M067S05AnomalyEvidence = {
  marker_count: number;
  markers: string[];
};

export type M067S05S04Evidence = {
  success: boolean;
  status_code: M067S04Report["status_code"] | "unavailable";
  check_ids: string[];
  failing_check_id: string | null;
};

export type M067S05Report = {
  command: "verify:m067:s05";
  generated_at: string;
  success: boolean;
  status_code: M067S05StatusCode;
  check_ids: M067S05CheckId[];
  checks: M067S05Check[];
  failing_check_id: M067S05CheckId | null;
  preflight: {
    githubAccess: AccessState;
    azureAccess: AccessState;
    publication: M067S05PublicationReadiness;
  };
  identity: {
    repo: string | null;
    pr_number: number | null;
    action: string | null;
    delivery_id: string | null;
    review_output_key: string | null;
    evidence_review_output_key: string | null;
    retry_attempt: number | null;
  };
  artifactCounts: ReviewOutputArtifactCollection["artifactCounts"];
  proof: {
    pr_url: string | null;
    source: ReviewOutputArtifact["source"] | null;
    source_url: string | null;
    updated_at: string | null;
    review_state: string | null;
  };
  details: M067S05DetailsEvidence;
  runtime: M067S05RuntimeEvidence;
  anomalies: M067S05AnomalyEvidence;
  s04: M067S05S04Evidence;
  issues: string[];
};

type EvaluateParams = {
  repo: string;
  reviewOutputKey: string | null;
  deliveryId?: string | null;
  generatedAt?: string;
  githubAccess?: AccessState;
  azureAccess?: AccessState;
  workspaceIds?: string[];
  collectArtifacts?: (params: M067S05ValidatedArgs) => Promise<ReviewOutputArtifactCollection>;
  discoverWorkspaceIds?: () => Promise<string[]>;
  queryLogs?: (params: {
    workspaceIds: string[];
    reviewOutputKey: string;
    deliveryId: string;
    timespan: string;
    limit: number;
  }) => Promise<{ query: string; rows: NormalizedLogAnalyticsRow[] }>;
  evaluateS04?: () => Promise<M067S04Report>;
};

type LiveOctokit = Awaited<ReturnType<ReturnType<typeof createGitHubApp>["getInstallationOctokit"]>>;

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

export function parseVerifyM067S05Args(args: string[]): VerifyM067S05Args {
  let repo = DEFAULT_REPO;
  let reviewOutputKey: string | null = null;
  let deliveryId: string | null = null;
  let preflightOnly = false;
  let invalidArg: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h" || arg === "--json") {
      continue;
    }

    if (arg === "--preflight-only") {
      preflightOnly = true;
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
    preflightOnly,
    repo,
    reviewOutputKey,
    deliveryId,
    invalidArg,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m067:s05 -- --review-output-key <key> [--repo xbmc/xbmc] [--delivery-id <id>] [--json] [--preflight-only]",
    "",
    "Options:",
    `  --repo               Repository to verify (default: ${DEFAULT_REPO})`,
    "  --review-output-key  Required automatic review-handler reviewOutputKey for xbmc/xbmc#28172",
    "  --delivery-id        Optional delivery id cross-check; must match the encoded key when provided",
    "  --json               Print machine-readable JSON output",
    "  --preflight-only     Run repo/key/publication readiness checks without Azure Log Analytics or S04 evidence lookup",
    "  --help               Show this help",
    "",
    "Checks:",
    "  M067-S05-KEY-IDENTITY             repo/pr/action/delivery identity",
    "  M067-S05-PUBLICATION-READINESS    exact-key Review Details publication preflight status",
    "  M067-S05-GITHUB-VISIBLE-VOLUME    exactly one canonical visible artifact and no candidate-only output",
    "  M067-S05-DETAILS-OBSERVABILITY    exactly one compact plan/reducer/candidate Review Details line",
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

async function collectArtifactsLive(params: M067S05ValidatedArgs): Promise<ReviewOutputArtifactCollection> {
  const live = await createLiveGitHubContext(params.repo);
  return await collectReviewOutputArtifacts({
    octokit: live.octokit as unknown as ReviewOutputArtifactsOctokit,
    reviewOutputKey: params.evidenceReviewOutputKey,
  });
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

function emptyArtifactCounts(): ReviewOutputArtifactCollection["artifactCounts"] {
  return { reviewComments: 0, issueComments: 0, reviews: 0, total: 0 };
}

function emptyPublicationReadiness(status: M067S05PublicationReadinessStatus = "missing_review_output_key", issue = "Publication preflight has not run."): M067S05PublicationReadiness {
  return {
    status,
    check_id: "M067-S05-PUBLICATION-READINESS",
    artifactCounts: emptyArtifactCounts(),
    issue,
  };
}

function emptyDetailsEvidence(): M067S05DetailsEvidence {
  return {
    marker_count: 0,
    review_plan_line_count: 0,
    review_reducer_line_count: 0,
    review_candidates_line_count: 0,
    review_plan_line: "",
    review_reducer_line: "",
    review_candidates_line: "",
  };
}

function emptyPhaseTimingEvidence(reviewOutputKey = "", deliveryId: string | null = null): PhaseTimingEvidenceResult {
  return buildPhaseTimingEvidence({ reviewOutputKey, deliveryId, rows: [] });
}

function emptyRuntimeEvidence(reviewOutputKey = "", deliveryId: string | null = null): M067S05RuntimeEvidence {
  return {
    sourceAvailability: "missing",
    workspaceCount: 0,
    matchedRowCount: 0,
    malformedRowCount: 0,
    driftedRowCount: 0,
    duplicatePhaseTimingRowCount: 0,
    revisionNames: [],
    containerAppNames: [],
    anomalyMarkers: [],
    signals: {
      reviewPlanReady: false,
      reviewReducerReady: false,
      candidateExecutorMetadata: false,
      reviewDetailsPublication: false,
      phaseTimingSummary: false,
    },
    phaseTiming: emptyPhaseTimingEvidence(reviewOutputKey, deliveryId),
  };
}

function emptyAnomalyEvidence(): M067S05AnomalyEvidence {
  return { marker_count: 0, markers: [] };
}

function emptyS04Evidence(): M067S05S04Evidence {
  return { success: false, status_code: "unavailable", check_ids: [], failing_check_id: null };
}

function buildCheck(params: M067S05Check): M067S05Check {
  return params;
}

function deriveOutcome(checks: M067S05Check[]): Pick<M067S05Report, "success" | "status_code" | "failing_check_id" | "issues"> {
  const failing = checks.find((check) => !check.passed) ?? null;
  const issues = checks
    .filter((check) => !check.passed)
    .flatMap((check) => check.detail.split("; ").map((issue) => issue.trim()).filter((issue) => issue.length > 0));
  return {
    success: failing === null,
    status_code: failing === null ? "m067_s05_ok" : "m067_s05_contract_failed",
    failing_check_id: failing?.id ?? null,
    issues,
  };
}

function createBaseReport(params: {
  generatedAt?: string;
  statusCode: M067S05StatusCode;
  success: boolean;
  githubAccess?: AccessState;
  parsedKey?: ParsedReviewOutputKey | null;
  reviewOutputKey?: string | null;
  evidenceReviewOutputKey?: string | null;
  deliveryId?: string | null;
  repo?: string | null;
  artifactCounts?: ReviewOutputArtifactCollection["artifactCounts"];
  publication?: M067S05PublicationReadiness;
  proof?: Partial<M067S05Report["proof"]>;
  details?: M067S05DetailsEvidence;
  runtime?: M067S05RuntimeEvidence;
  anomalies?: M067S05AnomalyEvidence;
  s04?: M067S05S04Evidence;
  checks?: M067S05Check[];
  failingCheckId?: M067S05CheckId | null;
  issues?: string[];
}): M067S05Report {
  return {
    command: "verify:m067:s05",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    success: params.success,
    status_code: params.statusCode,
    check_ids: [...M067_S05_CHECK_IDS],
    checks: params.checks ?? [],
    failing_check_id: params.failingCheckId ?? null,
    preflight: {
      githubAccess: params.githubAccess ?? "missing",
      azureAccess: params.runtime?.sourceAvailability === "unavailable"
        ? "unavailable"
        : params.runtime?.sourceAvailability === "present"
          ? "available"
          : "missing",
      publication: params.publication ?? emptyPublicationReadiness(),
    },
    identity: {
      repo: params.parsedKey?.repoFullName ?? params.repo ?? null,
      pr_number: params.parsedKey?.prNumber ?? null,
      action: params.parsedKey?.action ?? null,
      delivery_id: params.deliveryId ?? params.parsedKey?.effectiveDeliveryId ?? null,
      review_output_key: params.reviewOutputKey ?? params.parsedKey?.reviewOutputKey ?? null,
      evidence_review_output_key: params.evidenceReviewOutputKey ?? params.parsedKey?.baseReviewOutputKey ?? null,
      retry_attempt: params.parsedKey?.retryAttempt ?? null,
    },
    artifactCounts: params.artifactCounts ?? emptyArtifactCounts(),
    proof: {
      pr_url: params.proof?.pr_url ?? null,
      source: params.proof?.source ?? null,
      source_url: params.proof?.source_url ?? null,
      updated_at: params.proof?.updated_at ?? null,
      review_state: params.proof?.review_state ?? null,
    },
    details: params.details ?? emptyDetailsEvidence(),
    runtime: params.runtime ?? emptyRuntimeEvidence(params.evidenceReviewOutputKey ?? params.reviewOutputKey ?? "", params.deliveryId ?? null),
    anomalies: params.anomalies ?? emptyAnomalyEvidence(),
    s04: params.s04 ?? emptyS04Evidence(),
    issues: params.issues ?? [],
  };
}

function validateArgs(params: {
  repo: string;
  reviewOutputKey: string | null | undefined;
  deliveryId?: string | null;
}): M067S05ValidatedArgs | { issues: string[]; parsedKey: ParsedReviewOutputKey | null; normalizedReviewOutputKey: string | null } {
  const issues: string[] = [];
  const normalizedRepo = normalizeRepo(params.repo);
  const normalizedReviewOutputKey = normalizeIdentifier(params.reviewOutputKey);
  const normalizedDeliveryId = normalizeIdentifier(params.deliveryId);

  if (!normalizedReviewOutputKey) {
    issues.push("Missing required --review-output-key.");
    return { issues, parsedKey: null, normalizedReviewOutputKey };
  }

  if (!normalizedRepo) {
    issues.push(`Invalid repo '${params.repo}'. Expected owner/repo.`);
  }

  const parsedKey = parseReviewOutputKey(normalizedReviewOutputKey);
  const parsedEvidenceKey = parsedKey?.baseReviewOutputKey
    ? parseReviewOutputKey(parsedKey.baseReviewOutputKey)
    : null;

  if (!parsedKey || !parsedEvidenceKey) {
    issues.push("Malformed --review-output-key.");
  } else {
    if (normalizedRepo && normalizedRepo !== parsedKey.repoFullName) {
      issues.push("Provided --repo does not match the repository encoded in --review-output-key.");
    }
    if (parsedKey.repoFullName !== DEFAULT_REPO) {
      issues.push("--review-output-key must encode repo=xbmc/xbmc.");
    }
    if (parsedKey.prNumber !== REQUIRED_PR_NUMBER) {
      issues.push("--review-output-key must encode pr=28172.");
    }
    if (!ALLOWED_ACTIONS.has(parsedKey.action)) {
      issues.push("--review-output-key must encode an automatic review action (opened, ready_for_review, review_requested, synchronize).");
    }
    if (normalizedDeliveryId && normalizedDeliveryId !== parsedKey.effectiveDeliveryId) {
      issues.push("Provided --delivery-id does not match the delivery id encoded in --review-output-key.");
    }
    if (
      parsedEvidenceKey.repoFullName !== parsedKey.repoFullName
      || parsedEvidenceKey.prNumber !== parsedKey.prNumber
      || parsedEvidenceKey.action !== parsedKey.action
      || parsedEvidenceKey.headSha !== parsedKey.headSha
    ) {
      issues.push("Normalized retry reviewOutputKey does not preserve repo/pr/action/head identity.");
    }
  }

  if (issues.length > 0) {
    return { issues, parsedKey, normalizedReviewOutputKey };
  }

  return {
    repo: normalizedRepo!,
    reviewOutputKey: parsedKey!.baseReviewOutputKey,
    evidenceReviewOutputKey: parsedKey!.baseReviewOutputKey,
    deliveryId: parsedEvidenceKey!.effectiveDeliveryId,
    parsedKey: parsedKey!,
    parsedEvidenceKey: parsedEvidenceKey!,
  };
}

function classifyValidationIssueForPublication(issue: string): M067S05PublicationReadinessStatus {
  if (issue.includes("Missing required")) {
    return "missing_review_output_key";
  }
  if (issue.includes("automatic review action")) {
    return "wrong_lane";
  }
  if (issue.includes("repo=") || issue.includes("pr=28172") || issue.includes("Provided --repo")) {
    return "wrong_repo_or_pr";
  }
  return "github_artifact_unavailable";
}

function sanitizePublicationIssue(issue: string): string {
  const singleLine = issue.replace(/\s+/g, " ").trim();
  return singleLine.length > 140 ? `${singleLine.slice(0, 140)}…` : singleLine;
}

function buildPublicationReadiness(params: {
  status: M067S05PublicationReadinessStatus;
  artifactCounts?: ReviewOutputArtifactCollection["artifactCounts"];
  issue: string;
}): M067S05PublicationReadiness {
  return {
    status: params.status,
    check_id: "M067-S05-PUBLICATION-READINESS",
    artifactCounts: params.artifactCounts ?? emptyArtifactCounts(),
    issue: sanitizePublicationIssue(params.issue),
  };
}

function inspectPublicationCollection(params: {
  collection: ReviewOutputArtifactCollection;
  reviewOutputKey: string;
}): M067S05PublicationReadiness {
  const { collection, reviewOutputKey } = params;
  const artifact = collection.artifacts[0];

  if (collection.artifacts.length === 0) {
    return buildPublicationReadiness({
      status: "review_details_not_published",
      artifactCounts: collection.artifactCounts,
      issue: "Review Details artifact was not published for the normalized reviewOutputKey.",
    });
  }

  if (collection.artifacts.length !== 1) {
    return buildPublicationReadiness({
      status: "duplicate_review_details",
      artifactCounts: collection.artifactCounts,
      issue: `Expected exactly one Review Details artifact, found ${collection.artifacts.length}.`,
    });
  }

  if (!artifact || artifact.source !== "review" || artifact.reviewState !== "APPROVED" || !artifact.body || !artifact.sourceUrl || !artifact.updatedAt) {
    return buildPublicationReadiness({
      status: "review_details_not_published",
      artifactCounts: collection.artifactCounts,
      issue: "Exact-key artifact did not expose a canonical published Review Details pull request review.",
    });
  }

  const details = inspectDetails(artifact.body, reviewOutputKey);
  if (details.marker_count !== 1 || details.review_plan_line_count !== 1 || details.review_reducer_line_count !== 1 || details.review_candidates_line_count !== 1) {
    return buildPublicationReadiness({
      status: details.marker_count > 1 ? "duplicate_review_details" : "review_details_not_published",
      artifactCounts: collection.artifactCounts,
      issue: `Review Details publication is not canonical: markers=${details.marker_count} plan=${details.review_plan_line_count} reducer=${details.review_reducer_line_count} candidates=${details.review_candidates_line_count}.`,
    });
  }

  return buildPublicationReadiness({
    status: "ready",
    artifactCounts: collection.artifactCounts,
    issue: "Publication preflight ready: exactly one canonical Review Details artifact is available.",
  });
}

export async function evaluateM067S05PublicationReadiness(params: {
  repo: string;
  reviewOutputKey: string | null;
  deliveryId?: string | null;
  githubAccess?: AccessState;
  collectArtifacts?: (params: M067S05ValidatedArgs) => Promise<ReviewOutputArtifactCollection>;
}): Promise<M067S05PublicationReadinessReport> {
  const validated = validateArgs({ repo: params.repo, reviewOutputKey: params.reviewOutputKey, deliveryId: params.deliveryId });
  if ("issues" in validated) {
    const status = classifyValidationIssueForPublication(validated.issues[0] ?? "Invalid publication preflight input.");
    return {
      publication: buildPublicationReadiness({ status, issue: validated.issues.join("; ") }),
      validated: null,
      collection: null,
    };
  }

  const githubAccess = params.githubAccess ?? (params.collectArtifacts ? "available" : hasGitHubEnv() ? "available" : "missing");
  if (githubAccess === "missing") {
    return {
      publication: buildPublicationReadiness({
        status: "publication_access_blocked",
        issue: "GitHub App credentials are unavailable for publication preflight.",
      }),
      validated,
      collection: null,
    };
  }

  let collection: ReviewOutputArtifactCollection;
  try {
    collection = await (params.collectArtifacts ?? collectArtifactsLive)(validated);
  } catch (error) {
    return {
      publication: buildPublicationReadiness({
        status: isMissingGitHubAccessError(error) ? "publication_access_blocked" : "github_artifact_unavailable",
        issue: `GitHub artifact publication preflight failed: ${boundedErrorText(error)}`,
      }),
      validated,
      collection: null,
    };
  }

  return {
    publication: inspectPublicationCollection({ collection, reviewOutputKey: validated.evidenceReviewOutputKey }),
    validated,
    collection,
  };
}

function countOccurrences(value: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  return value.split(needle).length - 1;
}

function inspectDetails(body: string | null | undefined, reviewOutputKey: string): M067S05DetailsEvidence {
  const text = typeof body === "string" ? body : "";
  const lines = text.split("\n").map((line) => line.trim());
  const planLines = lines.filter((line) => line.includes("Review plan:"));
  const reducerLines = lines.filter((line) => line.includes("Review reducer:"));
  const candidateLines = lines.filter((line) => line.includes("Review candidates:"));

  return {
    marker_count: countOccurrences(text, `<!-- kodiai:review-details:${reviewOutputKey} -->`),
    review_plan_line_count: planLines.length,
    review_reducer_line_count: reducerLines.length,
    review_candidates_line_count: candidateLines.length,
    review_plan_line: planLines[0] ?? "",
    review_reducer_line: reducerLines[0] ?? "",
    review_candidates_line: candidateLines[0] ?? "",
  };
}

function hasRawLeak(value: string): boolean {
  return RAW_LEAK_MARKERS.some((marker) => value.includes(marker));
}

function buildIdentityCheck(validated: M067S05ValidatedArgs): M067S05Check {
  const failures = [
    ...(validated.parsedKey.repoFullName !== DEFAULT_REPO ? [`repo was ${validated.parsedKey.repoFullName}`] : []),
    ...(validated.parsedKey.prNumber !== REQUIRED_PR_NUMBER ? [`pr was ${validated.parsedKey.prNumber}`] : []),
    ...(!ALLOWED_ACTIONS.has(validated.parsedKey.action) ? [`action was ${validated.parsedKey.action}`] : []),
  ];

  return buildCheck({
    id: "M067-S05-KEY-IDENTITY",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "key_identity_ok" : "key_identity_invalid",
    detail: failures.length === 0
      ? `reviewOutputKey identity accepted repo=${DEFAULT_REPO} pr=${REQUIRED_PR_NUMBER} action=${validated.parsedKey.action}`
      : failures.join("; "),
  });
}

function buildPublicationReadinessCheck(publication: M067S05PublicationReadiness): M067S05Check {
  return buildCheck({
    id: "M067-S05-PUBLICATION-READINESS",
    passed: publication.status === "ready",
    status_code: publication.status,
    detail: publication.issue,
  });
}

function buildVisibleVolumeCheck(collection: ReviewOutputArtifactCollection): M067S05Check {
  const failures: string[] = [];
  const total = collection.artifacts.length;

  if (total === 0) {
    failures.push("No GitHub artifacts matched the normalized reviewOutputKey.");
  }
  if (total !== 1) {
    failures.push(`Expected exactly one visible GitHub artifact for reviewOutputKey, found ${total} (reviewComments=${collection.artifactCounts.reviewComments} issueComments=${collection.artifactCounts.issueComments} reviews=${collection.artifactCounts.reviews}).`);
  }

  const artifact = collection.artifacts[0];
  if (artifact) {
    if (!artifact.sourceUrl) {
      failures.push("Matching artifact is missing sourceUrl.");
    }
    if (!artifact.updatedAt) {
      failures.push("Matching artifact is missing updatedAt timestamp.");
    }
    if (!artifact.body) {
      failures.push("Matching artifact is missing body.");
    }
    if (artifact.source !== "review") {
      failures.push(`Expected canonical Review Details artifact to be a pull request review, found ${artifact.source}; candidate-only GitHub artifact is not accepted.`);
    }
    if (artifact.source === "review" && artifact.reviewState !== "APPROVED") {
      failures.push(`Expected matching review artifact state APPROVED, found ${artifact.reviewState ?? "unavailable"}.`);
    }
  }

  return buildCheck({
    id: "M067-S05-GITHUB-VISIBLE-VOLUME",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "github_visible_volume_ok" : "github_visible_volume_invalid",
    detail: failures.length === 0
      ? "exact-key GitHub-visible output contains exactly one canonical pull request review artifact"
      : failures.join("; "),
  });
}

function buildDetailsObservabilityCheck(details: M067S05DetailsEvidence): M067S05Check {
  const lineCountFailures = [
    ...(details.marker_count !== 1 ? [`expected exactly one Review Details marker, found ${details.marker_count}`] : []),
    ...(details.review_plan_line_count !== 1 ? [`expected exactly one compact Review plan line, found ${details.review_plan_line_count}`] : []),
    ...(details.review_reducer_line_count !== 1 ? [`expected exactly one compact Review reducer line, found ${details.review_reducer_line_count}`] : []),
    ...(details.review_candidates_line_count !== 1 ? [`expected exactly one compact Review candidates line, found ${details.review_candidates_line_count}`] : []),
  ];
  const lineFailures = [
    ...(!details.review_plan_line.startsWith("- Review plan: ready") ? ["Review plan line must use ready prefix"] : []),
    ...(!details.review_plan_line.includes("graph=") ? ["Review plan line must include graph status"] : []),
    ...(!details.review_plan_line.includes("candidates=shadow") ? ["Review plan line must include candidates=shadow"] : []),
    ...(!details.review_reducer_line.startsWith("- Review reducer: ready") ? ["Review reducer line must use ready prefix"] : []),
    ...(!details.review_candidates_line.startsWith("- Review candidates: shadow") ? ["Review candidates line must use shadow prefix"] : []),
  ];
  const boundedFailures = [details.review_plan_line, details.review_reducer_line, details.review_candidates_line]
    .filter((line) => line.length > 240)
    .map((line) => `Review Details compact line is too long (${line.length} chars).`);
  const leakFailures = [details.review_plan_line, details.review_reducer_line, details.review_candidates_line].some((line) => hasRawLeak(line))
    ? ["Review Details leaked raw prompt, diff, candidate payload, token, secret, or object data"]
    : [];
  const failures = [...lineCountFailures, ...lineFailures, ...boundedFailures, ...leakFailures];

  return buildCheck({
    id: "M067-S05-DETAILS-OBSERVABILITY",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "details_observability_ok" : "details_observability_invalid",
    detail: failures.length === 0
      ? "Review Details contains exactly one compact plan, reducer, and candidate line with no raw data leaks"
      : failures.join("; "),
  });
}

function normalizedSet(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))].sort();
}

function rowText(row: NormalizedLogAnalyticsRow): string {
  return [row.message, row.rawLog].filter((value): value is string => typeof value === "string").join("\n");
}

function rowMatchesCorrelation(row: NormalizedLogAnalyticsRow, reviewOutputKey: string, deliveryId: string): boolean {
  const normalizedReviewOutputKey = reviewOutputKey.toLowerCase();
  const normalizedDeliveryId = deliveryId.toLowerCase();
  if (row.reviewOutputKey || row.deliveryId) {
    return row.reviewOutputKey?.toLowerCase() === normalizedReviewOutputKey
      && row.deliveryId?.toLowerCase() === normalizedDeliveryId;
  }
  const haystack = rowText(row).toLowerCase();
  return haystack.includes(normalizedReviewOutputKey) && haystack.includes(normalizedDeliveryId);
}

function inspectRuntimeEvidence(params: {
  reviewOutputKey: string;
  deliveryId: string;
  workspaceCount: number;
  rows: NormalizedLogAnalyticsRow[];
  unavailable?: boolean;
}): M067S05RuntimeEvidence {
  const correlatedRows = params.rows.filter((row) => rowMatchesCorrelation(row, params.reviewOutputKey, params.deliveryId));
  const phaseTiming = buildPhaseTimingEvidence({
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
    rows: correlatedRows,
  });
  const text = correlatedRows.map(rowText).join("\n");
  const anomalyMarkers = [
    ...ANOMALY_MARKERS.filter((marker) => text.includes(marker)),
    ...RAW_LEAK_MARKERS.filter((marker) => text.includes(marker)).map(rawLeakMarkerLabel),
  ];

  return {
    sourceAvailability: params.unavailable ? "unavailable" : correlatedRows.length > 0 ? "present" : "missing",
    workspaceCount: params.workspaceCount,
    matchedRowCount: correlatedRows.length,
    malformedRowCount: correlatedRows.filter((row) => row.malformed).length,
    driftedRowCount: params.rows.length - correlatedRows.length,
    duplicatePhaseTimingRowCount: phaseTiming.correlation.duplicateRowCount,
    revisionNames: normalizedSet(correlatedRows.map((row) => row.revisionName)),
    containerAppNames: normalizedSet(correlatedRows.map((row) => row.containerAppName)),
    anomalyMarkers: [...new Set(anomalyMarkers)].sort(),
    signals: {
      reviewPlanReady: text.includes("ReviewPlan") || text.includes("Review plan: ready") || text.includes("review_plan_ready"),
      reviewReducerReady: text.includes("ReviewReducer") || text.includes("Review reducer: ready") || text.includes("review_reducer_ready"),
      candidateExecutorMetadata: text.includes("candidate executor metadata") || text.includes("candidateExecutorMetadata") || text.includes("Review candidates: shadow"),
      reviewDetailsPublication: text.includes("Review Details publication") || text.includes("review-details-output") || text.includes("published Review Details"),
      phaseTimingSummary: phaseTiming.status === "ok",
    },
    phaseTiming,
  };
}

function buildRuntimeEvidenceCheck(runtime: M067S05RuntimeEvidence): M067S05Check {
  const failures = [
    ...(runtime.sourceAvailability === "unavailable" ? ["Azure Log Analytics unavailable for runtime evidence."] : []),
    ...(runtime.matchedRowCount === 0 ? ["No correlated runtime log rows matched reviewOutputKey and deliveryId."] : []),
    ...(runtime.malformedRowCount > 0 ? [`Malformed runtime log rows found: ${runtime.malformedRowCount}.`] : []),
    ...(!runtime.signals.reviewPlanReady ? ["Missing ReviewPlan ready runtime signal."] : []),
    ...(!runtime.signals.reviewReducerReady ? ["Missing ReviewReducer ready runtime signal."] : []),
    ...(!runtime.signals.candidateExecutorMetadata ? ["Missing candidate executor metadata runtime signal."] : []),
    ...(!runtime.signals.reviewDetailsPublication ? ["Missing Review Details publication runtime signal."] : []),
    ...(!runtime.signals.phaseTimingSummary ? ["Missing valid Review phase timing summary runtime signal."] : []),
    ...runtime.phaseTiming.issues,
  ];

  return buildCheck({
    id: "M067-S05-RUNTIME-LOG-EVIDENCE",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "runtime_log_evidence_ok" : "runtime_log_evidence_invalid",
    detail: failures.length === 0
      ? `runtime logs include plan/reducer/candidate/publication/phase timing signals across ${runtime.matchedRowCount} correlated rows`
      : failures.join("; "),
  });
}

function inspectAnomalies(params: { detailsText: string; rows?: NormalizedLogAnalyticsRow[]; markerHints?: string[] }): M067S05AnomalyEvidence {
  const text = `${params.detailsText}\n${params.rows?.map(rowText).join("\n") ?? ""}`;
  const markers = ANOMALY_MARKERS.filter((marker) => text.includes(marker));
  const rawLeaks = RAW_LEAK_MARKERS.filter((marker) => text.includes(marker)).map(rawLeakMarkerLabel);
  const unique = [...new Set([...(params.markerHints ?? []), ...markers, ...rawLeaks])].sort();
  return { marker_count: unique.length, markers: unique };
}

function buildNoAnomalyCheck(anomalies: M067S05AnomalyEvidence): M067S05Check {
  return buildCheck({
    id: "M067-S05-NO-ANOMALY-MARKERS",
    passed: anomalies.marker_count === 0,
    status_code: anomalies.marker_count === 0 ? "no_anomaly_markers" : "anomaly_markers_found",
    detail: anomalies.marker_count === 0
      ? "no anomaly markers or raw candidate leakage found in Review Details or correlated logs"
      : `found anomaly markers: ${anomalies.markers.join(", ")}`,
  });
}

function buildS04Evidence(report: M067S04Report): M067S05S04Evidence {
  return {
    success: report.success,
    status_code: report.status_code,
    check_ids: report.check_ids.slice(0, 20),
    failing_check_id: report.failing_check_id,
  };
}

function buildS04RegressionCheck(s04: M067S05S04Evidence): M067S05Check {
  const failures = [
    ...(!s04.success ? [`S04 verifier status=${s04.status_code} failing=${s04.failing_check_id ?? "none"}`] : []),
    ...(s04.check_ids.length === 0 ? ["S04 verifier did not expose bounded check ids."] : []),
  ];
  return buildCheck({
    id: "M067-S05-S04-REGRESSION-CONTRACT",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "s04_regression_contract_ok" : "s04_regression_contract_failed",
    detail: failures.length === 0
      ? `S04 shadow candidate seam remains green (${s04.check_ids.length} check ids)`
      : failures.join("; "),
  });
}

function getAzureLogResourceGroup(): string {
  return process.env.ACA_RESOURCE_GROUP ?? DEFAULT_RESOURCE_GROUP;
}

function explicitWorkspaceIdsFromEnv(): string[] | undefined {
  const ids = process.env.AZURE_LOG_WORKSPACE_IDS
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return ids && ids.length > 0 ? ids : undefined;
}

async function discoverAuditWorkspaceIds(): Promise<string[]> {
  return discoverLogAnalyticsWorkspaceIds({
    resourceGroup: getAzureLogResourceGroup(),
    explicitWorkspaceIds: explicitWorkspaceIdsFromEnv(),
  });
}

async function collectRuntimeEvidence(params: {
  validated: M067S05ValidatedArgs;
  workspaceIds?: string[];
  discoverWorkspaceIds?: () => Promise<string[]>;
  queryLogs?: EvaluateParams["queryLogs"];
}): Promise<M067S05RuntimeEvidence> {
  let workspaceIds = params.workspaceIds ?? [];
  if (!params.workspaceIds) {
    workspaceIds = await (params.discoverWorkspaceIds ?? discoverAuditWorkspaceIds)();
  }

  const queryResult = await (params.queryLogs ?? ((queryParams) => queryReviewAuditLogs({
    workspaceIds: queryParams.workspaceIds,
    reviewOutputKey: queryParams.reviewOutputKey,
    deliveryId: queryParams.deliveryId,
    timespan: queryParams.timespan,
    limit: queryParams.limit,
  })))({
    workspaceIds,
    reviewOutputKey: params.validated.evidenceReviewOutputKey,
    deliveryId: params.validated.deliveryId,
    timespan: DEFAULT_TIMESPAN,
    limit: DEFAULT_QUERY_LIMIT,
  });

  return inspectRuntimeEvidence({
    reviewOutputKey: params.validated.evidenceReviewOutputKey,
    deliveryId: params.validated.deliveryId,
    workspaceCount: workspaceIds.length,
    rows: queryResult.rows,
  });
}

function unavailableRuntimeEvidence(params: { reviewOutputKey: string; deliveryId: string; workspaceCount?: number }): M067S05RuntimeEvidence {
  return inspectRuntimeEvidence({
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
    workspaceCount: params.workspaceCount ?? 0,
    rows: [],
    unavailable: true,
  });
}

function buildAzureUnavailableReport(params: {
  generatedAt: string;
  githubAccess: AccessState;
  validated: M067S05ValidatedArgs;
  error: unknown;
}): M067S05Report {
  const runtime = unavailableRuntimeEvidence({
    reviewOutputKey: params.validated.evidenceReviewOutputKey,
    deliveryId: params.validated.deliveryId,
  });
  const identityCheck = buildIdentityCheck(params.validated);
  const runtimeCheck = buildRuntimeEvidenceCheck(runtime);
  return createBaseReport({
    generatedAt: params.generatedAt,
    statusCode: "m067_s05_azure_unavailable",
    success: false,
    githubAccess: params.githubAccess,
    parsedKey: params.validated.parsedKey,
    reviewOutputKey: params.validated.reviewOutputKey,
    evidenceReviewOutputKey: params.validated.evidenceReviewOutputKey,
    deliveryId: params.validated.deliveryId,
    runtime,
    checks: [identityCheck, runtimeCheck],
    failingCheckId: "M067-S05-RUNTIME-LOG-EVIDENCE",
    issues: [`Azure Log Analytics unavailable: ${boundedErrorText(params.error)}`],
  });
}

function evaluateCollection(params: {
  generatedAt: string;
  validated: M067S05ValidatedArgs;
  githubAccess: AccessState;
  collection: ReviewOutputArtifactCollection;
  publication?: M067S05PublicationReadiness;
  runtime: M067S05RuntimeEvidence;
  s04: M067S05S04Evidence;
}): M067S05Report {
  const identityCheck = buildIdentityCheck(params.validated);
  const publication = params.publication ?? inspectPublicationCollection({ collection: params.collection, reviewOutputKey: params.validated.evidenceReviewOutputKey });
  const publicationCheck = buildPublicationReadinessCheck(publication);
  const visibleVolumeCheck = buildVisibleVolumeCheck(params.collection);
  const artifact = params.collection.artifacts.length === 1 ? params.collection.artifacts[0]! : null;
  const details = inspectDetails(artifact?.body, params.validated.evidenceReviewOutputKey);
  const detailsCheck = buildDetailsObservabilityCheck(details);
  const runtimeCheck = buildRuntimeEvidenceCheck(params.runtime);
  const anomalies = inspectAnomalies({ detailsText: artifact?.body ?? "", markerHints: params.runtime.anomalyMarkers });
  const anomalyCheck = buildNoAnomalyCheck(anomalies);
  const s04Check = buildS04RegressionCheck(params.s04);
  const checks = [identityCheck, publicationCheck, visibleVolumeCheck, detailsCheck, runtimeCheck, anomalyCheck, s04Check];
  const outcome = deriveOutcome(checks);

  return createBaseReport({
    generatedAt: params.generatedAt,
    statusCode: outcome.status_code,
    success: outcome.success,
    githubAccess: params.githubAccess,
    parsedKey: params.validated.parsedKey,
    reviewOutputKey: params.validated.reviewOutputKey,
    evidenceReviewOutputKey: params.validated.evidenceReviewOutputKey,
    deliveryId: params.validated.deliveryId,
    artifactCounts: params.collection.artifactCounts,
    publication,
    proof: {
      pr_url: params.collection.prUrl,
      source: artifact?.source ?? null,
      source_url: artifact?.sourceUrl ?? null,
      updated_at: artifact?.updatedAt ?? null,
      review_state: artifact?.reviewState ?? null,
    },
    details,
    runtime: params.runtime,
    anomalies,
    s04: params.s04,
    checks,
    failingCheckId: outcome.failing_check_id,
    issues: outcome.issues,
  });
}

export async function evaluateM067S05IntegratedProof(params: EvaluateParams): Promise<M067S05Report> {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const validated = validateArgs({
    repo: params.repo,
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
  });

  if ("issues" in validated) {
    return createBaseReport({
      generatedAt,
      statusCode: "m067_s05_invalid_arg",
      success: false,
      githubAccess: "missing",
      parsedKey: validated.parsedKey,
      reviewOutputKey: validated.normalizedReviewOutputKey,
      evidenceReviewOutputKey: validated.parsedKey?.baseReviewOutputKey ?? null,
      deliveryId: normalizeIdentifier(params.deliveryId) ?? validated.parsedKey?.effectiveDeliveryId ?? null,
      repo: normalizeRepo(params.repo) ?? params.repo,
      failingCheckId: "M067-S05-KEY-IDENTITY",
      checks: [buildCheck({
        id: "M067-S05-KEY-IDENTITY",
        passed: false,
        status_code: "key_identity_invalid",
        detail: validated.issues.join("; "),
      })],
      issues: validated.issues,
    });
  }

  let githubAccess = params.githubAccess ?? (params.collectArtifacts ? "available" : hasGitHubEnv() ? "available" : "missing");
  if (githubAccess === "missing") {
    return createBaseReport({
      generatedAt,
      statusCode: "m067_s05_missing_github_access",
      success: false,
      githubAccess,
      parsedKey: validated.parsedKey,
      reviewOutputKey: validated.reviewOutputKey,
      evidenceReviewOutputKey: validated.evidenceReviewOutputKey,
      deliveryId: validated.deliveryId,
      failingCheckId: "M067-S05-PUBLICATION-READINESS",
      publication: buildPublicationReadiness({
        status: "publication_access_blocked",
        issue: "GitHub App credentials are unavailable for live M067 S05 verification.",
      }),
      issues: ["GitHub App credentials are unavailable for live M067 S05 verification."],
    });
  }

  let collection: ReviewOutputArtifactCollection;
  let publication: M067S05PublicationReadiness;
  try {
    collection = await (params.collectArtifacts ?? collectArtifactsLive)(validated);
    publication = inspectPublicationCollection({ collection, reviewOutputKey: validated.evidenceReviewOutputKey });
  } catch (error) {
    const statusCode = isMissingGitHubAccessError(error)
      ? "m067_s05_missing_github_access"
      : "m067_s05_github_unavailable";
    githubAccess = statusCode === "m067_s05_missing_github_access" ? "missing" : "unavailable";
    return createBaseReport({
      generatedAt,
      statusCode,
      success: false,
      githubAccess,
      parsedKey: validated.parsedKey,
      reviewOutputKey: validated.reviewOutputKey,
      evidenceReviewOutputKey: validated.evidenceReviewOutputKey,
      deliveryId: validated.deliveryId,
      failingCheckId: "M067-S05-PUBLICATION-READINESS",
      publication: buildPublicationReadiness({
        status: statusCode === "m067_s05_missing_github_access" ? "publication_access_blocked" : "github_artifact_unavailable",
        issue: statusCode === "m067_s05_missing_github_access"
          ? `GitHub access is unavailable for ${validated.repo}: ${boundedErrorText(error)}`
          : `GitHub artifact collection failed: ${boundedErrorText(error)}`,
      }),
      issues: [
        statusCode === "m067_s05_missing_github_access"
          ? `GitHub access is unavailable for ${validated.repo}: ${boundedErrorText(error)}`
          : `GitHub artifact collection failed: ${boundedErrorText(error)}`,
      ],
    });
  }

  let runtime: M067S05RuntimeEvidence;
  try {
    runtime = await collectRuntimeEvidence({
      validated,
      workspaceIds: params.workspaceIds,
      discoverWorkspaceIds: params.discoverWorkspaceIds,
      queryLogs: params.queryLogs,
    });
  } catch (error) {
    return buildAzureUnavailableReport({ generatedAt, githubAccess, validated, error });
  }

  let s04: M067S05S04Evidence;
  try {
    s04 = buildS04Evidence(await (params.evaluateS04 ?? evaluateM067S04CandidateSeamContract)());
  } catch (error) {
    s04 = { success: false, status_code: "unavailable", check_ids: [], failing_check_id: "M067-S05-S04-REGRESSION-CONTRACT" };
  }

  return evaluateCollection({
    generatedAt,
    validated,
    githubAccess,
    collection,
    publication,
    runtime,
    s04,
  });
}

function buildPreflightOnlyReport(params: {
  generatedAt?: string;
  repo: string;
  reviewOutputKey: string | null;
  deliveryId?: string | null;
  readiness: M067S05PublicationReadinessReport;
  githubAccess?: AccessState;
}): M067S05Report {
  const publication = params.readiness.publication;
  const success = publication.status === "ready" || publication.status === "missing_review_output_key";
  const statusCode: M067S05StatusCode = publication.status === "ready"
    ? "m067_s05_ok"
    : publication.status === "missing_review_output_key"
      ? "m067_s05_skipped_missing_review_output_key"
      : "m067_s05_contract_failed";
  const check = buildPublicationReadinessCheck(publication);
  const validated = params.readiness.validated;
  const artifact = params.readiness.collection?.artifacts.length === 1 ? params.readiness.collection.artifacts[0]! : null;

  return createBaseReport({
    generatedAt: params.generatedAt,
    statusCode,
    success,
    githubAccess: params.githubAccess ?? (publication.status === "publication_access_blocked" ? "missing" : "available"),
    parsedKey: validated?.parsedKey ?? null,
    reviewOutputKey: validated?.reviewOutputKey ?? normalizeIdentifier(params.reviewOutputKey),
    evidenceReviewOutputKey: validated?.evidenceReviewOutputKey ?? null,
    deliveryId: validated?.deliveryId ?? normalizeIdentifier(params.deliveryId),
    repo: normalizeRepo(params.repo) ?? params.repo,
    artifactCounts: publication.artifactCounts,
    publication,
    proof: {
      pr_url: params.readiness.collection?.prUrl ?? null,
      source: artifact?.source ?? null,
      source_url: artifact?.sourceUrl ?? null,
      updated_at: artifact?.updatedAt ?? null,
      review_state: artifact?.reviewState ?? null,
    },
    checks: [check],
    failingCheckId: check.passed ? null : "M067-S05-PUBLICATION-READINESS",
    issues: check.passed ? (publication.status === "missing_review_output_key" ? [publication.issue] : []) : [publication.issue],
  });
}

export function renderM067S05Report(report: M067S05Report): string {
  const lines = [
    "# M067 S05 — Integrated Review Orchestration Verifier",
    "",
    `Status: ${report.status_code}`,
    `Success: ${report.success ? "yes" : "no"}`,
    `Failing check: ${report.failing_check_id ?? "none"}`,
    `Repo: ${report.identity.repo ?? "unavailable"}`,
    `PR: ${report.identity.pr_number ?? "unavailable"}`,
    `Action: ${report.identity.action ?? "unavailable"}`,
    `Review output key: ${report.identity.review_output_key ?? "unavailable"}`,
    `Evidence review output key: ${report.identity.evidence_review_output_key ?? "unavailable"}`,
    `Delivery id: ${report.identity.delivery_id ?? "unavailable"}`,
    `Preflight: github=${report.preflight.githubAccess} azure=${report.preflight.azureAccess} publication=${report.preflight.publication.status} publication_check=${report.preflight.publication.check_id}`,
    `Artifact counts: review_comments=${report.artifactCounts.reviewComments} issue_comments=${report.artifactCounts.issueComments} reviews=${report.artifactCounts.reviews} total=${report.artifactCounts.total}`,
    `Details counts: markers=${report.details.marker_count} plan=${report.details.review_plan_line_count} reducer=${report.details.review_reducer_line_count} candidates=${report.details.review_candidates_line_count}`,
    `Runtime logs: availability=${report.runtime.sourceAvailability} workspaces=${report.runtime.workspaceCount} matched_rows=${report.runtime.matchedRowCount} malformed_rows=${report.runtime.malformedRowCount} drifted_rows=${report.runtime.driftedRowCount}`,
    `Runtime signals: plan=${String(report.runtime.signals.reviewPlanReady)} reducer=${String(report.runtime.signals.reviewReducerReady)} candidates=${String(report.runtime.signals.candidateExecutorMetadata)} publication=${String(report.runtime.signals.reviewDetailsPublication)} phase_timing=${String(report.runtime.signals.phaseTimingSummary)}`,
    `Runtime revisions: ${report.runtime.revisionNames.join(",") || "unavailable"}`,
    `Runtime apps: ${report.runtime.containerAppNames.join(",") || "unavailable"}`,
    `Anomalies: count=${report.anomalies.marker_count}`,
    `S04 regression: status=${report.s04.status_code} success=${String(report.s04.success)} failing=${report.s04.failing_check_id ?? "none"}`,
    `Pull request: ${report.proof.pr_url ?? "unavailable"}`,
    `Artifact source: ${report.proof.source ?? "unavailable"}`,
    `Artifact URL: ${report.proof.source_url ?? "unavailable"}`,
    `Artifact updated: ${report.proof.updated_at ?? "unavailable"}`,
    `Review state: ${report.proof.review_state ?? "unavailable"}`,
    "",
    "Checks:",
    ...report.checks.map((check) => `- ${check.id}: ${check.passed ? "pass" : "fail"} (${check.status_code}) ${check.detail}`),
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
    collectArtifacts?: (params: M067S05ValidatedArgs) => Promise<ReviewOutputArtifactCollection>;
    evaluate?: (params: { repo: string; reviewOutputKey: string | null; deliveryId?: string | null }) => Promise<M067S05Report>;
    discoverWorkspaceIds?: () => Promise<string[]>;
    queryLogs?: EvaluateParams["queryLogs"];
    evaluateS04?: () => Promise<M067S04Report>;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const options = parseVerifyM067S05Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (options.invalidArg) {
    const report = createBaseReport({
      statusCode: "m067_s05_invalid_arg",
      success: false,
      repo: normalizeRepo(options.repo) ?? options.repo,
      reviewOutputKey: normalizeIdentifier(options.reviewOutputKey),
      deliveryId: normalizeIdentifier(options.deliveryId),
      failingCheckId: "M067-S05-KEY-IDENTITY",
      checks: [buildCheck({
        id: "M067-S05-KEY-IDENTITY",
        passed: false,
        status_code: "key_identity_invalid",
        detail: options.invalidArg,
      })],
      issues: [options.invalidArg],
    });
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM067S05Report(report));
    return 1;
  }

  if (options.preflightOnly) {
    const readiness = await evaluateM067S05PublicationReadiness({
      repo: options.repo,
      reviewOutputKey: options.reviewOutputKey,
      deliveryId: options.deliveryId,
      githubAccess: deps?.githubAccess,
      collectArtifacts: deps?.collectArtifacts,
    });
    const report = buildPreflightOnlyReport({
      repo: options.repo,
      reviewOutputKey: options.reviewOutputKey,
      deliveryId: options.deliveryId,
      readiness,
      githubAccess: deps?.githubAccess,
    });
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM067S05Report(report));
    return report.success ? 0 : 1;
  }

  if (!normalizeIdentifier(options.reviewOutputKey)) {
    const report = createBaseReport({
      statusCode: "m067_s05_skipped_missing_review_output_key",
      success: true,
      repo: normalizeRepo(options.repo) ?? options.repo,
      reviewOutputKey: null,
      deliveryId: normalizeIdentifier(options.deliveryId),
      publication: emptyPublicationReadiness("missing_review_output_key", "No review output key provided; skipped live M067 S05 verification."),
      issues: ["No review output key provided; skipped live M067 S05 verification."],
    });
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM067S05Report(report));
    return 0;
  }

  const report = await (deps?.evaluate ?? ((evaluateParams) => evaluateM067S05IntegratedProof({
    repo: evaluateParams.repo,
    reviewOutputKey: evaluateParams.reviewOutputKey,
    deliveryId: evaluateParams.deliveryId,
    githubAccess: deps?.githubAccess,
    collectArtifacts: deps?.collectArtifacts,
    discoverWorkspaceIds: deps?.discoverWorkspaceIds,
    queryLogs: deps?.queryLogs,
    evaluateS04: deps?.evaluateS04,
  })))(options);

  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM067S05Report(report));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
