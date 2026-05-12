#!/usr/bin/env bun

import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { extractReviewOutputKey, parseReviewOutputKey } from "../src/handlers/review-idempotency.ts";
import { discoverLogAnalyticsWorkspaceIds, queryReviewAuditLogs, type NormalizedLogAnalyticsRow } from "../src/review-audit/log-analytics.ts";

export const M069_S05_DEFAULT_TARGET = {
  owner: "xbmc",
  repo: "xbmc",
  pr: 28172,
} as const;

export const M069_S05_LANE_ID = "docs-config-truth" as const;

export const COMMAND_NAME = "verify:m069:s05" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m069-s05.ts" as const;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ARTIFACT_TEXT_LENGTH = 32_000;


export const M069_S05_CHECK_IDS = [
  "M069-S05-LIVE-SOURCE-AVAILABILITY",
  "M069-S05-EXACT-TARGET",
  "M069-S05-REVIEW-DETAILS-EVIDENCE",
  "M069-S05-LOG-CORRELATION-EVIDENCE",
  "M069-S05-TRIGGERED-SPECIALIST",
  "M069-S05-COUNT-METRIC-BOUNDS",
  "M069-S05-REDACTION-PUBLICATION-DENIALS",
  "M069-S05-NO-RAW-PAYLOAD-LEAKAGE",
  "M069-S05-NO-VISIBLE-PUBLICATION",
] as const;

export type M069S05StatusCode =
  | "m069_ok"
  | "m069_blocked_live_access"
  | "m069_not_triggered"
  | "m069_degraded"
  | "m069_visible_publication_violation"
  | "m069_malformed_evidence";

export type M069S05Target = {
  readonly owner: string;
  readonly repo: string;
  readonly pr: number;
};

export type M069S05MetricAvailability = {
  readonly tokenCountAvailable: boolean;
  readonly costAvailable: boolean;
  readonly latencyMsAvailable: boolean;
};

export type M069S05Counts = {
  readonly candidateCount: number;
  readonly decisionCount: number;
  readonly duplicateCount: number;
  readonly disagreementCount: number;
};

export type M069S05PublicationDenials = {
  readonly visiblePublicationDenied: boolean;
  readonly approvalPublicationDenied: boolean;
  readonly publishesFindings: boolean;
  readonly visibleSpecialistFindingPublished: boolean;
  readonly visibleSpecialistCommentPublished: boolean;
  readonly visibleSpecialistApprovalPublished: boolean;
};

export type M069S05RedactionFlags = {
  readonly unsafeFieldCount: number;
  readonly discardedRawPayload: boolean;
  readonly discardedPublicationFields: boolean;
  readonly discardedApprovalFields: boolean;
};

export type M069S05SpecialistStatus = "ok" | "triggered" | "skipped" | "degraded" | "error" | "unclassifiable";

export type M069S05BoundedReviewDetailsEvidence = M069S05Counts & M069S05MetricAvailability & {
  readonly present: boolean;
  readonly laneId: string | null;
  readonly status: M069S05SpecialistStatus | string | null;
  readonly reviewOutputKey: string | null;
  readonly deliveryId: string | null;
  readonly correlationKey: string | null;
  readonly redacted: boolean;
  readonly redactionFlags: M069S05RedactionFlags;
  readonly publicationDenials: M069S05PublicationDenials;
  readonly reason?: string | null;
  readonly [key: string]: unknown;
};

export type M069S05BoundedRuntimeLogEvidence = Partial<M069S05Counts & M069S05MetricAvailability> & {
  readonly present: boolean;
  readonly laneId: string | null;
  readonly status: M069S05SpecialistStatus | string | null;
  readonly reviewOutputKey: string | null;
  readonly deliveryId: string | null;
  readonly correlationKey: string | null;
  readonly publicationDenials?: Partial<M069S05PublicationDenials>;
  readonly reason?: string | null;
  readonly [key: string]: unknown;
};

export type M069S05SourceAvailability = {
  readonly githubReviewDetailsAvailable: boolean;
  readonly githubAccessAvailable?: boolean;
  readonly githubDependency?: "available" | "unavailable";
  readonly logAnalyticsAvailable: boolean;
  readonly azureLogs?: "available" | "unavailable";
  readonly liveAccessBlocked: boolean;
  readonly blockerReason: string | null;
};

export type M069S05Evidence = {
  readonly target: M069S05Target;
  readonly sourceAvailability: M069S05SourceAvailability;
  readonly reviewDetails: M069S05BoundedReviewDetailsEvidence | null;
  readonly runtimeLog: M069S05BoundedRuntimeLogEvidence | null;
  readonly visiblePublication?: Partial<M069S05PublicationDenials> | null;
};

export type M069S05EvaluateOptions = {
  readonly generatedAt?: string;
  readonly proofMode?: "live-required" | "injected-evidence";
  readonly target?: Partial<M069S05Target>;
  readonly reviewOutputKey?: string | null;
  readonly deliveryId?: string | null;
  readonly evidence?: M069S05Evidence | null;
};

export type M069S05CliArgs = {
  readonly json: boolean;
  readonly help: boolean;
  readonly allowBlocked: boolean;
  readonly owner: string;
  readonly repo: string;
  readonly pr: number;
  readonly reviewOutputKey: string | null;
  readonly deliveryId: string | null;
};

export type M069S05VerifierEnv = Record<string, string | undefined>;

export type M069S05ArtifactSource = "review" | "review-comment" | "issue-comment";

export type M069S05GitHubArtifact = {
  readonly source: M069S05ArtifactSource;
  readonly body: string | null;
  readonly state?: string | null;
  readonly updatedAt?: string | null;
};

export type M069S05GitHubCollectorResult = {
  readonly artifacts: readonly M069S05GitHubArtifact[];
  readonly sourceAvailability: Pick<M069S05SourceAvailability, "githubReviewDetailsAvailable" | "githubAccessAvailable" | "githubDependency" | "liveAccessBlocked" | "blockerReason">;
};

export type M069S05RuntimeLogCollectorResult = {
  readonly runtimeLog: M069S05BoundedRuntimeLogEvidence | null;
  readonly sourceAvailability: Pick<M069S05SourceAvailability, "logAnalyticsAvailable" | "azureLogs" | "liveAccessBlocked" | "blockerReason">;
};

export type M069S05Collectors = {
  readonly collectGitHubArtifacts?: (args: M069S05CliArgs) => Promise<M069S05GitHubCollectorResult>;
  readonly collectRuntimeLogs?: (args: M069S05CliArgs, keys: { reviewOutputKey: string | null; deliveryId: string | null }) => Promise<M069S05RuntimeLogCollectorResult>;
};

export type M069S05LeakSummary = {
  readonly rawPayloadLeakCount: number;
  readonly visiblePublicationFieldCount: number;
  readonly approvalFieldCount: number;
  readonly tierModeFieldCount: number;
};

export type M069S05ProofReport = {
  readonly command: typeof COMMAND_NAME;
  readonly generated_at: string;
  readonly proofMode: "live-required" | "injected-evidence";
  readonly proofScope: "production-like-specialist-shadow-proof";
  readonly success: boolean;
  readonly status_code: M069S05StatusCode;
  readonly status_reason: string;
  readonly target: M069S05Target;
  readonly expectedTarget: typeof M069_S05_DEFAULT_TARGET;
  readonly lane: typeof M069_S05_LANE_ID | string | null;
  readonly reviewOutputKey: string | null;
  readonly deliveryId: string | null;
  readonly correlationKey: string | null;
  readonly sourceAvailability: M069S05SourceAvailability;
  readonly counts: M069S05Counts;
  readonly metricAvailability: M069S05MetricAvailability;
  readonly publicationDenials: M069S05PublicationDenials;
  readonly leakSummary: M069S05LeakSummary;
  readonly issues: readonly string[];
  readonly check_ids: typeof M069_S05_CHECK_IDS;
  readonly checks: readonly { readonly id: (typeof M069_S05_CHECK_IDS)[number]; readonly passed: boolean }[];
};

const EMPTY_COUNTS: M069S05Counts = {
  candidateCount: 0,
  decisionCount: 0,
  duplicateCount: 0,
  disagreementCount: 0,
};

const EMPTY_METRIC_AVAILABILITY: M069S05MetricAvailability = {
  tokenCountAvailable: false,
  costAvailable: false,
  latencyMsAvailable: false,
};

const DEFAULT_PUBLICATION_DENIALS: M069S05PublicationDenials = {
  visiblePublicationDenied: true,
  approvalPublicationDenied: true,
  publishesFindings: false,
  visibleSpecialistFindingPublished: false,
  visibleSpecialistCommentPublished: false,
  visibleSpecialistApprovalPublished: false,
};

const BLOCKED_SOURCE_AVAILABILITY: M069S05SourceAvailability = {
  githubReviewDetailsAvailable: false,
  githubAccessAvailable: false,
  githubDependency: "unavailable",
  logAnalyticsAvailable: false,
  azureLogs: "unavailable",
  liveAccessBlocked: true,
  blockerReason: "live GitHub/Log Analytics collectors are not configured for this pure evaluator",
};

const RAW_PAYLOAD_KEYS = new Set([
  "prompt",
  "rawPrompt",
  "systemPrompt",
  "modelOutput",
  "modelText",
  "rawModelOutput",
  "toolPayload",
  "toolResult",
  "toolResults",
  "messages",
  "candidateBody",
  "candidateBodies",
  "candidateFingerprint",
  "candidateFingerprints",
  "artifactBody",
]);

const VISIBLE_PUBLICATION_KEYS = new Set([
  "finding",
  "findings",
  "commentBody",
  "githubCommentBody",
  "inlineComment",
  "inlineComments",
  "issueComment",
  "issueComments",
  "visibleComment",
]);

const APPROVAL_KEYS = new Set(["approval", "approvalBody", "approvalState", "approvedBy", "visibleApproval"]);
const TIER_MODE_KEYS = new Set(["tier", "tierMode", "graduatedTier", "reviewTier"]);
const MAX_STRING_FIELD_LENGTH = 256;

export function buildBlockedM069S05Evidence(target: M069S05Target = M069_S05_DEFAULT_TARGET): M069S05Evidence {
  return {
    target,
    sourceAvailability: BLOCKED_SOURCE_AVAILABILITY,
    reviewDetails: null,
    runtimeLog: null,
    visiblePublication: null,
  };
}

export function buildSyntheticPassingM069S05Evidence(): M069S05Evidence {
  const publicationDenials: M069S05PublicationDenials = {
    visiblePublicationDenied: true,
    approvalPublicationDenied: true,
    publishesFindings: false,
    visibleSpecialistFindingPublished: false,
    visibleSpecialistCommentPublished: false,
    visibleSpecialistApprovalPublished: false,
  };
  const redactionFlags: M069S05RedactionFlags = {
    unsafeFieldCount: 0,
    discardedRawPayload: true,
    discardedPublicationFields: true,
    discardedApprovalFields: true,
  };
  return {
    target: M069_S05_DEFAULT_TARGET,
    sourceAvailability: {
      githubReviewDetailsAvailable: true,
      githubAccessAvailable: true,
      githubDependency: "available",
      logAnalyticsAvailable: true,
      azureLogs: "available",
      liveAccessBlocked: false,
      blockerReason: null,
    },
    reviewDetails: {
      present: true,
      laneId: M069_S05_LANE_ID,
      status: "ok",
      reviewOutputKey: "m069-s05-review-output",
      deliveryId: "m069-s05-delivery",
      correlationKey: "m069-s05-correlation",
      candidateCount: 4,
      decisionCount: 4,
      duplicateCount: 1,
      disagreementCount: 1,
      tokenCountAvailable: true,
      costAvailable: true,
      latencyMsAvailable: true,
      redacted: true,
      redactionFlags,
      publicationDenials,
    },
    runtimeLog: {
      present: true,
      laneId: M069_S05_LANE_ID,
      status: "ok",
      reviewOutputKey: "m069-s05-review-output",
      deliveryId: "m069-s05-delivery",
      correlationKey: "m069-s05-correlation",
      tokenCountAvailable: true,
      costAvailable: true,
      latencyMsAvailable: true,
    },
    visiblePublication: publicationDenials,
  };
}

export function parseM069S05Args(argv: readonly string[]): M069S05CliArgs {
  const parsed: M069S05CliArgs = {
    json: false,
    help: false,
    allowBlocked: false,
    owner: M069_S05_DEFAULT_TARGET.owner,
    repo: M069_S05_DEFAULT_TARGET.repo,
    pr: M069_S05_DEFAULT_TARGET.pr,
    reviewOutputKey: null,
    deliveryId: null,
  };
  const mutable = { ...parsed };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      mutable.json = true;
    } else if (arg === "--help" || arg === "-h") {
      mutable.help = true;
    } else if (arg === "--allow-blocked") {
      mutable.allowBlocked = true;
    } else if (arg === "--owner") {
      mutable.owner = requireValue(argv, ++i, arg);
    } else if (arg === "--repo") {
      mutable.repo = requireValue(argv, ++i, arg);
    } else if (arg === "--pr") {
      mutable.pr = parsePositiveInt(requireValue(argv, ++i, arg), arg);
    } else if (arg === "--review-output-key") {
      mutable.reviewOutputKey = requireValue(argv, ++i, arg);
    } else if (arg === "--delivery-id") {
      mutable.deliveryId = requireValue(argv, ++i, arg);
    } else {
      throw new Error(`invalid_cli_args: unsupported argument ${arg}`);
    }
  }

  return mutable;
}

export function evaluateM069S05Proof(options: M069S05EvaluateOptions = {}): M069S05ProofReport {
  const target = normalizeTarget(options.target);
  const evidence = options.evidence ?? buildBlockedM069S05Evidence(target);
  const issues: string[] = [];
  const checkFailures = new Set<(typeof M069_S05_CHECK_IDS)[number]>();
  const reviewDetails = evidence.reviewDetails;
  const runtimeLog = evidence.runtimeLog;
  const sourceAvailability = evidence.sourceAvailability;
  const counts = extractCounts(reviewDetails);
  const metricAvailability = extractMetricAvailability(reviewDetails);
  const publicationDenials = extractPublicationDenials(reviewDetails, evidence.visiblePublication);
  const leakSummary = combineLeakSummaries(scanLeakSurface(reviewDetails), scanLeakSurface(runtimeLog), scanLeakSurface(evidence.visiblePublication));

  if (sourceAvailability.liveAccessBlocked || !sourceAvailability.githubReviewDetailsAvailable || !sourceAvailability.logAnalyticsAvailable) {
    addIssue(issues, checkFailures, "M069-S05-LIVE-SOURCE-AVAILABILITY", "live GitHub Review Details and Log Analytics evidence are both required");
  }

  if (!isExactTarget(target) || !isExactTarget(evidence.target)) {
    addIssue(issues, checkFailures, "M069-S05-EXACT-TARGET", "target must be exact xbmc/xbmc#28172");
  }

  if (!reviewDetails?.present) {
    addIssue(issues, checkFailures, "M069-S05-REVIEW-DETAILS-EVIDENCE", "Review Details compact specialist line is missing");
  }

  if (!runtimeLog?.present) {
    addIssue(issues, checkFailures, "M069-S05-LOG-CORRELATION-EVIDENCE", "runtime log correlation evidence is missing");
  }

  const reviewOutputKey = reviewDetails?.reviewOutputKey ?? runtimeLog?.reviewOutputKey ?? options.reviewOutputKey ?? null;
  const deliveryId = reviewDetails?.deliveryId ?? runtimeLog?.deliveryId ?? options.deliveryId ?? null;
  const correlationKey = reviewDetails?.correlationKey ?? runtimeLog?.correlationKey ?? null;

  if (!isNonEmptyBoundedString(reviewDetails?.reviewOutputKey)) {
    addIssue(issues, checkFailures, "M069-S05-REVIEW-DETAILS-EVIDENCE", "reviewOutputKey is missing or unbounded");
  }
  if (!isNonEmptyBoundedString(reviewOutputKey)) {
    addIssue(issues, checkFailures, "M069-S05-REVIEW-DETAILS-EVIDENCE", "effective reviewOutputKey is missing or unbounded");
  }
  if (!isNonEmptyBoundedString(reviewDetails?.deliveryId) || !isNonEmptyBoundedString(runtimeLog?.deliveryId)) {
    addIssue(issues, checkFailures, "M069-S05-LOG-CORRELATION-EVIDENCE", "deliveryId is missing or unbounded");
  }
  if (!isNonEmptyBoundedString(deliveryId)) {
    addIssue(issues, checkFailures, "M069-S05-LOG-CORRELATION-EVIDENCE", "effective deliveryId is missing or unbounded");
  }
  if (!isNonEmptyBoundedString(reviewDetails?.correlationKey) || !isNonEmptyBoundedString(runtimeLog?.correlationKey)) {
    addIssue(issues, checkFailures, "M069-S05-LOG-CORRELATION-EVIDENCE", "correlationKey is missing or unbounded");
  }
  if (!isNonEmptyBoundedString(correlationKey)) {
    addIssue(issues, checkFailures, "M069-S05-LOG-CORRELATION-EVIDENCE", "effective correlationKey is missing or unbounded");
  }
  if (options.reviewOutputKey && reviewOutputKey !== options.reviewOutputKey) {
    addIssue(issues, checkFailures, "M069-S05-REVIEW-DETAILS-EVIDENCE", "reviewOutputKey does not match requested key");
  }
  if (options.deliveryId && deliveryId !== options.deliveryId) {
    addIssue(issues, checkFailures, "M069-S05-LOG-CORRELATION-EVIDENCE", "deliveryId does not match requested key");
  }
  if (reviewDetails?.reviewOutputKey && runtimeLog?.reviewOutputKey && reviewDetails.reviewOutputKey !== runtimeLog.reviewOutputKey) {
    addIssue(issues, checkFailures, "M069-S05-LOG-CORRELATION-EVIDENCE", "reviewOutputKey does not correlate between Review Details and runtime log");
  }
  if (reviewDetails?.deliveryId && runtimeLog?.deliveryId && reviewDetails.deliveryId !== runtimeLog.deliveryId) {
    addIssue(issues, checkFailures, "M069-S05-LOG-CORRELATION-EVIDENCE", "deliveryId does not correlate between Review Details and runtime log");
  }
  if (reviewDetails?.correlationKey && runtimeLog?.correlationKey && reviewDetails.correlationKey !== runtimeLog.correlationKey) {
    addIssue(issues, checkFailures, "M069-S05-LOG-CORRELATION-EVIDENCE", "correlationKey does not correlate between Review Details and runtime log");
  }

  if (reviewDetails?.laneId !== M069_S05_LANE_ID || runtimeLog?.laneId !== M069_S05_LANE_ID) {
    addIssue(issues, checkFailures, "M069-S05-TRIGGERED-SPECIALIST", "docs-config-truth lane evidence is required");
  }

  if (isNotTriggeredStatus(reviewDetails?.status) || isNotTriggeredStatus(runtimeLog?.status)) {
    addIssue(issues, checkFailures, "M069-S05-TRIGGERED-SPECIALIST", "shadow specialist evidence was not triggered");
  }

  if (isDegradedStatus(reviewDetails?.status) || isDegradedStatus(runtimeLog?.status)) {
    addIssue(issues, checkFailures, "M069-S05-TRIGGERED-SPECIALIST", "shadow specialist status is degraded/error/unclassifiable");
  }

  if (!hasBoundedCounts(counts) || !hasBoundedMetricAvailability(metricAvailability)) {
    addIssue(issues, checkFailures, "M069-S05-COUNT-METRIC-BOUNDS", "counts and metric availability must be bounded numbers/booleans");
  }

  if (!reviewDetails?.redacted || !redactionFlagsDenyRawPayloads(reviewDetails.redactionFlags) || !publicationDenialsAreStrict(publicationDenials)) {
    addIssue(issues, checkFailures, "M069-S05-REDACTION-PUBLICATION-DENIALS", "redaction and publication-denial flags must prove shadow-only output");
  }

  if (leakSummary.rawPayloadLeakCount > 0 || leakSummary.tierModeFieldCount > 0) {
    addIssue(issues, checkFailures, "M069-S05-NO-RAW-PAYLOAD-LEAKAGE", "raw specialist payload or tier-mode fields are present in bounded evidence");
  }

  if (hasVisiblePublicationViolation(publicationDenials) || leakSummary.visiblePublicationFieldCount > 0 || leakSummary.approvalFieldCount > 0) {
    addIssue(issues, checkFailures, "M069-S05-NO-VISIBLE-PUBLICATION", "visible specialist finding/comment/approval publication is forbidden");
  }

  const status_code = classifyStatus(sourceAvailability, checkFailures, reviewDetails?.status, runtimeLog?.status);
  const success = status_code === "m069_ok";
  return {
    command: COMMAND_NAME,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    proofMode: options.proofMode ?? (options.evidence ? "injected-evidence" : "live-required"),
    proofScope: "production-like-specialist-shadow-proof",
    success,
    status_code,
    status_reason: statusReason(status_code),
    target,
    expectedTarget: M069_S05_DEFAULT_TARGET,
    lane: reviewDetails?.laneId ?? runtimeLog?.laneId ?? null,
    reviewOutputKey,
    deliveryId,
    correlationKey,
    sourceAvailability,
    counts,
    metricAvailability,
    publicationDenials,
    leakSummary,
    issues,
    check_ids: M069_S05_CHECK_IDS,
    checks: M069_S05_CHECK_IDS.map((id) => ({ id, passed: !checkFailures.has(id) })),
  };
}

export async function main(argv = Bun.argv.slice(2), io: {
  readonly stdout?: Pick<typeof Bun.stdout, "write">;
  readonly stderr?: Pick<typeof Bun.stderr, "write">;
  readonly evaluate?: (args: M069S05CliArgs) => M069S05ProofReport | Promise<M069S05ProofReport>;
  readonly collectors?: M069S05Collectors;
} = {}): Promise<number> {
  const stdout = io.stdout ?? Bun.stdout;
  const stderr = io.stderr ?? Bun.stderr;
  let args: M069S05CliArgs;
  try {
    args = parseM069S05Args(argv);
  } catch (error) {
    const report = malformedCliReport(error);
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(helpText());
    return 0;
  }

  try {
    const report = await (io.evaluate?.(args) ?? evaluateM069S05Proof({
      target: { owner: args.owner, repo: args.repo, pr: args.pr },
      reviewOutputKey: args.reviewOutputKey,
      deliveryId: args.deliveryId,
      evidence: await collectM069S05LiveEvidence(args, io.collectors),
      proofMode: "live-required",
    }));
    if (args.json) {
      stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      stdout.write(`${report.status_code}: ${report.status_reason}\n`);
      for (const issue of report.issues) stdout.write(`- ${issue}\n`);
    }
    if (report.success) return 0;
    if (args.allowBlocked && report.status_code === "m069_blocked_live_access") return 0;
    return 1;
  } catch (error) {
    stderr.write(`verify:m069:s05 failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}


export async function collectM069S05LiveEvidence(args: M069S05CliArgs, collectors: M069S05Collectors = {}): Promise<M069S05Evidence> {
  const target = { owner: args.owner, repo: args.repo, pr: args.pr };
  const githubResult = await (collectors.collectGitHubArtifacts?.(args) ?? collectGitHubArtifactsFromLiveGitHub(args));
  const reviewDetails = extractBoundedReviewDetailsFromArtifacts(githubResult.artifacts, {
    owner: args.owner,
    repo: args.repo,
    pr: args.pr,
    requestedReviewOutputKey: args.reviewOutputKey,
  });
  const effectiveReviewOutputKey = reviewDetails?.reviewOutputKey ?? args.reviewOutputKey;
  const effectiveDeliveryId = reviewDetails?.deliveryId ?? args.deliveryId;
  const runtimeResult = await (collectors.collectRuntimeLogs?.(args, {
    reviewOutputKey: effectiveReviewOutputKey,
    deliveryId: effectiveDeliveryId,
  }) ?? collectRuntimeLogsFromLogAnalytics(args, {
    reviewOutputKey: effectiveReviewOutputKey,
    deliveryId: effectiveDeliveryId,
  }));
  const visiblePublication = detectVisiblePublication(githubResult.artifacts);
  return {
    target,
    sourceAvailability: mergeSourceAvailability(
      githubResult.sourceAvailability,
      runtimeResult.sourceAvailability,
      reviewDetails,
      runtimeResult.runtimeLog,
    ),
    reviewDetails,
    runtimeLog: runtimeResult.runtimeLog,
    visiblePublication,
  };
}

async function collectGitHubArtifactsFromLiveGitHub(args: M069S05CliArgs): Promise<M069S05GitHubCollectorResult> {
  const config = await readGitHubVerifierConfig(process.env);
  if (!config.ok) return blockedGitHubResult(config.reason);
  try {
    const appOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId: config.appId, privateKey: config.privateKey },
      request: { timeout: REQUEST_TIMEOUT_MS },
    });
    const installation = await appOctokit.request("GET /repos/{owner}/{repo}/installation", {
      owner: args.owner,
      repo: args.repo,
      request: { timeout: REQUEST_TIMEOUT_MS },
    });
    const installationOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId: config.appId, privateKey: config.privateKey, installationId: installation.data.id },
      request: { timeout: REQUEST_TIMEOUT_MS },
    });
    const [reviews, reviewComments, issueComments] = await Promise.all([
      installationOctokit.rest.pulls.listReviews({ owner: args.owner, repo: args.repo, pull_number: args.pr, per_page: 100, page: 1 }),
      installationOctokit.rest.pulls.listReviewComments({ owner: args.owner, repo: args.repo, pull_number: args.pr, per_page: 100, page: 1, sort: "created", direction: "desc" }),
      installationOctokit.rest.issues.listComments({ owner: args.owner, repo: args.repo, issue_number: args.pr, per_page: 100, page: 1, sort: "created", direction: "desc" }),
    ]);
    const artifacts: M069S05GitHubArtifact[] = [
      ...reviews.data.map((item) => ({ source: "review" as const, body: boundArtifactText(item.body), state: item.state ?? null, updatedAt: item.submitted_at ?? null })),
      ...reviewComments.data.map((item) => ({ source: "review-comment" as const, body: boundArtifactText(item.body), updatedAt: item.updated_at ?? null })),
      ...issueComments.data.map((item) => ({ source: "issue-comment" as const, body: boundArtifactText(item.body), updatedAt: item.updated_at ?? null })),
    ];
    return {
      artifacts,
      sourceAvailability: {
        githubReviewDetailsAvailable: artifacts.some((artifact) => Boolean(extractReviewOutputKey(artifact.body))),
        githubAccessAvailable: true,
        githubDependency: "available",
        liveAccessBlocked: false,
        blockerReason: null,
      },
    };
  } catch (error) {
    return blockedGitHubResult(`github_${classifyExternalError(error)}`);
  }
}

async function readGitHubVerifierConfig(env: M069S05VerifierEnv): Promise<{ ok: true; appId: string; privateKey: string } | { ok: false; reason: string }> {
  const appId = env.GITHUB_APP_ID;
  const keyEnv = env.GITHUB_PRIVATE_KEY ?? env.GITHUB_PRIVATE_KEY_BASE64;
  if (!appId || !keyEnv) return { ok: false, reason: "missing_github_app_config" };
  if (keyEnv.startsWith("-----BEGIN")) return { ok: true, appId, privateKey: keyEnv };
  if (keyEnv.startsWith("/") || keyEnv.startsWith("./")) {
    try {
      return { ok: true, appId, privateKey: await Bun.file(keyEnv).text() };
    } catch {
      return { ok: false, reason: "github_private_key_unreadable" };
    }
  }
  try {
    return { ok: true, appId, privateKey: atob(keyEnv) };
  } catch {
    return { ok: false, reason: "github_private_key_unparseable" };
  }
}

function blockedGitHubResult(reason: string): M069S05GitHubCollectorResult {
  return {
    artifacts: [],
    sourceAvailability: {
      githubReviewDetailsAvailable: false,
      githubAccessAvailable: false,
      githubDependency: "unavailable",
      liveAccessBlocked: true,
      blockerReason: reason,
    },
  };
}

async function collectRuntimeLogsFromLogAnalytics(_args: M069S05CliArgs, keys: { reviewOutputKey: string | null; deliveryId: string | null }): Promise<M069S05RuntimeLogCollectorResult> {
  if (!keys.reviewOutputKey && !keys.deliveryId) return blockedRuntimeResult("missing_correlation_key");
  const workspaceIds = parseWorkspaceIds(process.env.AZURE_LOG_ANALYTICS_WORKSPACE_IDS ?? process.env.AZURE_LOG_ANALYTICS_WORKSPACE_ID ?? process.env.LOG_ANALYTICS_WORKSPACE_IDS ?? process.env.LOG_ANALYTICS_WORKSPACE_ID);
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP ?? process.env.ACA_RESOURCE_GROUP;
  if (workspaceIds.length === 0 && !resourceGroup) return blockedRuntimeResult("missing_log_analytics_config");
  try {
    const discoveredWorkspaceIds = await discoverLogAnalyticsWorkspaceIds({ resourceGroup: resourceGroup ?? "", explicitWorkspaceIds: workspaceIds });
    if (discoveredWorkspaceIds.length === 0) return blockedRuntimeResult("missing_log_analytics_workspace");
    const result = await queryReviewAuditLogs({
      workspaceIds: discoveredWorkspaceIds,
      reviewOutputKey: keys.reviewOutputKey ?? undefined,
      deliveryId: keys.deliveryId ?? undefined,
      messageContains: M069_S05_LANE_ID,
      timespan: process.env.M069_S05_LOG_TIMESPAN ?? "P14D",
      limit: 100,
    });
    const runtimeLog = extractRuntimeLogEvidence(result.rows, keys);
    return {
      runtimeLog,
      sourceAvailability: {
        logAnalyticsAvailable: runtimeLog?.present === true,
        azureLogs: runtimeLog?.present === true ? "available" : "unavailable",
        liveAccessBlocked: runtimeLog?.present !== true,
        blockerReason: runtimeLog?.present === true ? null : "runtime_log_correlation_missing",
      },
    };
  } catch (error) {
    return blockedRuntimeResult(`azure_${classifyExternalError(error)}`);
  }
}

function blockedRuntimeResult(reason: string): M069S05RuntimeLogCollectorResult {
  return {
    runtimeLog: null,
    sourceAvailability: {
      logAnalyticsAvailable: false,
      azureLogs: "unavailable",
      liveAccessBlocked: true,
      blockerReason: reason,
    },
  };
}

function parseWorkspaceIds(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function boundArtifactText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return value.slice(0, MAX_ARTIFACT_TEXT_LENGTH);
}

function extractBoundedReviewDetailsFromArtifacts(artifacts: readonly M069S05GitHubArtifact[], params: { owner: string; repo: string; pr: number; requestedReviewOutputKey: string | null }): M069S05BoundedReviewDetailsEvidence | null {
  for (const artifact of artifacts) {
    const body = artifact.body ?? "";
    const reviewOutputKey = extractReviewOutputKey(body);
    if (!reviewOutputKey) continue;
    if (params.requestedReviewOutputKey && reviewOutputKey !== params.requestedReviewOutputKey) continue;
    const parsed = parseReviewOutputKey(reviewOutputKey);
    if (parsed && (parsed.owner !== params.owner.toLowerCase() || parsed.repo !== params.repo.toLowerCase() || parsed.prNumber !== params.pr)) continue;
    const line = findReviewDetailsLine(body);
    const fields = parseReviewDetailsLine(line);
    return {
      present: Boolean(line),
      laneId: fields.lane,
      status: fields.status,
      reason: fields.reason,
      reviewOutputKey: fields.reviewOutputKey ?? reviewOutputKey,
      deliveryId: fields.deliveryId ?? parsed?.effectiveDeliveryId ?? parsed?.deliveryId ?? null,
      correlationKey: fields.correlationKey,
      candidateCount: fields.candidateCount ?? Number.NaN,
      decisionCount: fields.decisionCount ?? Number.NaN,
      duplicateCount: fields.duplicateCount ?? Number.NaN,
      disagreementCount: fields.disagreementCount ?? Number.NaN,
      tokenCountAvailable: fields.tokenCountAvailable ?? false,
      costAvailable: fields.costAvailable ?? false,
      latencyMsAvailable: fields.latencyMsAvailable ?? false,
      redacted: true,
      redactionFlags: {
        unsafeFieldCount: fields.unsafeFieldCount ?? Number.NaN,
        discardedRawPayload: fields.discardedRawPayload === true,
        discardedPublicationFields: fields.discardedPublicationFields === true,
        discardedApprovalFields: fields.discardedApprovalFields === true,
      },
      publicationDenials: {
        ...DEFAULT_PUBLICATION_DENIALS,
        visiblePublicationDenied: fields.visiblePublicationDenied === true,
        approvalPublicationDenied: fields.approvalPublicationDenied === true,
      },
    };
  }
  return null;
}

type ReviewDetailsLineFields = {
  readonly lane: string | null;
  readonly status: string | null;
  readonly reason: string | null;
  readonly candidateCount: number | null;
  readonly decisionCount: number | null;
  readonly duplicateCount: number | null;
  readonly disagreementCount: number | null;
  readonly tokenCountAvailable: boolean | null;
  readonly costAvailable: boolean | null;
  readonly latencyMsAvailable: boolean | null;
  readonly visiblePublicationDenied: boolean | null;
  readonly approvalPublicationDenied: boolean | null;
  readonly correlationKey: string | null;
  readonly deliveryId: string | null;
  readonly reviewOutputKey: string | null;
  readonly discardedRawPayload: boolean | null;
  readonly discardedPublicationFields: boolean | null;
  readonly discardedApprovalFields: boolean | null;
  readonly unsafeFieldCount: number | null;
};

function findReviewDetailsLine(body: string): string | null {
  const lines = body.split(/\r?\n/);
  return lines.find((line) => line.includes(`lane=${M069_S05_LANE_ID}`) && line.includes("reviewOutputKey=")) ?? null;
}

function parseReviewDetailsLine(line: string | null): ReviewDetailsLineFields {
  const text = line ?? "";
  const metric = /metricAvailability=token:(y|n),cost:(y|n),latency:(y|n)/.exec(text);
  const redacted = /redacted=raw:(y|n),publication:(y|n),approval:(y|n),unsafe:(\d+)/.exec(text);
  return {
    lane: capture(text, /lane=([^\s]+)/),
    status: capture(text, /status=([^\s]+)/),
    reason: capture(text, /reason=([^\s]+)/),
    candidateCount: captureNumber(text, /candidateCount=(\d+)/),
    decisionCount: captureNumber(text, /decisionCount=(\d+)/),
    duplicateCount: captureNumber(text, /duplicateCount=(\d+)/),
    disagreementCount: captureNumber(text, /disagreementCount=(\d+)/),
    tokenCountAvailable: metric ? metric[1] === "y" : null,
    costAvailable: metric ? metric[2] === "y" : null,
    latencyMsAvailable: metric ? metric[3] === "y" : null,
    visiblePublicationDenied: captureBoolean(text, /visiblePublicationDenied=(true|false)/),
    approvalPublicationDenied: captureBoolean(text, /approvalPublicationDenied=(true|false)/),
    correlationKey: capture(text, /correlationKey=([^\s]+)/),
    deliveryId: capture(text, /deliveryId=([^\s]+)/),
    reviewOutputKey: capture(text, /reviewOutputKey=([^\s]+)/),
    discardedRawPayload: redacted ? redacted[1] === "y" : null,
    discardedPublicationFields: redacted ? redacted[2] === "y" : null,
    discardedApprovalFields: redacted ? redacted[3] === "y" : null,
    unsafeFieldCount: redacted ? Number(redacted[4]) : null,
  };
}

function extractRuntimeLogEvidence(rows: readonly NormalizedLogAnalyticsRow[], keys: { reviewOutputKey: string | null; deliveryId: string | null }): M069S05BoundedRuntimeLogEvidence | null {
  for (const row of rows) {
    const parsed = row.parsedLog;
    if (!parsed || row.malformed) continue;
    const reviewOutputKey = getBoundedString(parsed.reviewOutputKey) ?? row.reviewOutputKey;
    const deliveryId = getBoundedString(parsed.deliveryId) ?? row.deliveryId;
    if (keys.reviewOutputKey && reviewOutputKey !== keys.reviewOutputKey) continue;
    if (keys.deliveryId && deliveryId !== keys.deliveryId) continue;
    const laneId = getBoundedString(parsed.laneId) ?? getBoundedString(parsed.lane) ?? (row.rawLog?.includes(M069_S05_LANE_ID) ? M069_S05_LANE_ID : null);
    if (laneId !== M069_S05_LANE_ID) continue;
    return {
      present: true,
      laneId,
      status: getBoundedString(parsed.status) ?? getBoundedString(parsed.shadowSpecialistStatus) ?? "ok",
      reviewOutputKey,
      deliveryId,
      correlationKey: getBoundedString(parsed.correlationKey),
      candidateCount: getBoundedNumber(parsed.candidateCount),
      decisionCount: getBoundedNumber(parsed.decisionCount),
      duplicateCount: getBoundedNumber(parsed.duplicateCount),
      disagreementCount: getBoundedNumber(parsed.disagreementCount),
      tokenCountAvailable: getBoolean(parsed.tokenCountAvailable),
      costAvailable: getBoolean(parsed.costAvailable),
      latencyMsAvailable: getBoolean(parsed.latencyMsAvailable),
      publicationDenials: {
        publishesFindings: getBoolean(parsed.publishesFindings),
        visibleSpecialistFindingPublished: getBoolean(parsed.visibleSpecialistFindingPublished),
        visibleSpecialistCommentPublished: getBoolean(parsed.visibleSpecialistCommentPublished),
        visibleSpecialistApprovalPublished: getBoolean(parsed.visibleSpecialistApprovalPublished),
      },
    };
  }
  return null;
}

function detectVisiblePublication(artifacts: readonly M069S05GitHubArtifact[]): M069S05PublicationDenials {
  let visibleSpecialistCommentPublished = false;
  let visibleSpecialistApprovalPublished = false;
  for (const artifact of artifacts) {
    const body = artifact.body ?? "";
    const hasLane = body.includes(M069_S05_LANE_ID);
    const isReviewDetailsOnly = Boolean(extractReviewOutputKey(body)) && body.includes("<summary>Review Details</summary>");
    if (hasLane && !isReviewDetailsOnly) {
      visibleSpecialistCommentPublished = true;
      if (artifact.source === "review" && artifact.state?.toUpperCase() === "APPROVED") visibleSpecialistApprovalPublished = true;
    }
  }
  return {
    ...DEFAULT_PUBLICATION_DENIALS,
    visibleSpecialistCommentPublished,
    visibleSpecialistApprovalPublished,
    visibleSpecialistFindingPublished: visibleSpecialistCommentPublished,
    publishesFindings: visibleSpecialistCommentPublished || visibleSpecialistApprovalPublished,
  };
}

function mergeSourceAvailability(
  github: M069S05GitHubCollectorResult["sourceAvailability"],
  runtime: M069S05RuntimeLogCollectorResult["sourceAvailability"],
  reviewDetails: M069S05BoundedReviewDetailsEvidence | null,
  runtimeLog: M069S05BoundedRuntimeLogEvidence | null,
): M069S05SourceAvailability {
  const githubReviewDetailsAvailable = github.githubAccessAvailable === true && reviewDetails?.present === true;
  const logAnalyticsAvailable = runtime.azureLogs === "available" && runtimeLog?.present === true;
  const blockerReason = [
    github.blockerReason,
    !githubReviewDetailsAvailable && github.githubAccessAvailable === true ? "github_review_details_missing" : null,
    runtime.blockerReason,
  ].filter(Boolean).join(";") || null;
  return {
    githubReviewDetailsAvailable,
    githubAccessAvailable: github.githubAccessAvailable,
    githubDependency: github.githubDependency,
    logAnalyticsAvailable,
    azureLogs: runtime.azureLogs,
    liveAccessBlocked: github.liveAccessBlocked || runtime.liveAccessBlocked || !githubReviewDetailsAvailable || !logAnalyticsAvailable,
    blockerReason,
  };
}

function classifyExternalError(error: unknown): string {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    if (status === 403 || status === 404) return `access_${status}`;
    if (Number.isInteger(status)) return `http_${status}`;
  }
  if (error instanceof SyntaxError) return "malformed_json";
  if (error instanceof Error && /ENOENT|not found|executable file not found|az/.test(error.message)) return "cli_unavailable";
  return "unavailable";
}

function getBoundedString(value: unknown): string | null {
  return isNonEmptyBoundedString(value) ? value : null;
}

function getBoundedNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function capture(text: string, regex: RegExp): string | null {
  const match = regex.exec(text);
  return match?.[1] && isNonEmptyBoundedString(match[1]) ? match[1] : null;
}

function captureNumber(text: string, regex: RegExp): number | null {
  const match = regex.exec(text);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

function captureBoolean(text: string, regex: RegExp): boolean | null {
  const match = regex.exec(text);
  return match?.[1] === "true" ? true : match?.[1] === "false" ? false : null;
}

function normalizeTarget(target: Partial<M069S05Target> | undefined): M069S05Target {
  return {
    owner: target?.owner ?? M069_S05_DEFAULT_TARGET.owner,
    repo: target?.repo ?? M069_S05_DEFAULT_TARGET.repo,
    pr: target?.pr ?? M069_S05_DEFAULT_TARGET.pr,
  };
}

function isExactTarget(target: M069S05Target): boolean {
  return target.owner === M069_S05_DEFAULT_TARGET.owner && target.repo === M069_S05_DEFAULT_TARGET.repo && target.pr === M069_S05_DEFAULT_TARGET.pr;
}

function extractCounts(evidence: M069S05BoundedReviewDetailsEvidence | null): M069S05Counts {
  if (!evidence) return EMPTY_COUNTS;
  return {
    candidateCount: typeof evidence.candidateCount === "number" ? evidence.candidateCount : Number.NaN,
    decisionCount: typeof evidence.decisionCount === "number" ? evidence.decisionCount : Number.NaN,
    duplicateCount: typeof evidence.duplicateCount === "number" ? evidence.duplicateCount : Number.NaN,
    disagreementCount: typeof evidence.disagreementCount === "number" ? evidence.disagreementCount : Number.NaN,
  };
}

function extractMetricAvailability(evidence: M069S05BoundedReviewDetailsEvidence | null): M069S05MetricAvailability {
  if (!evidence) return EMPTY_METRIC_AVAILABILITY;
  return {
    tokenCountAvailable: evidence.tokenCountAvailable,
    costAvailable: evidence.costAvailable,
    latencyMsAvailable: evidence.latencyMsAvailable,
  };
}

function extractPublicationDenials(reviewDetails: M069S05BoundedReviewDetailsEvidence | null, visiblePublication?: Partial<M069S05PublicationDenials> | null): M069S05PublicationDenials {
  return {
    ...DEFAULT_PUBLICATION_DENIALS,
    ...(reviewDetails?.publicationDenials ?? {}),
    ...(visiblePublication ?? {}),
  };
}

function hasBoundedCounts(counts: M069S05Counts): boolean {
  return Object.values(counts).every((value) => Number.isInteger(value) && value >= 0 && value <= 10_000)
    && counts.decisionCount <= counts.candidateCount
    && counts.duplicateCount <= counts.candidateCount
    && counts.disagreementCount <= counts.candidateCount;
}

function hasBoundedMetricAvailability(metrics: M069S05MetricAvailability): boolean {
  return typeof metrics.tokenCountAvailable === "boolean"
    && typeof metrics.costAvailable === "boolean"
    && typeof metrics.latencyMsAvailable === "boolean"
    && metrics.tokenCountAvailable
    && metrics.costAvailable
    && metrics.latencyMsAvailable;
}

function redactionFlagsDenyRawPayloads(flags: M069S05RedactionFlags | undefined): boolean {
  return Boolean(flags)
    && flags!.unsafeFieldCount === 0
    && flags!.discardedRawPayload === true
    && flags!.discardedPublicationFields === true
    && flags!.discardedApprovalFields === true;
}

function publicationDenialsAreStrict(denials: M069S05PublicationDenials): boolean {
  return denials.visiblePublicationDenied === true
    && denials.approvalPublicationDenied === true
    && denials.publishesFindings === false
    && denials.visibleSpecialistFindingPublished === false
    && denials.visibleSpecialistCommentPublished === false
    && denials.visibleSpecialistApprovalPublished === false;
}

function hasVisiblePublicationViolation(denials: M069S05PublicationDenials): boolean {
  return denials.publishesFindings === true
    || denials.visibleSpecialistFindingPublished === true
    || denials.visibleSpecialistCommentPublished === true
    || denials.visibleSpecialistApprovalPublished === true;
}

function isNotTriggeredStatus(status: unknown): boolean {
  return status === "skipped";
}

function isDegradedStatus(status: unknown): boolean {
  return status === "degraded" || status === "error" || status === "unclassifiable";
}

function addIssue(issues: string[], failures: Set<(typeof M069_S05_CHECK_IDS)[number]>, id: (typeof M069_S05_CHECK_IDS)[number], issue: string): void {
  failures.add(id);
  issues.push(issue);
}

function classifyStatus(
  sourceAvailability: M069S05SourceAvailability,
  failures: Set<(typeof M069_S05_CHECK_IDS)[number]>,
  reviewStatus: unknown,
  logStatus: unknown,
): M069S05StatusCode {
  if (failures.size === 0) return "m069_ok";
  if (failures.has("M069-S05-NO-VISIBLE-PUBLICATION")) return "m069_visible_publication_violation";
  if (isDegradedStatus(reviewStatus) || isDegradedStatus(logStatus)) return "m069_degraded";
  if (isNotTriggeredStatus(reviewStatus) || isNotTriggeredStatus(logStatus)) return "m069_not_triggered";
  if (sourceAvailability.liveAccessBlocked || failures.has("M069-S05-LIVE-SOURCE-AVAILABILITY")) return "m069_blocked_live_access";
  return "m069_malformed_evidence";
}

function statusReason(status: M069S05StatusCode): string {
  switch (status) {
    case "m069_ok": return "exact-target correlated live-like shadow specialist proof passed";
    case "m069_blocked_live_access": return "live GitHub/Log Analytics evidence is unavailable; this is blocked evidence, not operational success";
    case "m069_not_triggered": return "docs-config-truth specialist lane was not triggered";
    case "m069_degraded": return "docs-config-truth specialist lane was degraded or errored";
    case "m069_visible_publication_violation": return "visible specialist finding/comment/approval publication was detected";
    case "m069_malformed_evidence": return "evidence is missing, malformed, unbounded, uncorrelated, or target-mismatched";
  }
}

function scanLeakSurface(value: unknown, seen = new Set<unknown>()): M069S05LeakSummary {
  const summary: M069S05LeakSummary = {
    rawPayloadLeakCount: 0,
    visiblePublicationFieldCount: 0,
    approvalFieldCount: 0,
    tierModeFieldCount: 0,
  };
  if (!value || typeof value !== "object") return summary;
  if (seen.has(value)) return summary;
  seen.add(value);

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (RAW_PAYLOAD_KEYS.has(key)) summary.rawPayloadLeakCount += 1;
    if (VISIBLE_PUBLICATION_KEYS.has(key)) summary.visiblePublicationFieldCount += 1;
    if (APPROVAL_KEYS.has(key)) summary.approvalFieldCount += 1;
    if (TIER_MODE_KEYS.has(key)) summary.tierModeFieldCount += 1;
    if (typeof child === "string" && child.length > MAX_STRING_FIELD_LENGTH) summary.rawPayloadLeakCount += 1;
    const childSummary = scanLeakSurface(child, seen);
    summary.rawPayloadLeakCount += childSummary.rawPayloadLeakCount;
    summary.visiblePublicationFieldCount += childSummary.visiblePublicationFieldCount;
    summary.approvalFieldCount += childSummary.approvalFieldCount;
    summary.tierModeFieldCount += childSummary.tierModeFieldCount;
  }
  return summary;
}

function combineLeakSummaries(...summaries: readonly M069S05LeakSummary[]): M069S05LeakSummary {
  return summaries.reduce<M069S05LeakSummary>((acc, item) => ({
    rawPayloadLeakCount: acc.rawPayloadLeakCount + item.rawPayloadLeakCount,
    visiblePublicationFieldCount: acc.visiblePublicationFieldCount + item.visiblePublicationFieldCount,
    approvalFieldCount: acc.approvalFieldCount + item.approvalFieldCount,
    tierModeFieldCount: acc.tierModeFieldCount + item.tierModeFieldCount,
  }), { rawPayloadLeakCount: 0, visiblePublicationFieldCount: 0, approvalFieldCount: 0, tierModeFieldCount: 0 });
}

function isNonEmptyBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_STRING_FIELD_LENGTH;
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`invalid_cli_args: ${flag} requires a value`);
  if (value.includes(".gsd/") || value.includes(".git/")) throw new Error(`invalid_cli_args: ${flag} value must be bounded text, not a local path`);
  if (value.length > MAX_STRING_FIELD_LENGTH) throw new Error(`invalid_cli_args: ${flag} value is unbounded`);
  return value;
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`invalid_cli_args: ${flag} requires a positive integer`);
  return parsed;
}

function malformedCliReport(error: unknown): M069S05ProofReport {
  return {
    command: COMMAND_NAME,
    generated_at: new Date().toISOString(),
    proofMode: "live-required",
    proofScope: "production-like-specialist-shadow-proof",
    success: false,
    status_code: "m069_malformed_evidence",
    status_reason: "invalid CLI arguments",
    target: M069_S05_DEFAULT_TARGET,
    expectedTarget: M069_S05_DEFAULT_TARGET,
    lane: null,
    reviewOutputKey: null,
    deliveryId: null,
    correlationKey: null,
    sourceAvailability: BLOCKED_SOURCE_AVAILABILITY,
    counts: EMPTY_COUNTS,
    metricAvailability: EMPTY_METRIC_AVAILABILITY,
    publicationDenials: DEFAULT_PUBLICATION_DENIALS,
    leakSummary: { rawPayloadLeakCount: 0, visiblePublicationFieldCount: 0, approvalFieldCount: 0, tierModeFieldCount: 0 },
    issues: [`invalid_cli_args: ${error instanceof Error ? error.message.replace(/^invalid_cli_args: /, "") : "unknown"}`],
    check_ids: M069_S05_CHECK_IDS,
    checks: M069_S05_CHECK_IDS.map((id) => ({ id, passed: false })),
  };
}

function helpText(): string {
  return `Usage: bun scripts/verify-m069-s05.ts [--json] [--allow-blocked] [--owner xbmc] [--repo xbmc] [--pr 28172] [--review-output-key KEY] [--delivery-id ID]\n\nVerifies the M069/S05 docs-config-truth shadow specialist proof contract. Without live collectors, the CLI emits m069_blocked_live_access and success:false.\n`;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
