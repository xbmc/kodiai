import {
  evaluateM068S01CandidateApprovalContract,
  M068_S01_CHECK_IDS,
  type M068S01Report,
} from "./verify-m068-s01.ts";
import {
  evaluateM068S02InlinePublisherContract,
  M068_S02_CHECK_IDS,
  type M068S02Report,
} from "./verify-m068-s02.ts";
import {
  evaluateM068S03ClosureContract,
  M068_S03_CHECK_IDS,
} from "./verify-m068-s03.ts";
import { buildReviewOutputMarker, parseReviewOutputKey, type ParsedReviewOutputKey } from "../src/review-orchestration/review-idempotency.ts";
import { buildReviewDetailsMarker } from "../src/lib/review-utils.ts";
import pino from "pino";
import { createGitHubApp } from "../src/auth/github-app.ts";
import {
  discoverLogAnalyticsWorkspaceIds,
  queryReviewAuditLogs as queryLogAnalyticsReviewAuditLogs,
  type NormalizedLogAnalyticsRow,
} from "../src/review-audit/log-analytics.ts";
import {
  collectReviewOutputArtifacts,
  type ReviewOutputArtifact,
  type ReviewOutputArtifactCollection,
  type ReviewOutputArtifactsOctokit,
} from "../src/review-audit/review-output-artifacts.ts";

type M068S03Report = Awaited<ReturnType<typeof evaluateM068S03ClosureContract>>;

type NestedCommand = "verify:m068:s01" | "verify:m068:s02" | "verify:m068:s03";
type NestedReport = M068S01Report | M068S02Report | M068S03Report;

export const M068_CHECK_IDS = [
  "M068-LOCAL-PREREQUISITES",
  "M068-EXACT-TARGET-PREFLIGHT",
  "M068-REDUCER-ADAPTER-PUBLICATION-STATE",
  "M068-CANDIDATE-PATH-PROOF",
  "M068-REVIEW-DETAILS-EVIDENCE",
  "M068-DIRECT-FALLBACK-REJECTED",
  "M068-GITHUB-VISIBLE-VOLUME",
  "M068-RUNTIME-LOG-EVIDENCE",
  "M068-BOUNDED-EVIDENCE",
] as const;

export type M068CheckId = (typeof M068_CHECK_IDS)[number];

export type M068StatusCode =
  | "m068_ok"
  | "m068_skipped_missing_review_output_key"
  | "m068_pending_live_evidence"
  | "m068_local_prerequisites_failed"
  | "m068_invalid_arg"
  | "m068_contract_failed";

export type M068CheckStatusCode =
  | "local_prerequisites_ok"
  | "local_prerequisite_failed"
  | "local_prerequisite_malformed"
  | "exact_target_ok"
  | "exact_target_skipped_missing_review_output_key"
  | "invalid_target"
  | "invalid_review_output_key"
  | "preflight_skipped_missing_review_output_key"
  | "preflight_skipped_runtime_logs"
  | "live_evidence_pending"
  | "artifact_collection_unavailable"
  | "candidate_path_ok"
  | "candidate_path_failed"
  | "review_details_ok"
  | "review_details_failed"
  | "direct_fallback_rejected_ok"
  | "direct_fallback_rejected_failed"
  | "visible_volume_ok"
  | "visible_volume_failed"
  | "runtime_log_evidence_ok"
  | "runtime_log_evidence_failed"
  | "runtime_logs_unavailable"
  | "bounded_evidence_ok"
  | "bounded_evidence_failed"
  | "invalid_arg";

export type M068Check = {
  id: M068CheckId;
  passed: boolean;
  status_code: M068CheckStatusCode;
  detail: string;
};

export type M068PrerequisiteSummary = {
  command: NestedCommand;
  success: boolean;
  status_code: string;
  check_ids: string[];
  check_count: number;
  failing_check_id: string | null;
  issue: string;
};

export type M068PublicationPreflightStatus =
  | "missing_review_output_key"
  | "pending_live_evidence";

export type M068ReviewDetailsLineStatus =
  | "ok"
  | "missing_line"
  | "duplicate_lines"
  | "malformed_line"
  | "missing_review_details_artifact"
  | "duplicate_review_details_artifacts";

export type M068ReviewDetailsLineProof = {
  line_status: M068ReviewDetailsLineStatus;
  mode: string | null;
  published: number | null;
  direct_fallback: number | null;
  reasons: string[];
};

export type M068ArtifactClassificationEvidence = {
  status: "pending" | "unavailable" | "classified";
  issue: string;
  total_exact_key_artifacts: number;
  review_details_count: number;
  candidate_inline_count: number;
  other_exact_key_count: number;
  by_source: {
    review_comment: number;
    issue_comment: number;
    review: number;
  };
  review_details: M068ReviewDetailsLineProof;
};

export type M068RuntimeLogEvidence = {
  status: "skipped" | "pending" | "unavailable" | "classified";
  issue: string;
  matched_row_count: number;
  malformed_row_count: number;
  drifted_row_count: number;
  candidate_publication_count: number;
  adapter_publication_count: number;
  review_details_publication_count: number;
  candidate_published_count: number;
  direct_fallback_count: number;
  revision_names: string[];
  container_app_names: string[];
  signals: {
    candidate_publication: boolean;
    adapter_publication: boolean;
    review_details_publication: boolean;
  };
};

export type M068Report = {
  command: "verify:m068";
  generated_at: string;
  success: boolean;
  status_code: M068StatusCode;
  check_ids: M068CheckId[];
  checks: M068Check[];
  failing_check_id: M068CheckId | null;
  preflight: {
    preflight_only: boolean;
    repo: string;
    review_output_key: string | null;
    delivery_id: string | null;
    publication: {
      status: M068PublicationPreflightStatus;
      issue: string;
    };
  };
  prerequisites: M068PrerequisiteSummary[];
  evidence: {
    candidate_path: string;
    reducer_adapter_publication_state: string;
    review_details: string;
    fallback_classification: string;
    visible_volume: string;
    artifacts: M068ArtifactClassificationEvidence;
    runtime: M068RuntimeLogEvidence;
  };
  redaction: {
    leak_marker_count: number;
    serialized_report_length: number;
    nested_issue_count: number;
  };
  issues: string[];
};

export type VerifyM068Args = {
  help: boolean;
  json: boolean;
  preflightOnly: boolean;
  repo: string;
  reviewOutputKey: string | null;
  deliveryId: string | null;
  invalidArg: string | null;
};

type EvaluateM068Params = {
  generatedAt?: string;
  preflightOnly?: boolean;
  repo?: string;
  reviewOutputKey?: string | null;
  deliveryId?: string | null;
  evaluateS01?: () => Promise<unknown>;
  evaluateS02?: () => Promise<unknown>;
  evaluateS03?: () => Promise<unknown>;
  collectReviewOutputArtifacts?: (params: { reviewOutputKey: string; repo: string; deliveryId: string | null }) => Promise<ReviewOutputArtifactCollection>;
  queryReviewAuditLogs?: (params: { reviewOutputKey: string; repo: string; deliveryId: string | null }) => Promise<{ query: string; rows: NormalizedLogAnalyticsRow[] }>;
};

const DEFAULT_REPO = "xbmc/xbmc";
const REQUIRED_PR_NUMBER = 28172;
const DEFAULT_RESOURCE_GROUP = "rg-kodiai";
const DEFAULT_TIMESPAN = "P14D";
const DEFAULT_QUERY_LIMIT = 200;
const MAX_DETAIL_LENGTH = 180;
const MAX_M068_CANDIDATE_INLINE_ARTIFACTS = 3;

const EMPTY_REVIEW_DETAILS_LINE_PROOF: M068ReviewDetailsLineProof = {
  line_status: "missing_review_details_artifact",
  mode: null,
  published: null,
  direct_fallback: null,
  reasons: [],
};

const EMPTY_RUNTIME_LOG_EVIDENCE: M068RuntimeLogEvidence = {
  status: "skipped",
  issue: "runtime logs not evaluated",
  matched_row_count: 0,
  malformed_row_count: 0,
  drifted_row_count: 0,
  candidate_publication_count: 0,
  adapter_publication_count: 0,
  review_details_publication_count: 0,
  candidate_published_count: 0,
  direct_fallback_count: 0,
  revision_names: [],
  container_app_names: [],
  signals: {
    candidate_publication: false,
    adapter_publication: false,
    review_details_publication: false,
  },
};

function pendingArtifactEvidence(issue: string, status: "pending" | "unavailable" = "pending"): M068ArtifactClassificationEvidence {
  return {
    status,
    issue: boundedDetail(issue),
    total_exact_key_artifacts: 0,
    review_details_count: 0,
    candidate_inline_count: 0,
    other_exact_key_count: 0,
    by_source: { review_comment: 0, issue_comment: 0, review: 0 },
    review_details: { ...EMPTY_REVIEW_DETAILS_LINE_PROOF },
  };
}

const RAW_LEAK_MARKERS = [
  "rawPrompt",
  "rawDiff",
  "diff --git",
  "BEGIN PROMPT",
  "PROMPT_SECRET",
  "candidate payload",
  "TOKEN=",
  "TOKEN=abc123",
  "SECRET=",
  "sk-",
  "sk-live-secret-token",
  "secretToken",
  "AKIA",
  "AKIA1234567890123456",
  "ghp_",
];

const REQUIRED_NESTED_CHECK_IDS: Record<NestedCommand, readonly string[]> = {
  "verify:m068:s01": M068_S01_CHECK_IDS,
  "verify:m068:s02": M068_S02_CHECK_IDS,
  "verify:m068:s03": M068_S03_CHECK_IDS,
};

const ALLOWED_REVIEW_ACTIONS = new Set(["opened", "ready_for_review", "review_requested", "synchronize"]);

function normalizeIdentifier(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRepo(value: string | null | undefined): string | null {
  const normalized = normalizeIdentifier(value)?.toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }
  const parts = normalized.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return `${parts[0]}/${parts[1]}`;
}

type M068ExactTargetValidation =
  | { ok: true; repo: string; reviewOutputKey: string | null; deliveryId: string | null; parsedKey: ParsedReviewOutputKey | null; check: M068Check }
  | { ok: false; repo: string; reviewOutputKey: string | null; deliveryId: string | null; parsedKey: ParsedReviewOutputKey | null; check: M068Check; issue: string };

function validateExactTarget(params: { repo: string; reviewOutputKey: string | null; deliveryId: string | null }): M068ExactTargetValidation {
  const repo = normalizeRepo(params.repo);
  const reviewOutputKey = normalizeIdentifier(params.reviewOutputKey)?.toLowerCase() ?? null;
  const deliveryId = normalizeIdentifier(params.deliveryId)?.toLowerCase() ?? null;

  if (!repo) {
    const issue = `Invalid repo '${params.repo}'. Expected owner/repo.`;
    return { ok: false, repo: params.repo, reviewOutputKey, deliveryId, parsedKey: null, check: failedCheck("M068-EXACT-TARGET-PREFLIGHT", "invalid_target", issue), issue };
  }

  if (repo !== DEFAULT_REPO) {
    const issue = `Provided --repo=${repo} does not match required exact target ${DEFAULT_REPO}#${REQUIRED_PR_NUMBER}.`;
    return { ok: false, repo, reviewOutputKey, deliveryId, parsedKey: null, check: failedCheck("M068-EXACT-TARGET-PREFLIGHT", "invalid_target", issue), issue };
  }

  if (!reviewOutputKey) {
    return {
      ok: true,
      repo,
      reviewOutputKey: null,
      deliveryId,
      parsedKey: null,
      check: passedCheck("M068-EXACT-TARGET-PREFLIGHT", "exact_target_skipped_missing_review_output_key", `No review output key provided; target defaults to ${DEFAULT_REPO}#${REQUIRED_PR_NUMBER}.`),
    };
  }

  const parsedKey = parseReviewOutputKey(reviewOutputKey);
  const parsedEvidenceKey = parsedKey?.baseReviewOutputKey ? parseReviewOutputKey(parsedKey.baseReviewOutputKey) : null;
  if (!parsedKey || !parsedEvidenceKey) {
    const issue = "Malformed --review-output-key.";
    return { ok: false, repo, reviewOutputKey, deliveryId, parsedKey, check: failedCheck("M068-EXACT-TARGET-PREFLIGHT", "invalid_review_output_key", issue), issue };
  }

  const issues = [
    ...(parsedKey.repoFullName !== DEFAULT_REPO ? [`--review-output-key must encode repo=${DEFAULT_REPO}.`] : []),
    ...(parsedKey.prNumber !== REQUIRED_PR_NUMBER ? [`--review-output-key must encode pr=${REQUIRED_PR_NUMBER}.`] : []),
    ...(!ALLOWED_REVIEW_ACTIONS.has(parsedKey.action) ? ["--review-output-key must encode an automatic review action (opened, ready_for_review, review_requested, synchronize)."] : []),
    ...(parsedKey.repoFullName !== repo ? ["Provided --repo does not match the repository encoded in --review-output-key."] : []),
    ...(deliveryId && deliveryId !== parsedKey.effectiveDeliveryId ? ["Provided --delivery-id does not match the delivery id encoded in --review-output-key."] : []),
    ...(parsedEvidenceKey.repoFullName !== parsedKey.repoFullName || parsedEvidenceKey.prNumber !== parsedKey.prNumber || parsedEvidenceKey.action !== parsedKey.action || parsedEvidenceKey.headSha !== parsedKey.headSha
      ? ["Normalized retry reviewOutputKey does not preserve repo/pr/action/head identity."]
      : []),
  ];

  if (issues.length > 0) {
    const issue = issues.join("; ");
    return { ok: false, repo, reviewOutputKey, deliveryId: deliveryId ?? parsedKey.effectiveDeliveryId, parsedKey, check: failedCheck("M068-EXACT-TARGET-PREFLIGHT", "invalid_target", issue), issue };
  }

  return {
    ok: true,
    repo,
    reviewOutputKey: parsedKey.baseReviewOutputKey,
    deliveryId: deliveryId ?? parsedKey.effectiveDeliveryId,
    parsedKey,
    check: passedCheck("M068-EXACT-TARGET-PREFLIGHT", "exact_target_ok", `exact target accepted repo=${DEFAULT_REPO} pr=${REQUIRED_PR_NUMBER} retry=${parsedKey.retryAttempt ?? "none"}`),
  };
}

type LiveOctokit = Awaited<ReturnType<ReturnType<typeof createGitHubApp>["getInstallationOctokit"]>>;

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
  if (!hasGitHubEnv()) {
    throw new Error("Missing GitHub App credentials for live artifact collection.");
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

async function collectReviewOutputArtifactsLive(params: {
  reviewOutputKey: string;
  repo: string;
  deliveryId: string | null;
}): Promise<ReviewOutputArtifactCollection> {
  const live = await createLiveGitHubContext(params.repo);
  return await collectReviewOutputArtifacts({
    octokit: live.octokit as unknown as ReviewOutputArtifactsOctokit,
    reviewOutputKey: params.reviewOutputKey,
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
  return ids && ids.length > 0 ? [...new Set(ids)] : undefined;
}

async function discoverAuditWorkspaceIds(): Promise<string[]> {
  return discoverLogAnalyticsWorkspaceIds({
    resourceGroup: getAzureLogResourceGroup(),
    explicitWorkspaceIds: explicitWorkspaceIdsFromEnv(),
  });
}

export async function queryM068ReviewAuditLogsLive(params: {
  reviewOutputKey: string;
  repo: string;
  deliveryId: string | null;
  workspaceIds?: string[];
  discoverWorkspaceIds?: () => Promise<string[]>;
  queryLogs?: (params: {
    workspaceIds: string[];
    reviewOutputKey: string;
    deliveryId?: string;
    timespan: string;
    limit: number;
  }) => Promise<{ query: string; rows: NormalizedLogAnalyticsRow[] }>;
}): Promise<{ query: string; rows: NormalizedLogAnalyticsRow[] }> {
  const workspaceIds = params.workspaceIds ?? await (params.discoverWorkspaceIds ?? discoverAuditWorkspaceIds)();
  return await (params.queryLogs ?? ((queryParams) => queryLogAnalyticsReviewAuditLogs(queryParams)))({
    workspaceIds,
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId ?? undefined,
    timespan: DEFAULT_TIMESPAN,
    limit: DEFAULT_QUERY_LIMIT,
  });
}

function readOptionValue(args: string[], index: number): { value: string | null; consumed: boolean } {
  const candidate = args[index + 1];
  if (typeof candidate !== "string" || candidate.startsWith("--")) {
    return { value: null, consumed: false };
  }
  return { value: candidate, consumed: true };
}

export function parseVerifyM068Args(args: string[]): VerifyM068Args {
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

function sanitizeEvidenceText(value: string): string {
  return value
    .replace(/BEGIN\s+PROMPT/gi, "prompt-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/TOKEN\s*=\s*[^\s,;]+/gi, "token-redacted")
    .replace(/SECRET\s*=\s*[^\s,;]+/gi, "secret-redacted")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/AKIA[0-9A-Z]{16}/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/rawPrompt/gi, "raw-prompt-redacted")
    .replace(/rawDiff/gi, "raw-diff-redacted")
    .replace(/secretToken/gi, "secret-token-redacted")
    .replace(/candidate payload/gi, "candidate-payload-redacted");
}

function boundedDetail(value: unknown, maxLength = MAX_DETAIL_LENGTH): string {
  const text = sanitizeEvidenceText(String(value ?? "")).replace(/\s+/g, " ").trim();
  return (text.length > maxLength ? `${text.slice(0, maxLength)}…` : text) || "bounded-result";
}

function countLeakMarkers(value: string): number {
  return RAW_LEAK_MARKERS.reduce((count, marker) => count + (value.includes(marker) ? 1 : 0), 0);
}

function passedCheck(id: M068CheckId, statusCode: M068CheckStatusCode, detail: string): M068Check {
  return { id, passed: true, status_code: statusCode, detail: boundedDetail(detail) };
}

function failedCheck(id: M068CheckId, statusCode: M068CheckStatusCode, detail: string): M068Check {
  return { id, passed: false, status_code: statusCode, detail: boundedDetail(detail) };
}

function skippedLiveCheck(id: M068CheckId, reviewOutputKey: string | null): M068Check {
  if (!reviewOutputKey) {
    return passedCheck(id, "preflight_skipped_missing_review_output_key", "No review output key provided; live exact-key evidence collection was skipped safely.");
  }
  return passedCheck(id, "live_evidence_pending", "Review output key provided; live evidence evaluation is reserved for later verifier tasks.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateNestedReport(command: NestedCommand, value: unknown): { report: NestedReport | null; issue: string | null } {
  if (!isRecord(value)) {
    return { report: null, issue: "report was not an object" };
  }

  if (value.command !== command) {
    return { report: null, issue: `expected command ${command}` };
  }

  if (typeof value.success !== "boolean") {
    return { report: null, issue: "missing boolean success" };
  }

  if (typeof value.status_code !== "string" || value.status_code.length === 0) {
    return { report: null, issue: "missing status_code" };
  }

  if (!Array.isArray(value.check_ids)) {
    return { report: null, issue: "missing check_ids" };
  }

  if (!Array.isArray(value.checks)) {
    return { report: null, issue: "missing checks" };
  }

  const reportCheckIds = value.check_ids.filter((id): id is string => typeof id === "string");
  const missingCheckIds = REQUIRED_NESTED_CHECK_IDS[command].filter((id) => !reportCheckIds.includes(id));
  if (missingCheckIds.length > 0) {
    return { report: null, issue: `missing required check ids: ${missingCheckIds.slice(0, 3).join(",")}` };
  }

  const unknownStatus = value.checks.some((check) => !isRecord(check) || typeof check.id !== "string" || typeof check.passed !== "boolean" || typeof check.status_code !== "string");
  if (unknownStatus) {
    return { report: null, issue: "malformed checks" };
  }

  return { report: value as NestedReport, issue: null };
}

function prerequisiteSummaryFromReport(command: NestedCommand, report: NestedReport): M068PrerequisiteSummary {
  const failingCheckId = typeof report.failing_check_id === "string" ? report.failing_check_id : null;
  const firstIssue = Array.isArray(report.issues) && report.issues.length > 0
    ? report.issues[0]
    : report.success
      ? "ok"
      : `nested verifier failed at ${failingCheckId ?? report.status_code}`;

  return {
    command,
    success: report.success,
    status_code: boundedDetail(report.status_code, 96),
    check_ids: report.check_ids.slice(0, 40).map((id) => boundedDetail(id, 96)),
    check_count: report.checks.length,
    failing_check_id: failingCheckId ? boundedDetail(failingCheckId, 96) : null,
    issue: boundedDetail(firstIssue),
  };
}

function malformedPrerequisiteSummary(command: NestedCommand, issue: string): M068PrerequisiteSummary {
  return {
    command,
    success: false,
    status_code: "malformed_report",
    check_ids: [],
    check_count: 0,
    failing_check_id: null,
    issue: boundedDetail(issue),
  };
}

async function evaluatePrerequisite(command: NestedCommand, evaluate: () => Promise<unknown>): Promise<M068PrerequisiteSummary> {
  try {
    const value = await evaluate();
    const validated = validateNestedReport(command, value);
    if (!validated.report) {
      return malformedPrerequisiteSummary(command, validated.issue ?? "malformed report");
    }
    return prerequisiteSummaryFromReport(command, validated.report);
  } catch (error) {
    return malformedPrerequisiteSummary(command, `evaluator error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildPublicationPreflight(params: { reviewOutputKey: string | null }): M068Report["preflight"]["publication"] {
  if (!params.reviewOutputKey) {
    return {
      status: "missing_review_output_key",
      issue: "No review output key provided; live publication checks are skipped and bounded to local prerequisite evidence.",
    };
  }

  return {
    status: "pending_live_evidence",
    issue: "Review output key provided; live exact-key publication checks are pending unless fixture or injected evidence is available.",
  };
}

function isReviewDetailsArtifact(artifact: ReviewOutputArtifact, reviewOutputKey: string): boolean {
  return typeof artifact.body === "string" && artifact.body.includes(buildReviewDetailsMarker(reviewOutputKey));
}

function isCandidateInlineArtifact(artifact: ReviewOutputArtifact, reviewOutputKey: string): boolean {
  return artifact.source === "review-comment"
    && typeof artifact.body === "string"
    && artifact.body.includes(buildReviewOutputMarker(reviewOutputKey));
}

function parseReviewCandidatePublicationLine(body: string | null | undefined): M068ReviewDetailsLineProof {
  if (typeof body !== "string" || body.trim().length === 0) {
    return { ...EMPTY_REVIEW_DETAILS_LINE_PROOF, line_status: "missing_line" };
  }

  const matchingLines = body
    .split("\n")
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter((line) => line.includes("Review candidate publication:"));

  if (matchingLines.length === 0) {
    return { ...EMPTY_REVIEW_DETAILS_LINE_PROOF, line_status: "missing_line" };
  }
  if (matchingLines.length > 1) {
    return { ...EMPTY_REVIEW_DETAILS_LINE_PROOF, line_status: "duplicate_lines" };
  }

  const line = matchingLines[0] ?? "";
  const match = line.match(/^Review candidate publication:\s+mode=([^\s]+)\s+(?:approved=\d+\s+)?(?:rewritten=\d+\s+)?published=(\d+)\s+directFallback=(\d+)\s+reasons=([^\s].*)$/);
  if (!match) {
    return { ...EMPTY_REVIEW_DETAILS_LINE_PROOF, line_status: "malformed_line" };
  }

  const mode = boundedDetail(match[1], 80);
  const published = Number.parseInt(match[2] ?? "", 10);
  const directFallback = Number.parseInt(match[3] ?? "", 10);
  if (!Number.isInteger(published) || !Number.isInteger(directFallback)) {
    return { ...EMPTY_REVIEW_DETAILS_LINE_PROOF, line_status: "malformed_line" };
  }

  const rawReasons = match[4] ?? "none";
  const reasons = rawReasons === "none"
    ? []
    : rawReasons.split(",").map((reason) => boundedDetail(reason, 80)).filter(Boolean).slice(0, 6);

  return {
    line_status: "ok",
    mode,
    published,
    direct_fallback: directFallback,
    reasons,
  };
}

export function evaluateM068ReviewOutputArtifacts(params: {
  reviewOutputKey: string;
  collection: ReviewOutputArtifactCollection;
}): M068ArtifactClassificationEvidence {
  const reviewDetailsArtifacts: ReviewOutputArtifact[] = [];
  const candidateInlineArtifacts: ReviewOutputArtifact[] = [];
  const otherExactKeyArtifacts: ReviewOutputArtifact[] = [];

  for (const artifact of params.collection.artifacts) {
    if (isReviewDetailsArtifact(artifact, params.reviewOutputKey)) {
      reviewDetailsArtifacts.push(artifact);
    } else if (isCandidateInlineArtifact(artifact, params.reviewOutputKey)) {
      candidateInlineArtifacts.push(artifact);
    } else {
      otherExactKeyArtifacts.push(artifact);
    }
  }

  let reviewDetails: M068ReviewDetailsLineProof;
  if (reviewDetailsArtifacts.length === 0) {
    reviewDetails = { ...EMPTY_REVIEW_DETAILS_LINE_PROOF, line_status: "missing_review_details_artifact" };
  } else if (reviewDetailsArtifacts.length > 1) {
    reviewDetails = { ...EMPTY_REVIEW_DETAILS_LINE_PROOF, line_status: "duplicate_review_details_artifacts" };
  } else {
    reviewDetails = parseReviewCandidatePublicationLine(reviewDetailsArtifacts[0]?.body);
  }

  return {
    status: "classified",
    issue: reviewDetails.line_status === "ok" ? "classified" : reviewDetails.line_status,
    total_exact_key_artifacts: params.collection.artifacts.length,
    review_details_count: reviewDetailsArtifacts.length,
    candidate_inline_count: candidateInlineArtifacts.length,
    other_exact_key_count: otherExactKeyArtifacts.length,
    by_source: {
      review_comment: params.collection.artifacts.filter((artifact) => artifact.source === "review-comment").length,
      issue_comment: params.collection.artifacts.filter((artifact) => artifact.source === "issue-comment").length,
      review: params.collection.artifacts.filter((artifact) => artifact.source === "review").length,
    },
    review_details: reviewDetails,
  };
}

function normalizedSet(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => boundedDetail(value, 96)))].sort();
}

function rowText(row: NormalizedLogAnalyticsRow): string {
  return [row.message, row.rawLog].filter((value): value is string => typeof value === "string").join("\n");
}

function rowFieldText(row: NormalizedLogAnalyticsRow, field: string): string | null {
  const value = row.parsedLog?.[field];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase();
  }
  return null;
}

function rowNumericField(row: NormalizedLogAnalyticsRow, field: string): number {
  const value = row.parsedLog?.[field];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function rowMatchesCorrelation(row: NormalizedLogAnalyticsRow, reviewOutputKey: string, deliveryId: string | null): boolean {
  const key = reviewOutputKey.toLowerCase();
  const delivery = deliveryId?.toLowerCase() ?? null;
  const rowKey = row.reviewOutputKey?.toLowerCase() ?? rowFieldText(row, "reviewOutputKey");
  const rowDelivery = row.deliveryId?.toLowerCase() ?? rowFieldText(row, "deliveryId");
  if (rowKey || rowDelivery) {
    return rowKey === key && (delivery === null || rowDelivery === delivery);
  }
  const haystack = rowText(row).toLowerCase();
  return haystack.includes(key) && (delivery === null || haystack.includes(delivery));
}

export function evaluateM068RuntimeLogEvidence(params: {
  reviewOutputKey: string;
  deliveryId: string | null;
  rows: NormalizedLogAnalyticsRow[];
  unavailable?: boolean;
  issue?: string;
}): M068RuntimeLogEvidence {
  if (params.unavailable) {
    return { ...EMPTY_RUNTIME_LOG_EVIDENCE, status: "unavailable", issue: boundedDetail(params.issue ?? "Azure Log Analytics unavailable.") };
  }

  const matchedRows = params.rows.filter((row) => rowMatchesCorrelation(row, params.reviewOutputKey, params.deliveryId));
  const text = matchedRows.map(rowText).join("\n").toLowerCase();
  const candidatePublicationRows = matchedRows.filter((row) => {
    const gate = rowFieldText(row, "gate");
    const rowHaystack = rowText(row).toLowerCase();
    return gate === "review-candidate-publication" || rowHaystack.includes("review candidate publication completed");
  });
  const adapterPublicationRows = matchedRows.filter((row) => {
    const gate = rowFieldText(row, "gate");
    const rowHaystack = rowText(row).toLowerCase();
    return gate === "review-candidate-publication-adapter" || rowHaystack.includes("review candidate publication adapter");
  });
  const reviewDetailsRows = matchedRows.filter((row) => {
    const gate = rowFieldText(row, "gate");
    const gateResult = rowFieldText(row, "gateResult");
    const reviewDetailsPublished = rowFieldText(row, "reviewDetailsPublished");
    const completionGate = gate === "review-details-output" || gate === "review-details-publication";
    const completionResult = gateResult === "completed" || gateResult === "success" || gateResult === "published";
    return completionGate && completionResult && reviewDetailsPublished === "true";
  });
  const candidatePublishedCount = candidatePublicationRows.reduce((count, row) => count + rowNumericField(row, "published"), 0);
  const directFallbackCount = candidatePublicationRows.reduce((count, row) => count + rowNumericField(row, "directFallback"), 0);
  const malformedRowCount = matchedRows.filter((row) => row.malformed).length;

  const signals = {
    candidate_publication: candidatePublicationRows.length > 0 && candidatePublishedCount > 0,
    adapter_publication: adapterPublicationRows.length > 0,
    review_details_publication: reviewDetailsRows.length > 0,
  };
  const missingSignals = [
    ...(!signals.candidate_publication ? ["missing candidate publication log"] : []),
    ...(!signals.adapter_publication ? ["missing adapter publication log"] : []),
    ...(!signals.review_details_publication ? ["missing Review Details publication log"] : []),
    ...(directFallbackCount > 0 ? [`direct fallback count=${directFallbackCount}`] : []),
    ...(malformedRowCount > 0 ? [`malformed log rows=${malformedRowCount}`] : []),
  ];

  return {
    status: "classified",
    issue: missingSignals.length === 0 ? "runtime log evidence accepted" : boundedDetail(missingSignals.join("; ")),
    matched_row_count: matchedRows.length,
    malformed_row_count: malformedRowCount,
    drifted_row_count: params.rows.length - matchedRows.length,
    candidate_publication_count: candidatePublicationRows.length,
    adapter_publication_count: adapterPublicationRows.length,
    review_details_publication_count: reviewDetailsRows.length,
    candidate_published_count: candidatePublishedCount,
    direct_fallback_count: directFallbackCount,
    revision_names: normalizedSet(matchedRows.map((row) => row.revisionName)),
    container_app_names: normalizedSet(matchedRows.map((row) => row.containerAppName)),
    signals,
  };
}

function runtimeLogCheckFromEvidence(evidence: M068RuntimeLogEvidence): M068Check {
  if (evidence.status === "skipped") {
    return passedCheck("M068-RUNTIME-LOG-EVIDENCE", "preflight_skipped_runtime_logs", evidence.issue);
  }
  if (evidence.status === "pending") {
    return failedCheck("M068-RUNTIME-LOG-EVIDENCE", "live_evidence_pending", evidence.issue);
  }
  if (evidence.status === "unavailable") {
    return failedCheck("M068-RUNTIME-LOG-EVIDENCE", "runtime_logs_unavailable", evidence.issue);
  }

  const ok = evidence.matched_row_count > 0
    && evidence.malformed_row_count === 0
    && evidence.direct_fallback_count === 0
    && evidence.signals.candidate_publication
    && evidence.signals.adapter_publication
    && evidence.signals.review_details_publication;
  return ok
    ? passedCheck("M068-RUNTIME-LOG-EVIDENCE", "runtime_log_evidence_ok", `matched=${evidence.matched_row_count} candidate=${evidence.candidate_publication_count} adapter=${evidence.adapter_publication_count} reviewDetails=${evidence.review_details_publication_count}`)
    : failedCheck("M068-RUNTIME-LOG-EVIDENCE", "runtime_log_evidence_failed", evidence.issue);
}

async function evaluateRuntimeLogEvidence(params: {
  preflightOnly: boolean;
  reviewOutputKey: string | null;
  repo: string;
  deliveryId: string | null;
  queryReviewAuditLogs?: (params: { reviewOutputKey: string; repo: string; deliveryId: string | null }) => Promise<{ query: string; rows: NormalizedLogAnalyticsRow[] }>;
}): Promise<M068RuntimeLogEvidence> {
  if (params.preflightOnly) {
    return { ...EMPTY_RUNTIME_LOG_EVIDENCE, status: "skipped", issue: "Preflight-only mode intentionally skipped Azure Log Analytics." };
  }
  if (!params.reviewOutputKey) {
    return { ...EMPTY_RUNTIME_LOG_EVIDENCE, status: "skipped", issue: "No review output key provided; runtime log evidence skipped safely." };
  }
  if (!params.queryReviewAuditLogs) {
    return { ...EMPTY_RUNTIME_LOG_EVIDENCE, status: "pending", issue: "Review output key provided; runtime log query is pending live verifier wiring." };
  }

  try {
    const result = await params.queryReviewAuditLogs({
      reviewOutputKey: params.reviewOutputKey,
      repo: params.repo,
      deliveryId: params.deliveryId,
    });
    return evaluateM068RuntimeLogEvidence({ reviewOutputKey: params.reviewOutputKey, deliveryId: params.deliveryId, rows: result.rows });
  } catch (error) {
    return evaluateM068RuntimeLogEvidence({
      reviewOutputKey: params.reviewOutputKey,
      deliveryId: params.deliveryId,
      rows: [],
      unavailable: true,
      issue: `Azure Log Analytics unavailable: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function checksFromArtifactEvidence(evidence: M068ArtifactClassificationEvidence): M068Check[] {
  if (evidence.status === "pending") {
    return [
      passedCheck("M068-CANDIDATE-PATH-PROOF", "live_evidence_pending", evidence.issue),
      passedCheck("M068-REVIEW-DETAILS-EVIDENCE", "live_evidence_pending", evidence.issue),
      passedCheck("M068-DIRECT-FALLBACK-REJECTED", "live_evidence_pending", evidence.issue),
      passedCheck("M068-GITHUB-VISIBLE-VOLUME", "live_evidence_pending", evidence.issue),
    ];
  }

  if (evidence.status === "unavailable") {
    return [
      failedCheck("M068-CANDIDATE-PATH-PROOF", "artifact_collection_unavailable", evidence.issue),
      failedCheck("M068-REVIEW-DETAILS-EVIDENCE", "artifact_collection_unavailable", evidence.issue),
      failedCheck("M068-DIRECT-FALLBACK-REJECTED", "artifact_collection_unavailable", evidence.issue),
      failedCheck("M068-GITHUB-VISIBLE-VOLUME", "artifact_collection_unavailable", evidence.issue),
    ];
  }

  const reviewDetailsOk = evidence.review_details_count === 1 && evidence.review_details.line_status === "ok";
  const candidateModeOk = evidence.review_details.mode === "candidate-approved" || evidence.review_details.mode === "candidate-approved-partial";
  const published = evidence.review_details.published ?? 0;
  const directFallback = evidence.review_details.direct_fallback ?? 0;
  const candidatePathOk = reviewDetailsOk && candidateModeOk && published > 0;
  const directFallbackRejectedOk = !(published === 0 && directFallback > 0);
  const visibleVolumeOk = evidence.candidate_inline_count <= MAX_M068_CANDIDATE_INLINE_ARTIFACTS;

  return [
    candidatePathOk
      ? passedCheck("M068-CANDIDATE-PATH-PROOF", "candidate_path_ok", `mode=${evidence.review_details.mode} published=${published} candidateInline=${evidence.candidate_inline_count}`)
      : failedCheck("M068-CANDIDATE-PATH-PROOF", "candidate_path_failed", `mode=${evidence.review_details.mode ?? "missing"} published=${published} lineStatus=${evidence.review_details.line_status}`),
    reviewDetailsOk
      ? passedCheck("M068-REVIEW-DETAILS-EVIDENCE", "review_details_ok", `mode=${evidence.review_details.mode} published=${published} directFallback=${directFallback} reasons=${evidence.review_details.reasons.length}`)
      : failedCheck("M068-REVIEW-DETAILS-EVIDENCE", "review_details_failed", `reviewDetails=${evidence.review_details_count} lineStatus=${evidence.review_details.line_status} malformed=${evidence.review_details.line_status !== "ok"}`),
    directFallbackRejectedOk
      ? passedCheck("M068-DIRECT-FALLBACK-REJECTED", "direct_fallback_rejected_ok", `published=${published} directFallback=${directFallback}`)
      : failedCheck("M068-DIRECT-FALLBACK-REJECTED", "direct_fallback_rejected_failed", `published=${published} directFallback=${directFallback}`),
    visibleVolumeOk
      ? passedCheck("M068-GITHUB-VISIBLE-VOLUME", "visible_volume_ok", `candidateInline=${evidence.candidate_inline_count} cap=${MAX_M068_CANDIDATE_INLINE_ARTIFACTS} reviewDetails=${evidence.review_details_count} other=${evidence.other_exact_key_count}`)
      : failedCheck("M068-GITHUB-VISIBLE-VOLUME", "visible_volume_failed", `candidateInline=${evidence.candidate_inline_count} cap=${MAX_M068_CANDIDATE_INLINE_ARTIFACTS} reviewDetails=${evidence.review_details_count} other=${evidence.other_exact_key_count}`),
  ];
}

function buildReport(params: {
  generatedAt: string;
  preflightOnly: boolean;
  repo: string;
  reviewOutputKey: string | null;
  deliveryId: string | null;
  prerequisites: M068PrerequisiteSummary[];
  exactTargetCheck: M068Check;
  artifactEvidence: M068ArtifactClassificationEvidence;
  runtimeEvidence: M068RuntimeLogEvidence;
}): M068Report {
  const publication = buildPublicationPreflight({ reviewOutputKey: params.reviewOutputKey });
  const failedPrerequisite = params.prerequisites.find((summary) => !summary.success) ?? null;
  const checks: M068Check[] = [];

  checks.push(failedPrerequisite
    ? failedCheck(
      "M068-LOCAL-PREREQUISITES",
      failedPrerequisite.status_code === "malformed_report" ? "local_prerequisite_malformed" : "local_prerequisite_failed",
      `${failedPrerequisite.command}: ${failedPrerequisite.status_code}; ${failedPrerequisite.issue}`,
    )
    : passedCheck(
      "M068-LOCAL-PREREQUISITES",
      "local_prerequisites_ok",
      "S01/S02/S03 local verifier reports all passed with required check ids.",
    ));

  checks.push(params.exactTargetCheck);
  const runtimeCheck = runtimeLogCheckFromEvidence(params.runtimeEvidence);
  const reducerAdapterCheck = params.runtimeEvidence.status === "classified" && runtimeCheck.passed
    ? passedCheck("M068-REDUCER-ADAPTER-PUBLICATION-STATE", "runtime_log_evidence_ok", "Runtime logs include candidate reducer and adapter publication gates.")
    : params.runtimeEvidence.status === "classified" || params.runtimeEvidence.status === "unavailable" || params.runtimeEvidence.status === "pending"
      ? failedCheck("M068-REDUCER-ADAPTER-PUBLICATION-STATE", runtimeCheck.status_code, params.runtimeEvidence.issue)
      : skippedLiveCheck("M068-REDUCER-ADAPTER-PUBLICATION-STATE", params.reviewOutputKey);
  checks.push(reducerAdapterCheck);
  checks.push(...checksFromArtifactEvidence(params.artifactEvidence));
  checks.push(runtimeCheck);

  const preliminary = {
    command: "verify:m068" as const,
    generated_at: params.generatedAt,
    check_ids: [...M068_CHECK_IDS],
    checks,
    preflight: {
      preflight_only: params.preflightOnly,
      repo: params.repo,
      review_output_key: params.reviewOutputKey,
      delivery_id: params.deliveryId,
      publication,
    },
    prerequisites: params.prerequisites,
    evidence: {
      candidate_path: failedPrerequisite
        ? "blocked_by_local_prerequisites"
        : params.artifactEvidence.status === "classified"
          ? `mode=${params.artifactEvidence.review_details.mode ?? "missing"} published=${params.artifactEvidence.review_details.published ?? 0}`
          : params.artifactEvidence.status,
      reducer_adapter_publication_state: params.reviewOutputKey ? "pending_live_evidence" : "skipped_missing_review_output_key",
      review_details: params.artifactEvidence.status === "classified" ? params.artifactEvidence.review_details.line_status : params.artifactEvidence.status,
      fallback_classification: params.artifactEvidence.status === "classified" ? `directFallback=${params.artifactEvidence.review_details.direct_fallback ?? 0}` : params.artifactEvidence.status,
      visible_volume: params.artifactEvidence.status === "classified" ? `candidateInline=${params.artifactEvidence.candidate_inline_count}` : params.artifactEvidence.status,
      artifacts: params.artifactEvidence,
      runtime: params.runtimeEvidence,
    },
  };
  const preliminarySerialized = JSON.stringify(preliminary);
  const leakMarkerCount = countLeakMarkers(preliminarySerialized);
  const boundedCheck = leakMarkerCount === 0 && preliminarySerialized.length <= 20000
    ? passedCheck("M068-BOUNDED-EVIDENCE", "bounded_evidence_ok", "milestone report is bounded to check ids, status codes, counts, and sanitized prerequisite issues")
    : failedCheck("M068-BOUNDED-EVIDENCE", "bounded_evidence_failed", `leakMarkers=${leakMarkerCount} serializedLength=${preliminarySerialized.length}`);
  checks.push(boundedCheck);

  const failing = checks.find((check) => !check.passed) ?? null;
  const issues = checks
    .filter((check) => !check.passed)
    .map((check) => `${check.id}: ${boundedDetail(check.detail)}`);
  const statusCode: M068StatusCode = failing
    ? failing.id === "M068-LOCAL-PREREQUISITES"
      ? "m068_local_prerequisites_failed"
      : failing.id === "M068-EXACT-TARGET-PREFLIGHT"
        ? "m068_invalid_arg"
        : "m068_contract_failed"
    : params.artifactEvidence.status === "classified"
      ? "m068_ok"
      : publication.status === "missing_review_output_key"
        ? "m068_skipped_missing_review_output_key"
        : "m068_pending_live_evidence";

  return {
    ...preliminary,
    success: failing === null,
    status_code: statusCode,
    checks,
    failing_check_id: failing?.id ?? null,
    redaction: {
      leak_marker_count: countLeakMarkers(JSON.stringify({ ...preliminary, checks })),
      serialized_report_length: JSON.stringify({ ...preliminary, checks }).length,
      nested_issue_count: params.prerequisites.filter((summary) => summary.issue !== "ok").length,
    },
    issues,
  };
}

async function evaluateArtifactEvidence(params: {
  reviewOutputKey: string | null;
  repo: string;
  deliveryId: string | null;
  collectReviewOutputArtifacts?: (params: { reviewOutputKey: string; repo: string; deliveryId: string | null }) => Promise<ReviewOutputArtifactCollection>;
}): Promise<M068ArtifactClassificationEvidence> {
  if (!params.reviewOutputKey) {
    return pendingArtifactEvidence("No review output key provided; exact-key artifact collection skipped safely.");
  }

  if (!params.collectReviewOutputArtifacts) {
    return pendingArtifactEvidence("Review output key provided; exact-key artifact collection is pending live verifier wiring.");
  }

  try {
    const collection = await params.collectReviewOutputArtifacts({
      reviewOutputKey: params.reviewOutputKey,
      repo: params.repo,
      deliveryId: params.deliveryId,
    });
    return evaluateM068ReviewOutputArtifacts({
      reviewOutputKey: params.reviewOutputKey,
      collection,
    });
  } catch (error) {
    return pendingArtifactEvidence(`artifact collection unavailable: ${error instanceof Error ? error.message : String(error)}`, "unavailable");
  }
}

export async function evaluateM068MilestoneContract(params: EvaluateM068Params = {}): Promise<M068Report> {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const requestedReviewOutputKey = normalizeIdentifier(params.reviewOutputKey);
  const requestedDeliveryId = normalizeIdentifier(params.deliveryId);
  const requestedRepo = normalizeIdentifier(params.repo) ?? DEFAULT_REPO;
  const target = validateExactTarget({ repo: requestedRepo, reviewOutputKey: requestedReviewOutputKey, deliveryId: requestedDeliveryId });
  const prerequisites = await Promise.all([
    evaluatePrerequisite("verify:m068:s01", params.evaluateS01 ?? (() => evaluateM068S01CandidateApprovalContract({ generatedAt }))),
    evaluatePrerequisite("verify:m068:s02", params.evaluateS02 ?? (() => evaluateM068S02InlinePublisherContract({ generatedAt }))),
    evaluatePrerequisite("verify:m068:s03", params.evaluateS03 ?? (() => evaluateM068S03ClosureContract({ generatedAt }))),
  ]);
  const artifactEvidence = target.ok && !params.preflightOnly
    ? await evaluateArtifactEvidence({
      reviewOutputKey: target.reviewOutputKey,
      repo: target.repo,
      deliveryId: target.deliveryId,
      collectReviewOutputArtifacts: params.collectReviewOutputArtifacts,
    })
    : target.ok
      ? pendingArtifactEvidence("Preflight-only mode intentionally skipped exact-key artifact collection.")
      : pendingArtifactEvidence("Exact target validation failed; exact-key artifact collection skipped safely.", "unavailable");
  const runtimeEvidence = target.ok
    ? await evaluateRuntimeLogEvidence({
      preflightOnly: Boolean(params.preflightOnly),
      reviewOutputKey: target.reviewOutputKey,
      repo: target.repo,
      deliveryId: target.deliveryId,
      queryReviewAuditLogs: params.queryReviewAuditLogs,
    })
    : { ...EMPTY_RUNTIME_LOG_EVIDENCE, status: "unavailable" as const, issue: "Exact target validation failed; runtime log query skipped safely." };

  return buildReport({
    generatedAt,
    preflightOnly: Boolean(params.preflightOnly),
    repo: target.repo,
    reviewOutputKey: target.reviewOutputKey,
    deliveryId: target.deliveryId,
    prerequisites,
    exactTargetCheck: target.check,
    artifactEvidence,
    runtimeEvidence,
  });
}

function usage(): string {
  return [
    "Usage: bun run verify:m068 -- [--json] [--preflight-only] [--review-output-key <key>] [--repo xbmc/xbmc] [--delivery-id <id>]",
    "",
    "Composes M068 S01/S02/S03 local verifier reports and exposes a bounded milestone-level evidence shell.",
    "",
    "Options:",
    "  --json               Emit machine-readable JSON",
    "  --preflight-only     Run only local prerequisites and exact-key preflight classification",
    "  --review-output-key  Optional exact-key Review Details artifact key for future live evidence checks",
    `  --repo               Repository scope for preflight metadata (default: ${DEFAULT_REPO})`,
    "  --delivery-id        Optional delivery id metadata",
    "  --help               Show this help",
  ].join("\n");
}

export function renderM068Report(report: M068Report): string {
  const lines = [
    "# M068 — Milestone Candidate Publication Verifier",
    "",
    `Status: ${report.status_code}`,
    `Success: ${report.success ? "yes" : "no"}`,
    `Failing check: ${report.failing_check_id ?? "none"}`,
    `Preflight: repo=${report.preflight.repo} reviewOutputKey=${report.preflight.review_output_key ?? "missing"} deliveryId=${report.preflight.delivery_id ?? "missing"} publication=${report.preflight.publication.status}`,
    `Prerequisites: ${report.prerequisites.map((summary) => `${summary.command}:${summary.status_code}:${summary.success ? "pass" : "fail"}`).join(" ")}`,
    `Evidence: candidatePath=${report.evidence.candidate_path} reducerAdapterPublication=${report.evidence.reducer_adapter_publication_state} reviewDetails=${report.evidence.review_details} fallback=${report.evidence.fallback_classification} visibleVolume=${report.evidence.visible_volume}`,
    `Runtime: status=${report.evidence.runtime.status} matched=${report.evidence.runtime.matched_row_count} candidate=${report.evidence.runtime.candidate_publication_count} adapter=${report.evidence.runtime.adapter_publication_count} reviewDetails=${report.evidence.runtime.review_details_publication_count} fallback=${report.evidence.runtime.direct_fallback_count}`,
    `Redaction: leakMarkers=${report.redaction.leak_marker_count} reportLength=${report.redaction.serialized_report_length} nestedIssues=${report.redaction.nested_issue_count}`,
    "",
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.id}: ${check.passed ? "pass" : "fail"} (${check.status_code}) ${boundedDetail(check.detail)}`);
  }

  if (report.issues.length > 0) {
    lines.push("", "Issues:");
    for (const issue of report.issues) {
      lines.push(`- ${boundedDetail(issue)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function invalidArgReport(issue: string, options: VerifyM068Args): M068Report {
  const check = failedCheck("M068-LOCAL-PREREQUISITES", "invalid_arg", issue);
  return {
    command: "verify:m068",
    generated_at: new Date().toISOString(),
    success: false,
    status_code: "m068_invalid_arg",
    check_ids: [...M068_CHECK_IDS],
    checks: [check],
    failing_check_id: "M068-LOCAL-PREREQUISITES",
    preflight: {
      preflight_only: options.preflightOnly,
      repo: options.repo,
      review_output_key: normalizeIdentifier(options.reviewOutputKey),
      delivery_id: normalizeIdentifier(options.deliveryId),
      publication: buildPublicationPreflight({ reviewOutputKey: normalizeIdentifier(options.reviewOutputKey) }),
    },
    prerequisites: [],
    evidence: {
      candidate_path: "invalid_args",
      reducer_adapter_publication_state: "invalid_args",
      review_details: "invalid_args",
      fallback_classification: "invalid_args",
      visible_volume: "invalid_args",
      artifacts: pendingArtifactEvidence("invalid_args"),
      runtime: { ...EMPTY_RUNTIME_LOG_EVIDENCE, status: "unavailable", issue: "invalid_args" },
    },
    redaction: { leak_marker_count: 0, serialized_report_length: 0, nested_issue_count: 0 },
    issues: [boundedDetail(issue)],
  };
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluateS01?: () => Promise<unknown>;
    evaluateS02?: () => Promise<unknown>;
    evaluateS03?: () => Promise<unknown>;
    collectReviewOutputArtifacts?: (params: { reviewOutputKey: string; repo: string; deliveryId: string | null }) => Promise<ReviewOutputArtifactCollection>;
    queryReviewAuditLogs?: (params: { reviewOutputKey: string; repo: string; deliveryId: string | null }) => Promise<{ query: string; rows: NormalizedLogAnalyticsRow[] }>;
    evaluate?: (params: EvaluateM068Params) => Promise<M068Report>;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const options = parseVerifyM068Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (options.invalidArg) {
    const report = invalidArgReport(options.invalidArg, options);
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM068Report(report));
    return 1;
  }

  const defaultCollectReviewOutputArtifacts = options.preflightOnly || !options.reviewOutputKey
    ? undefined
    : collectReviewOutputArtifactsLive;
  const defaultQueryReviewAuditLogs = options.preflightOnly || !options.reviewOutputKey
    ? undefined
    : queryM068ReviewAuditLogsLive;

  const report = await (deps?.evaluate ?? evaluateM068MilestoneContract)({
    preflightOnly: options.preflightOnly,
    repo: options.repo,
    reviewOutputKey: options.reviewOutputKey,
    deliveryId: options.deliveryId,
    evaluateS01: deps?.evaluateS01,
    evaluateS02: deps?.evaluateS02,
    evaluateS03: deps?.evaluateS03,
    collectReviewOutputArtifacts: deps?.collectReviewOutputArtifacts ?? defaultCollectReviewOutputArtifacts,
    queryReviewAuditLogs: deps?.queryReviewAuditLogs ?? defaultQueryReviewAuditLogs,
  });

  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM068Report(report));

  if (!report.success) {
    stderr.write(`verify:m068 failed: ${report.failing_check_id ?? report.status_code}\n`);
  }

  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
