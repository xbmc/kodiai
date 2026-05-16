import { readFile } from "node:fs/promises";

import pino from "pino";
import { createGitHubApp } from "../src/auth/github-app.ts";
import { parseReviewOutputKey, type ParsedReviewOutputKey } from "../src/handlers/review-idempotency.ts";
import {
  collectReviewOutputArtifacts,
  evaluateExactReviewOutputProof,
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
  buildM070FixtureScenario,
  evaluateM070VerifierScenario,
  type M070PublicationMode,
  type M070ScenarioName,
  type M070StatusCode,
  type M070VerifierReport,
} from "./verify-m070.ts";

export const COMMAND_NAME = "verify:m070:s06" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m070-s06.ts" as const;
export const DEFAULT_TARGET = "xbmc/xbmc#28172" as const;
export const DEFAULT_REPO = "xbmc/xbmc" as const;

export const M070_S06_CHECK_IDS = [
  "M070-S06-CLI-ARGS",
  "M070-S06-SOURCE-AVAILABILITY",
  "M070-S06-EXACT-KEY-ARTIFACTS",
  "M070-S06-S04-EVALUATOR-STATUS",
  "M070-S06-RUNTIME-CORRELATION",
  "M070-S06-REDACTION-BOUNDARY",
  "M070-S06-PACKAGE-WIRING",
] as const;

export const M070_S06_STATUS_CODES = [
  "m070_s06_candidate_approved_verified_ok",
  "m070_s06_candidate_approved_partial_ok",
  "m070_s06_missing_exact_key_blocked",
  "m070_s06_invalid_or_stale_key_blocked",
  "m070_s06_missing_github_access_blocked",
  "m070_s06_github_unavailable_blocked",
  "m070_s06_no_artifact_blocked",
  "m070_s06_duplicate_artifact_blocked",
  "m070_s06_wrong_artifact_blocked",
  "m070_s06_missing_runtime_correlation_blocked",
  "m070_s06_malformed_aggregate_blocked",
  "m070_s06_direct_fallback_rejected",
  "m070_s06_redaction_violation",
  "m070_s06_package_wiring_drift",
  "m070_s06_invalid_arg",
] as const;

export type M070S06CheckId = (typeof M070_S06_CHECK_IDS)[number];
export type M070S06StatusCode = (typeof M070_S06_STATUS_CODES)[number];

export type M070S06Args = {
  readonly json: boolean;
  readonly help: boolean;
  readonly reviewOutputKey: string | null;
  readonly deliveryId: string | null;
  readonly repo: string;
  readonly correlationKey: string | null;
  readonly target: string;
  readonly expectStatus: M070S06StatusCode | null;
  readonly allowBlocked: boolean;
};

export type M070S06ReviewDetailsArtifact = {
  readonly id: string;
  readonly reviewOutputKey: string;
  readonly deliveryId?: string | null;
  readonly repo?: string | null;
  readonly target?: string | null;
  readonly shortUrl?: string | null;
  readonly aggregateEvidence: unknown;
  readonly publicationMode: M070PublicationMode;
  readonly stale?: boolean;
};

export type M070S06RuntimeLogRow = {
  readonly id: string;
  readonly reviewOutputKey?: string | null;
  readonly deliveryId?: string | null;
  readonly correlationKey?: string | null;
  readonly available: boolean;
};

export type M070S06SourceSnapshot = {
  readonly github: {
    readonly reviewDetailsAvailable: boolean;
    readonly accessPresent: boolean;
    readonly unavailable: boolean;
  };
  readonly reviewDetails: readonly M070S06ReviewDetailsArtifact[];
  readonly runtime: {
    readonly queried: boolean;
    readonly unavailable: boolean;
    readonly rows: readonly M070S06RuntimeLogRow[];
  };
};

export type M070S06Check = {
  readonly id: M070S06CheckId;
  readonly passed: boolean;
  readonly status: "pass" | "fail";
  readonly status_code: M070S06StatusCode;
  readonly detail: string;
};

export type M070S06Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generated_at: string;
  readonly proofMode: "exact-key-live-or-production-like-wrapper";
  readonly proofScope: "s06-exact-key-s04-evaluator-wrapper";
  readonly success: boolean;
  readonly status_code: M070S06StatusCode;
  readonly check_ids: readonly M070S06CheckId[];
  readonly checks: readonly M070S06Check[];
  readonly failing_check_id: M070S06CheckId | null;
  readonly inputs: {
    readonly repo: string;
    readonly target: string;
    readonly reviewOutputKeyPresent: boolean;
    readonly deliveryIdPresent: boolean;
    readonly correlationKeyPresent: boolean;
  };
  readonly sourceAvailability: {
    readonly githubReviewDetailsAvailable: boolean;
    readonly githubAccessPresent: boolean;
    readonly githubUnavailable: boolean;
    readonly runtimeQueried: boolean;
    readonly runtimeUnavailable: boolean;
  };
  readonly artifactCounts: {
    readonly totalReviewDetails: number;
    readonly matchingReviewDetails: number;
    readonly duplicateReviewDetails: number;
    readonly wrongKeyReviewDetails: number;
    readonly staleReviewDetails: number;
  };
  readonly artifactIds: readonly string[];
  readonly shortUrls: readonly string[];
  readonly s04: {
    readonly status_code: M070StatusCode | null;
    readonly success: boolean;
    readonly failing_check_id: M070VerifierReport["failing_check_id"] | null;
    readonly check_ids: readonly M070VerifierReport["check_ids"][number][];
  };
  readonly m070: {
    readonly status_code: M070StatusCode | null;
    readonly success: boolean;
    readonly failing_check_id: M070VerifierReport["failing_check_id"] | null;
    readonly check_ids: readonly M070VerifierReport["check_ids"][number][];
  };
  readonly correlationMetadata: {
    readonly reviewOutputKeyPresent: boolean;
    readonly deliveryIdPresent: boolean;
    readonly correlationKeyPresent: boolean;
    readonly aggregateCorrelationKeyPresent: boolean;
    readonly runtimeLogRowsAvailable: boolean;
    readonly matchingRuntimeRows: number;
  };
  readonly runtimeCorrelation: {
    readonly correlationKeyPresent: boolean;
    readonly runtimeLogRowsAvailable: boolean;
    readonly matchingRuntimeRows: number;
  };
  readonly publicationMode: M070PublicationMode;
  readonly redaction: {
    readonly privateOnly: boolean;
    readonly candidateBodiesIncluded: boolean;
    readonly specialistProseIncluded: boolean;
    readonly rawPromptsIncluded: boolean;
    readonly rawModelOutputIncluded: boolean;
    readonly diffsIncluded: boolean;
    readonly evidencePayloadsIncluded: boolean;
    readonly rawFingerprintsIncluded: boolean;
    readonly candidateAttemptIncluded: boolean;
    readonly candidateKeyIncluded: boolean;
    readonly forbiddenInputFieldPresent: boolean;
    readonly aggregateOnly: boolean;
  };
  readonly packageWiring: {
    readonly scriptName: typeof COMMAND_NAME;
    readonly expected: typeof EXPECTED_PACKAGE_SCRIPT;
    readonly present: boolean;
    readonly matches: boolean;
  };
  readonly issue_categories: readonly string[];
  readonly issues: readonly string[];
};

export type EvaluateM070S06Input = {
  readonly reviewOutputKey?: string | null;
  readonly deliveryId?: string | null;
  readonly repo?: string | null;
  readonly correlationKey?: string | null;
  readonly target?: string | null;
  readonly sources?: M070S06SourceSnapshot;
  readonly generatedAt?: string;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly evaluateS04?: typeof evaluateM070VerifierScenario;
};

export type M070S06CollectorDeps = {
  readonly env?: Record<string, string | undefined>;
  readonly collectReviewOutputArtifacts?: typeof collectReviewOutputArtifacts;
  readonly createInstallationOctokit?: (parsed: ParsedReviewOutputKey, repo: string) => Promise<ReviewOutputArtifactsOctokit>;
  readonly queryRuntimeLogs?: (params: { reviewOutputKey: string; deliveryId: string | null; correlationKey: string | null; env: Record<string, string | undefined> }) => Promise<{ unavailable: boolean; rows: readonly M070S06RuntimeLogRow[] }>;
};

export type M070S06MainDeps = {
  readonly stdout?: { write(chunk: string): void };
  readonly stderr?: { write(chunk: string): void };
  readonly collectSources?: (args: M070S06Args) => Promise<M070S06SourceSnapshot>;
  readonly collectorDeps?: M070S06CollectorDeps;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly generatedAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nextValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`invalid_cli_args: ${flag} requires a value`);
  return value;
}

export function parseM070S06Args(argv: readonly string[]): M070S06Args {
  let json = false;
  let help = false;
  let reviewOutputKey: string | null = null;
  let deliveryId: string | null = null;
  let repo: string = DEFAULT_REPO;
  let correlationKey: string | null = null;
  let target: string = DEFAULT_TARGET;
  let expectStatus: M070S06StatusCode | null = null;
  let allowBlocked = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--allow-blocked") allowBlocked = true;
    else if (arg === "--review-output-key") {
      reviewOutputKey = nextValue(argv, index, arg);
      index++;
    } else if (arg === "--delivery-id") {
      deliveryId = nextValue(argv, index, arg);
      index++;
    } else if (arg === "--repo") {
      repo = nextValue(argv, index, arg);
      index++;
    } else if (arg === "--correlation-key") {
      correlationKey = nextValue(argv, index, arg);
      index++;
    } else if (arg === "--target") {
      target = nextValue(argv, index, arg);
      index++;
    } else if (arg === "--expect-status") {
      const value = nextValue(argv, index, arg);
      if (!M070_S06_STATUS_CODES.includes(value as M070S06StatusCode)) {
        throw new Error(`invalid_cli_args: --expect-status must be one of ${M070_S06_STATUS_CODES.join(",")}`);
      }
      expectStatus = value as M070S06StatusCode;
      index++;
    } else {
      throw new Error(`invalid_cli_args: unsupported argument ${arg}`);
    }
  }

  return { json, help, reviewOutputKey, deliveryId, repo, correlationKey, target, expectStatus, allowBlocked };
}

function compactId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 256);
}

function validExactKey(value: string | null | undefined): boolean {
  const trimmed = compactId(value);
  return trimmed !== null && parseReviewOutputKey(trimmed) !== null;
}

function boundedText(value: unknown, maxLength = 180): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

function boundedErrorText(error: unknown): string {
  return boundedText(error instanceof Error ? error.message : String(error), 180) ?? "unavailable";
}

function hasGitHubEnv(env: Record<string, string | undefined>): boolean {
  return Boolean(env.GITHUB_APP_ID && (env.GITHUB_PRIVATE_KEY || env.GITHUB_PRIVATE_KEY_BASE64));
}

async function loadPrivateKeyFromEnv(env: Record<string, string | undefined>): Promise<string> {
  const keyEnv = env.GITHUB_PRIVATE_KEY ?? env.GITHUB_PRIVATE_KEY_BASE64;
  if (!keyEnv) throw new Error("Missing GitHub App private key environment variable.");
  if (keyEnv.startsWith("-----BEGIN")) return keyEnv;
  if (keyEnv.startsWith("/") || keyEnv.startsWith("./")) return await Bun.file(keyEnv).text();
  return atob(keyEnv);
}

function buildGitHubAppConfig(repo: string, githubPrivateKey: string, env: Record<string, string | undefined>) {
  return {
    githubAppId: env.GITHUB_APP_ID!,
    githubPrivateKey,
    webhookSecret: "unused",
    slackSigningSecret: "unused",
    slackBotToken: "unused",
    slackBotUserId: "unused",
    slackKodiaiChannelId: "unused",
    slackDefaultRepo: repo,
    slackAssistantModel: "unused",
    port: 0,
    logLevel: "silent",
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
    acaResourceGroup: env.ACA_RESOURCE_GROUP ?? env.AZURE_RESOURCE_GROUP ?? "rg-kodiai",
    acaJobName: "caj-kodiai-agent",
  };
}

async function createDefaultInstallationOctokit(parsed: ParsedReviewOutputKey, repo: string, env: Record<string, string | undefined>): Promise<ReviewOutputArtifactsOctokit> {
  const githubPrivateKey = await loadPrivateKeyFromEnv(env);
  const logger = pino({ level: "silent" });
  const githubApp = createGitHubApp(buildGitHubAppConfig(repo, githubPrivateKey, env) as never, logger);
  await githubApp.initialize();
  return await githubApp.getInstallationOctokit(parsed.installationId, { requestTimeoutMs: 15_000 });
}

function splitList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function pickAzureWorkspaceIds(env: Record<string, string | undefined>): string[] {
  return [
    ...splitList(env.AZURE_LOG_ANALYTICS_WORKSPACE_ID),
    ...splitList(env.AZURE_LOG_ANALYTICS_WORKSPACE_IDS),
    ...splitList(env.LOG_ANALYTICS_WORKSPACE_ID),
    ...splitList(env.LOG_ANALYTICS_WORKSPACE_IDS),
  ];
}

function mapRuntimeRow(row: NormalizedLogAnalyticsRow, index: number): M070S06RuntimeLogRow {
  return {
    id: boundedText(row.timeGenerated, 80) ?? `runtime-row-${index + 1}`,
    reviewOutputKey: boundedText(row.reviewOutputKey, 160),
    deliveryId: boundedText(row.deliveryId, 160),
    correlationKey: boundedText(typeof row.parsedLog?.correlationKey === "string" ? row.parsedLog.correlationKey : null, 160),
    available: !row.malformed,
  };
}

async function queryDefaultRuntimeLogs(params: { reviewOutputKey: string; deliveryId: string | null; correlationKey: string | null; env: Record<string, string | undefined> }): Promise<{ unavailable: boolean; rows: readonly M070S06RuntimeLogRow[] }> {
  const explicitWorkspaceIds = pickAzureWorkspaceIds(params.env);
  const resourceGroup = params.env.AZURE_RESOURCE_GROUP ?? params.env.ACA_RESOURCE_GROUP ?? params.env.RESOURCE_GROUP;
  if (explicitWorkspaceIds.length === 0 && !resourceGroup) return { unavailable: false, rows: [] };

  try {
    const workspaceIds = explicitWorkspaceIds.length > 0
      ? explicitWorkspaceIds
      : await discoverLogAnalyticsWorkspaceIds({ resourceGroup: resourceGroup! });
    const result = await queryReviewAuditLogs({
      workspaceIds,
      reviewOutputKey: params.reviewOutputKey,
      deliveryId: params.deliveryId ?? undefined,
      messageContains: "m070",
      timespan: params.env.M070_S06_LOG_TIMESPAN ?? "P14D",
      limit: 50,
    });
    return { unavailable: false, rows: result.rows.map(mapRuntimeRow).slice(0, 10) };
  } catch {
    return { unavailable: true, rows: [] };
  }
}

function parseCountMap(value: string | undefined, keys: readonly string[]): Record<string, number> | null {
  if (!value) return null;
  const out: Record<string, number> = {};
  for (const pair of value.split(",")) {
    const [rawKey, rawValue] = pair.split(":");
    if (!rawKey || rawValue === undefined) continue;
    const n = Number.parseInt(rawValue, 10);
    if (Number.isFinite(n) && n >= 0) out[rawKey] = n;
  }
  for (const key of keys) if (typeof out[key] !== "number") return null;
  return out;
}

function parseReasonCounts(value: string | undefined): Record<string, number> {
  if (!value || value === "none") return {};
  const out: Record<string, number> = {};
  for (const pair of value.split(",").slice(0, 8)) {
    const [rawKey, rawValue] = pair.split(":");
    const n = Number.parseInt(rawValue ?? "", 10);
    if (rawKey && Number.isFinite(n) && n >= 0) out[rawKey] = n;
  }
  return out;
}

function parseStringList(value: string | undefined): string[] {
  if (!value || value === "none") return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 8);
}

function parseMetadata(value: string | undefined): Record<string, unknown> {
  const metadata: Record<string, unknown> = { hasDeliveryId: false, hasReviewOutputKey: false, hasCorrelationKey: false };
  if (!value) return metadata;
  for (const pair of value.split(",")) {
    const [key, raw] = pair.split(":");
    if (!key || raw === undefined) continue;
    if (key === "deliveryId") metadata.hasDeliveryId = raw === "y";
    else if (key === "reviewOutputKey") metadata.hasReviewOutputKey = raw === "y";
    else if (key === "correlationKey") metadata.hasCorrelationKey = raw === "y";
    else if (key === "deliveryIdValue") metadata.deliveryId = boundedText(raw, 160);
    else if (key === "reviewOutputKeyValue") metadata.reviewOutputKey = boundedText(raw, 160);
    else if (key === "correlationKeyValue") metadata.correlationKey = boundedText(raw, 160);
  }
  return metadata;
}

function parseRedaction(value: string | undefined): Record<string, unknown> {
  const flags: Record<string, unknown> = { privateOnly: true };
  if (!value) return flags;
  for (const pair of value.split(",")) {
    const [key, raw] = pair.split(":");
    if (!key || raw === undefined) continue;
    if (key === "privateOnly") flags.privateOnly = raw !== "n";
    else if (key === "candidateBodies") flags.candidateBodiesIncluded = raw === "y";
    else if (key === "specialistProse") flags.specialistProseIncluded = raw === "y";
    else if (key === "rawPrompts") flags.rawPromptsIncluded = raw === "y";
    else if (key === "rawModelOutput") flags.rawModelOutputIncluded = raw === "y";
    else if (key === "diffs") flags.diffsIncluded = raw === "y";
    else if (key === "evidencePayloads") flags.evidencePayloadsIncluded = raw === "y";
    else if (key === "rawFingerprints") flags.rawFingerprintsIncluded = raw === "y";
    else if (key === "publicationEvidence") flags.publicationEvidenceIncluded = raw === "y";
    else if (key === "unsafeFields") flags.unsafeInputFieldCount = Number.parseInt(raw, 10) || 0;
  }
  flags.discardedRawPayload = true;
  flags.discardedPublicationFields = true;
  flags.discardedEvidencePayloads = true;
  flags.candidateAttemptIncluded = false;
  flags.candidateKeyIncluded = false;
  return flags;
}

export function extractM070AggregateEvidenceFromArtifactBody(body: string | null | undefined): unknown {
  if (typeof body !== "string") return null;
  const line = body.split("\n").find((candidate) => candidate.includes("M070 candidate verification publication:"));
  if (!line) return null;
  const segments = Object.fromEntries(line.replace(/^\s*-\s*M070 candidate verification publication:\s*/, "").split("; ").map((part) => {
    const index = part.indexOf("=");
    return index === -1 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
  }));
  const counts = parseCountMap(segments.counts, ["attempted", "allowed", "denied", "published", "skipped", "failed"]);
  const verificationStateCounts = parseCountMap(segments.verification, ["verified", "partially_verified", "unverified", "disproven", "unavailable"]);
  const candidateVerificationCounts = parseCountMap(segments.candidateVerification, ["candidateCount", "evidenceCount", "verifiedCount", "partiallyVerifiedCount", "unverifiedCount", "disprovenCount", "publicationEligibleCount"]);
  if (!counts || !verificationStateCounts || !candidateVerificationCounts) return null;
  return {
    aggregateStatus: boundedText(segments.status, 32) ?? "malformed",
    counts,
    publicationDenialCounts: parseReasonCounts(segments.denialCounts),
    reasonCategories: parseStringList(segments.reasons),
    verificationStateCounts,
    candidateVerificationCounts: {
      duplicateCount: 0,
      disagreementCount: 0,
      unclassifiableCount: 0,
      malformedRecordCount: 0,
      truncatedCandidateCount: 0,
      truncatedEvidenceCount: 0,
      policyCandidateCount: candidateVerificationCounts.candidateCount ?? 0,
      ...candidateVerificationCounts,
    },
    metadata: parseMetadata(segments.metadata),
    redactionFlags: parseRedaction(segments.redaction),
  };
}

function publicationModeFromArtifact(params: { artifact: ReviewOutputArtifact | null; proofOk: boolean; aggregateEvidence: unknown }): M070PublicationMode {
  if (!params.artifact) return { candidateApprovedNonFallback: false, directFallbackEvidence: false };
  if (params.artifact.source === "issue-comment") return { candidateApprovedNonFallback: false, directFallbackEvidence: true };
  return { candidateApprovedNonFallback: params.proofOk, directFallbackEvidence: false };
}

function artifactToReviewDetails(params: { artifact: ReviewOutputArtifact; proofOk: boolean; aggregateEvidence: unknown }): M070S06ReviewDetailsArtifact {
  return {
    id: `${params.artifact.source}:${params.artifact.sourceUrl ?? params.artifact.updatedAt ?? params.artifact.prNumber}`.slice(0, 96),
    reviewOutputKey: params.artifact.reviewOutputKey,
    deliveryId: parseReviewOutputKey(params.artifact.reviewOutputKey)?.effectiveDeliveryId ?? null,
    repo: parseReviewOutputKey(params.artifact.reviewOutputKey)?.repoFullName ?? null,
    target: parseReviewOutputKey(params.artifact.reviewOutputKey) ? `${parseReviewOutputKey(params.artifact.reviewOutputKey)!.repoFullName}#${parseReviewOutputKey(params.artifact.reviewOutputKey)!.prNumber}` : null,
    shortUrl: params.artifact.sourceUrl,
    aggregateEvidence: params.aggregateEvidence,
    publicationMode: publicationModeFromArtifact({ artifact: params.artifact, proofOk: params.proofOk, aggregateEvidence: params.aggregateEvidence }),
  };
}

function mapCollectionToSources(collection: ReviewOutputArtifactCollection): M070S06ReviewDetailsArtifact[] {
  const proof = evaluateExactReviewOutputProof(collection);
  if (proof.artifact) {
    return [artifactToReviewDetails({ artifact: proof.artifact, proofOk: proof.ok, aggregateEvidence: extractM070AggregateEvidenceFromArtifactBody(proof.artifact.body) })];
  }
  return collection.artifacts.slice(0, 5).map((artifact) => artifactToReviewDetails({ artifact, proofOk: false, aggregateEvidence: extractM070AggregateEvidenceFromArtifactBody(artifact.body) }));
}

function makeCheck(id: M070S06CheckId, passed: boolean, statusCode: M070S06StatusCode, detail: string): M070S06Check {
  return { id, passed, status: passed ? "pass" : "fail", status_code: statusCode, detail };
}

function defaultSources(): M070S06SourceSnapshot {
  return {
    github: { reviewDetailsAvailable: false, accessPresent: false, unavailable: false },
    reviewDetails: [],
    runtime: { queried: false, unavailable: false, rows: [] },
  };
}

function parsePackageWiring(packageJsonText: string): M070S06Report["packageWiring"] {
  try {
    const parsed = JSON.parse(packageJsonText) as unknown;
    const actual = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts[COMMAND_NAME] : undefined;
    return { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: typeof actual === "string", matches: actual === EXPECTED_PACKAGE_SCRIPT };
  } catch {
    return { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: false, matches: false };
  }
}

async function readDefaultPackageJsonText(): Promise<string> {
  return readFile(new URL("../package.json", import.meta.url), "utf8");
}

const emptyRedaction: M070S06Report["redaction"] = {
  privateOnly: false,
  candidateBodiesIncluded: false,
  specialistProseIncluded: false,
  rawPromptsIncluded: false,
  rawModelOutputIncluded: false,
  diffsIncluded: false,
  evidencePayloadsIncluded: false,
  rawFingerprintsIncluded: false,
  candidateAttemptIncluded: false,
  candidateKeyIncluded: false,
  forbiddenInputFieldPresent: false,
  aggregateOnly: true,
};

function mapS04Status(report: M070VerifierReport | null): M070S06StatusCode {
  if (report === null) return "m070_s06_malformed_aggregate_blocked";
  if (report.redaction.forbiddenInputFieldPresent
    || report.redaction.candidateBodiesIncluded
    || report.redaction.specialistProseIncluded
    || report.redaction.rawPromptsIncluded
    || report.redaction.rawModelOutputIncluded
    || report.redaction.diffsIncluded
    || report.redaction.evidencePayloadsIncluded
    || report.redaction.rawFingerprintsIncluded
    || report.redaction.candidateAttemptIncluded
    || report.redaction.candidateKeyIncluded) return "m070_s06_redaction_violation";
  if (report.status_code === "m070_candidate_approved_verified_ok") return "m070_s06_candidate_approved_verified_ok";
  if (report.status_code === "m070_candidate_approved_partial_ok") return "m070_s06_candidate_approved_partial_ok";
  if (report.status_code === "m070_direct_fallback_rejected") return "m070_s06_direct_fallback_rejected";
  if (report.status_code === "m070_missing_correlation_blocked") return "m070_s06_missing_runtime_correlation_blocked";
  return "m070_s06_malformed_aggregate_blocked";
}

function isAccepted(statusCode: M070S06StatusCode): boolean {
  return statusCode === "m070_s06_candidate_approved_verified_ok" || statusCode === "m070_s06_candidate_approved_partial_ok";
}

function issueFor(statusCode: M070S06StatusCode): { categories: string[]; issues: string[] } {
  if (isAccepted(statusCode)) return { categories: [], issues: [] };
  const category = statusCode.replace(/^m070_s06_/, "").replace(/_blocked$|_rejected$|_violation$|_drift$|_arg$/g, "").replaceAll("_", "-");
  const messages: Record<M070S06StatusCode, string> = {
    m070_s06_candidate_approved_verified_ok: "",
    m070_s06_candidate_approved_partial_ok: "",
    m070_s06_missing_exact_key_blocked: "Missing reviewOutputKey; exact-key verification cannot prove M070 success.",
    m070_s06_invalid_or_stale_key_blocked: "Review output key is invalid, stale, or refers to stale artifact evidence.",
    m070_s06_missing_github_access_blocked: "GitHub Review Details source access is unavailable or unauthenticated.",
    m070_s06_github_unavailable_blocked: "GitHub Review Details source is temporarily unavailable.",
    m070_s06_no_artifact_blocked: "No Review Details artifact was found for the exact key.",
    m070_s06_duplicate_artifact_blocked: "Multiple Review Details artifacts matched the exact key.",
    m070_s06_wrong_artifact_blocked: "Review Details artifacts were present but none matched the exact key.",
    m070_s06_missing_runtime_correlation_blocked: "Required correlation key or matching runtime log row is missing.",
    m070_s06_malformed_aggregate_blocked: "S04 aggregate evidence was missing, malformed, or policy-rejected without an accepted S06 mapping.",
    m070_s06_direct_fallback_rejected: "Direct fallback-only evidence is blocked and cannot count as M070 success.",
    m070_s06_redaction_violation: "Raw/private evidence was detected at the wrapper boundary and omitted from output.",
    m070_s06_package_wiring_drift: "package.json scripts.verify:m070:s06 is missing or points at the wrong command.",
    m070_s06_invalid_arg: "Invalid CLI arguments.",
  };
  return { categories: [category], issues: [messages[statusCode]] };
}

export function buildM070S06FixtureSources(input: {
  readonly scenario: M070ScenarioName;
  readonly reviewOutputKey: string;
  readonly deliveryId: string;
  readonly correlationKey: string;
  readonly repo: string;
  readonly target: string;
}): M070S06SourceSnapshot {
  const fixture = buildM070FixtureScenario(input.scenario);
  return {
    github: { reviewDetailsAvailable: true, accessPresent: true, unavailable: false },
    reviewDetails: [{
      id: "review-details-1",
      shortUrl: `https://github.com/${input.repo}/pull/${input.target.split("#").at(-1) ?? "28172"}#review-details-1`,
      reviewOutputKey: input.reviewOutputKey,
      deliveryId: input.deliveryId,
      repo: input.repo,
      target: input.target,
      aggregateEvidence: fixture.aggregateEvidence,
      publicationMode: fixture.publicationMode,
    }],
    runtime: { queried: true, unavailable: false, rows: [{ id: "runtime-row-1", reviewOutputKey: input.reviewOutputKey, deliveryId: input.deliveryId, correlationKey: input.correlationKey, available: true }] },
  };
}

export async function evaluateM070S06(input: EvaluateM070S06Input): Promise<M070S06Report> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const repo = compactId(input.repo) ?? DEFAULT_REPO;
  const target = compactId(input.target) ?? DEFAULT_TARGET;
  const reviewOutputKey = compactId(input.reviewOutputKey);
  const deliveryId = compactId(input.deliveryId);
  const correlationKey = compactId(input.correlationKey);
  const sources = input.sources ?? defaultSources();
  const packageWiring = parsePackageWiring(await (input.readPackageJsonText ?? readDefaultPackageJsonText)());
  const totalReviewDetails = sources.reviewDetails.length;
  const parsedReviewOutputKey = reviewOutputKey ? parseReviewOutputKey(reviewOutputKey) : null;
  const exactKeyValid = parsedReviewOutputKey !== null;
  const keyInputMismatch = parsedReviewOutputKey !== null && (
    parsedReviewOutputKey.repoFullName !== repo
    || `${parsedReviewOutputKey.repoFullName}#${parsedReviewOutputKey.prNumber}` !== target
    || (deliveryId !== null && parsedReviewOutputKey.effectiveDeliveryId !== deliveryId)
  );
  const matching = exactKeyValid ? sources.reviewDetails.filter((artifact) => artifact.reviewOutputKey === reviewOutputKey && (artifact.repo == null || artifact.repo === repo) && (artifact.target == null || artifact.target === target)) : [];
  const wrongKeyReviewDetails = exactKeyValid ? sources.reviewDetails.filter((artifact) => artifact.reviewOutputKey !== reviewOutputKey || (artifact.repo != null && artifact.repo !== repo) || (artifact.target != null && artifact.target !== target)).length : totalReviewDetails;
  const staleReviewDetails = matching.filter((artifact) => artifact.stale).length;
  const duplicateReviewDetails = Math.max(0, matching.length - 1);
  const selected = matching.length === 1 && staleReviewDetails === 0 ? matching[0] ?? null : null;
  const selectedMetadata = isRecord(selected?.aggregateEvidence) && isRecord(selected.aggregateEvidence.metadata) ? selected.aggregateEvidence.metadata : {};
  const aggregateCorrelationKey = boundedText(selectedMetadata.correlationKey, 160);
  const effectiveCorrelationKey = correlationKey ?? aggregateCorrelationKey;
  const runtimeEvidenceRequired = sources.runtime.queried && !sources.runtime.unavailable;
  const runtimeMatches = effectiveCorrelationKey === null ? [] : sources.runtime.rows.filter((row) => row.available && row.correlationKey === effectiveCorrelationKey && (reviewOutputKey === null || row.reviewOutputKey == null || row.reviewOutputKey === reviewOutputKey) && (deliveryId === null || row.deliveryId == null || row.deliveryId === deliveryId));

  let s04: M070VerifierReport | null = null;
  if (selected !== null) {
    s04 = (input.evaluateS04 ?? evaluateM070VerifierScenario)({ scenario: "candidate_approved_verified", aggregateEvidence: selected.aggregateEvidence, publicationMode: selected.publicationMode }, { generatedAt });
  }

  let statusCode: M070S06StatusCode;
  if (reviewOutputKey === null) statusCode = "m070_s06_missing_exact_key_blocked";
  else if (!exactKeyValid || keyInputMismatch || staleReviewDetails > 0) statusCode = "m070_s06_invalid_or_stale_key_blocked";
  else if (!sources.github.accessPresent) statusCode = "m070_s06_missing_github_access_blocked";
  else if (sources.github.unavailable || !sources.github.reviewDetailsAvailable) statusCode = "m070_s06_github_unavailable_blocked";
  else if (totalReviewDetails === 0) statusCode = "m070_s06_no_artifact_blocked";
  else if (matching.length === 0) statusCode = "m070_s06_wrong_artifact_blocked";
  else if (matching.length > 1) statusCode = "m070_s06_duplicate_artifact_blocked";
  else if (!packageWiring.matches) statusCode = "m070_s06_package_wiring_drift";
  else if (effectiveCorrelationKey === null || (runtimeEvidenceRequired && runtimeMatches.length === 0)) statusCode = "m070_s06_missing_runtime_correlation_blocked";
  else statusCode = mapS04Status(s04);

  const success = isAccepted(statusCode);
  const redaction = s04 === null ? emptyRedaction : {
    privateOnly: s04.redaction.privateOnly,
    candidateBodiesIncluded: s04.redaction.candidateBodiesIncluded,
    specialistProseIncluded: s04.redaction.specialistProseIncluded,
    rawPromptsIncluded: s04.redaction.rawPromptsIncluded,
    rawModelOutputIncluded: s04.redaction.rawModelOutputIncluded,
    diffsIncluded: s04.redaction.diffsIncluded,
    evidencePayloadsIncluded: s04.redaction.evidencePayloadsIncluded,
    rawFingerprintsIncluded: s04.redaction.rawFingerprintsIncluded,
    candidateAttemptIncluded: s04.redaction.candidateAttemptIncluded,
    candidateKeyIncluded: s04.redaction.candidateKeyIncluded,
    forbiddenInputFieldPresent: s04.redaction.forbiddenInputFieldPresent,
    aggregateOnly: !s04.redaction.candidateBodiesIncluded && !s04.redaction.specialistProseIncluded && !s04.redaction.rawPromptsIncluded && !s04.redaction.rawModelOutputIncluded && !s04.redaction.diffsIncluded && !s04.redaction.evidencePayloadsIncluded && !s04.redaction.rawFingerprintsIncluded && !s04.redaction.candidateAttemptIncluded && !s04.redaction.candidateKeyIncluded,
  };
  const { categories, issues } = issueFor(statusCode);
  const s04Summary = { status_code: s04?.status_code ?? null, success: s04?.success ?? false, failing_check_id: s04?.failing_check_id ?? null, check_ids: s04?.check_ids ?? [] };
  const correlationMetadata = {
    reviewOutputKeyPresent: reviewOutputKey !== null,
    deliveryIdPresent: deliveryId !== null,
    correlationKeyPresent: effectiveCorrelationKey !== null,
    aggregateCorrelationKeyPresent: aggregateCorrelationKey !== null,
    runtimeLogRowsAvailable: runtimeMatches.length > 0,
    matchingRuntimeRows: runtimeMatches.length,
  };

  const checks: M070S06Check[] = [
    makeCheck("M070-S06-CLI-ARGS", reviewOutputKey !== null && exactKeyValid, statusCode, reviewOutputKey !== null && exactKeyValid ? "Exact reviewOutputKey input is present and bounded." : "Exact reviewOutputKey input is missing or invalid."),
    makeCheck("M070-S06-SOURCE-AVAILABILITY", sources.github.accessPresent && sources.github.reviewDetailsAvailable && !sources.github.unavailable, statusCode, sources.github.accessPresent && sources.github.reviewDetailsAvailable && !sources.github.unavailable ? "GitHub Review Details source is available." : "GitHub Review Details source is blocked or unavailable."),
    makeCheck("M070-S06-EXACT-KEY-ARTIFACTS", selected !== null, statusCode, selected !== null ? "Exactly one non-stale Review Details artifact matched the exact key." : "Exact-key artifact cardinality is not accepted."),
    makeCheck("M070-S06-S04-EVALUATOR-STATUS", s04?.success === true && !s04.safety.directFallbackOnly && statusCode !== "m070_s06_malformed_aggregate_blocked" && statusCode !== "m070_s06_direct_fallback_rejected", statusCode, s04?.success === true ? "S04 evaluator accepted aggregate policy evidence." : "S04 evaluator did not accept aggregate policy evidence."),
    makeCheck("M070-S06-RUNTIME-CORRELATION", effectiveCorrelationKey !== null && (!runtimeEvidenceRequired || runtimeMatches.length > 0), statusCode, effectiveCorrelationKey !== null && (!runtimeEvidenceRequired || runtimeMatches.length > 0) ? "Runtime correlation key is present with optional bounded row evidence when queried." : "Runtime correlation evidence is missing."),
    makeCheck("M070-S06-REDACTION-BOUNDARY", redaction.aggregateOnly && !redaction.forbiddenInputFieldPresent, statusCode, redaction.aggregateOnly && !redaction.forbiddenInputFieldPresent ? "Report is aggregate-only with no raw canary surfaces." : "Forbidden raw/private fields were detected and omitted."),
    makeCheck("M070-S06-PACKAGE-WIRING", packageWiring.matches, statusCode, packageWiring.matches ? "package.json script is wired to the S06 verifier." : "package.json script wiring drift detected."),
  ];
  const failingCheck = checks.find((check) => !check.passed) ?? null;

  return {
    command: COMMAND_NAME,
    generated_at: generatedAt,
    proofMode: "exact-key-live-or-production-like-wrapper",
    proofScope: "s06-exact-key-s04-evaluator-wrapper",
    success,
    status_code: statusCode,
    check_ids: M070_S06_CHECK_IDS,
    checks,
    failing_check_id: failingCheck?.id ?? null,
    inputs: { repo, target, reviewOutputKeyPresent: reviewOutputKey !== null, deliveryIdPresent: deliveryId !== null, correlationKeyPresent: effectiveCorrelationKey !== null },
    sourceAvailability: { githubReviewDetailsAvailable: sources.github.reviewDetailsAvailable, githubAccessPresent: sources.github.accessPresent, githubUnavailable: sources.github.unavailable, runtimeQueried: sources.runtime.queried, runtimeUnavailable: sources.runtime.unavailable },
    artifactCounts: { totalReviewDetails, matchingReviewDetails: matching.length, duplicateReviewDetails, wrongKeyReviewDetails, staleReviewDetails },
    artifactIds: matching.slice(0, 5).map((artifact) => artifact.id.slice(0, 96)),
    shortUrls: matching.map((artifact) => artifact.shortUrl).filter((url): url is string => typeof url === "string" && url.length > 0).slice(0, 5).map((url) => url.slice(0, 160)),
    s04: s04Summary,
    m070: s04Summary,
    correlationMetadata,
    runtimeCorrelation: { correlationKeyPresent: effectiveCorrelationKey !== null, runtimeLogRowsAvailable: runtimeMatches.length > 0, matchingRuntimeRows: runtimeMatches.length },
    publicationMode: selected?.publicationMode ?? { candidateApprovedNonFallback: false, directFallbackEvidence: false },
    redaction,
    packageWiring,
    issue_categories: categories,
    issues,
  };
}

function buildInvalidArgReport(issue: string, generatedAt = new Date().toISOString()): M070S06Report {
  const { categories, issues } = issueFor("m070_s06_invalid_arg");
  return {
    command: COMMAND_NAME,
    generated_at: generatedAt,
    proofMode: "exact-key-live-or-production-like-wrapper",
    proofScope: "s06-exact-key-s04-evaluator-wrapper",
    success: false,
    status_code: "m070_s06_invalid_arg",
    check_ids: M070_S06_CHECK_IDS,
    checks: [makeCheck("M070-S06-CLI-ARGS", false, "m070_s06_invalid_arg", issue.slice(0, 160))],
    failing_check_id: "M070-S06-CLI-ARGS",
    inputs: { repo: DEFAULT_REPO, target: DEFAULT_TARGET, reviewOutputKeyPresent: false, deliveryIdPresent: false, correlationKeyPresent: false },
    sourceAvailability: { githubReviewDetailsAvailable: false, githubAccessPresent: false, githubUnavailable: false, runtimeQueried: false, runtimeUnavailable: false },
    artifactCounts: { totalReviewDetails: 0, matchingReviewDetails: 0, duplicateReviewDetails: 0, wrongKeyReviewDetails: 0, staleReviewDetails: 0 },
    artifactIds: [],
    shortUrls: [],
    s04: { status_code: null, success: false, failing_check_id: null, check_ids: [] },
    m070: { status_code: null, success: false, failing_check_id: null, check_ids: [] },
    correlationMetadata: { reviewOutputKeyPresent: false, deliveryIdPresent: false, correlationKeyPresent: false, aggregateCorrelationKeyPresent: false, runtimeLogRowsAvailable: false, matchingRuntimeRows: 0 },
    runtimeCorrelation: { correlationKeyPresent: false, runtimeLogRowsAvailable: false, matchingRuntimeRows: 0 },
    publicationMode: { candidateApprovedNonFallback: false, directFallbackEvidence: false },
    redaction: emptyRedaction,
    packageWiring: { scriptName: COMMAND_NAME, expected: EXPECTED_PACKAGE_SCRIPT, present: false, matches: false },
    issue_categories: categories,
    issues,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m070:s06 --review-output-key <key> [--delivery-id <id>] [--repo owner/name] [--correlation-key <key>] [--target owner/name#pr] [--json] [--expect-status <status>] [--allow-blocked]",
    "",
    "Runs the bounded M070 S06 exact-key wrapper over GitHub Review Details/runtime aggregate evidence and the S04 evaluator.",
    "",
    "Required for live success:",
    "  --review-output-key <key>   Exact kodiai-review-output key for the GitHub Review Details artifact.",
    "",
    "Optional args:",
    "  --delivery-id <id>          Delivery id that must match the exact key when supplied.",
    `  --repo owner/name          Repository scope. Defaults to ${DEFAULT_REPO} for the xbmc/xbmc#28172 live target.`,
    "  --correlation-key <key>     Runtime correlation key; omitted values may be recovered from aggregate metadata.",
    `  --target owner/name#pr      Pull request target. Defaults to ${DEFAULT_TARGET}.`,
    "  --expect-status <status>    Exit 0 only when the bounded status_code matches.",
    "  --allow-blocked            Exit 0 for blocked/rejected reports without treating them as success.",
    "  --json                     Emit the machine-checkable aggregate-only JSON report.",
    "",
    "Environment key names only (values are never emitted):",
    "  GitHub: GITHUB_APP_ID, GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_BASE64.",
    "  Optional Azure/runtime: AZURE_LOG_ANALYTICS_WORKSPACE_ID(S), LOG_ANALYTICS_WORKSPACE_ID(S), AZURE_RESOURCE_GROUP, ACA_RESOURCE_GROUP, RESOURCE_GROUP, M070_S06_LOG_TIMESPAN.",
    "",
    "Blocked-state semantics:",
    "  success:false with status_code ending in _blocked/_rejected/_violation/_drift is a truthful non-success report, not fallback success.",
    "  Missing keys default to m070_s06_missing_exact_key_blocked; direct fallback-only evidence is m070_s06_direct_fallback_rejected.",
    "",
  ].join("\n");
}

export async function collectM070S06Sources(args: M070S06Args, deps: M070S06CollectorDeps = {}): Promise<M070S06SourceSnapshot> {
  const env = deps.env ?? process.env;
  const reviewOutputKey = compactId(args.reviewOutputKey);
  const parsed = reviewOutputKey ? parseReviewOutputKey(reviewOutputKey) : null;
  if (!reviewOutputKey || !parsed) return defaultSources();

  const github = { reviewDetailsAvailable: false, accessPresent: hasGitHubEnv(env), unavailable: false };
  let reviewDetails: readonly M070S06ReviewDetailsArtifact[] = [];

  if (!github.accessPresent) {
    return { github, reviewDetails, runtime: { queried: false, unavailable: false, rows: [] } };
  }

  try {
    const octokit = deps.createInstallationOctokit
      ? await deps.createInstallationOctokit(parsed, args.repo)
      : await createDefaultInstallationOctokit(parsed, args.repo, env);
    const collection = await (deps.collectReviewOutputArtifacts ?? collectReviewOutputArtifacts)({ octokit, reviewOutputKey });
    github.reviewDetailsAvailable = true;
    reviewDetails = mapCollectionToSources(collection);
  } catch (error) {
    github.unavailable = true;
    const issue = boundedErrorText(error);
    void issue;
  }

  const runtimeQuery = deps.queryRuntimeLogs ?? queryDefaultRuntimeLogs;
  const runtime = await runtimeQuery({
    reviewOutputKey,
    deliveryId: args.deliveryId ?? parsed.effectiveDeliveryId,
    correlationKey: args.correlationKey,
    env,
  });

  return {
    github,
    reviewDetails,
    runtime: { queried: runtime.rows.length > 0 || runtime.unavailable || pickAzureWorkspaceIds(env).length > 0 || Boolean(env.AZURE_RESOURCE_GROUP ?? env.ACA_RESOURCE_GROUP ?? env.RESOURCE_GROUP), unavailable: runtime.unavailable, rows: runtime.rows },
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2), deps: M070S06MainDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const generatedAt = deps.generatedAt ?? new Date().toISOString();
  let args: M070S06Args;
  try {
    args = parseM070S06Args(argv);
  } catch (error) {
    const report = buildInvalidArgReport(error instanceof Error ? error.message : "invalid_cli_args", generatedAt);
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(usage());
    return 0;
  }

  const sources = await (deps.collectSources ?? ((collectorArgs) => collectM070S06Sources(collectorArgs, deps.collectorDeps)))(args);
  const report = await evaluateM070S06({
    reviewOutputKey: args.reviewOutputKey,
    deliveryId: args.deliveryId,
    repo: args.repo,
    correlationKey: args.correlationKey,
    target: args.target,
    sources,
    readPackageJsonText: deps.readPackageJsonText,
    generatedAt,
  });

  if (args.json) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else stdout.write(`${report.status_code} success=${report.success} failing_check_id=${report.failing_check_id ?? "none"}\n`);

  if (args.expectStatus !== null) return report.status_code === args.expectStatus ? 0 : 1;
  if (report.success || args.allowBlocked) return 0;
  stderr.write(`M070 S06 verifier blocked: ${report.status_code}\n`);
  return 1;
}

if (import.meta.main) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
