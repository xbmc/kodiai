import pino from "pino";
import { createGitHubApp } from "../src/auth/github-app.ts";
import {
  buildExplicitLaneEvidenceFromLogs,
  type EvidenceAvailability,
  type ExplicitLaneEvidence,
} from "../src/review-audit/evidence-correlation.ts";
import {
  collectReviewOutputArtifacts,
  evaluateExactReviewOutputProof,
  validateCollapsedApproveReviewBody,
  ReviewOutputArtifactCollectionError,
  type ExactReviewOutputProof,
  type ReviewOutputArtifact,
  type ReviewOutputArtifactCollection,
  type ReviewOutputArtifactCounts,
  type CollapsedApproveReviewBodyValidation,
} from "../src/review-audit/review-output-artifacts.ts";
import {
  discoverLogAnalyticsWorkspaceIds,
  queryReviewAuditLogs,
  type NormalizedLogAnalyticsRow,
} from "../src/review-audit/log-analytics.ts";
import { parseReviewOutputKey } from "../src/handlers/review-idempotency.ts";

type AccessState = "available" | "missing" | "unavailable";

const DEFAULT_REPO = "xbmc/kodiai";
const DEFAULT_TIMESPAN = "P14D";
const DEFAULT_QUERY_LIMIT = 40;
const DEFAULT_RESOURCE_GROUP = "rg-kodiai";
const CLEAN_PUBLISH_RESOLUTIONS = new Set([
  "approval-bridge",
  "idempotency-skip",
  "duplicate-suppressed",
]);

type LiveOctokit = Awaited<ReturnType<ReturnType<typeof createGitHubApp>["getInstallationOctokit"]>>;

type PullRequestRef = {
  prNumber: number;
  reviewOutputKey: string;
};

export type M049S02StatusCode =
  | "m049_s02_ok"
  | "m049_s02_invalid_arg"
  | "m049_s02_missing_github_access"
  | "m049_s02_github_unavailable"
  | "m049_s02_no_matching_artifact"
  | "m049_s02_duplicate_visible_outputs"
  | "m049_s02_wrong_surface"
  | "m049_s02_wrong_review_state"
  | "m049_s02_body_drift"
  | "m049_s02_azure_unavailable"
  | "m049_s02_audit_unavailable"
  | "m049_s02_audit_mismatch";

export type M049S02ReportArtifact = {
  prNumber: number;
  prUrl: string;
  source: ReviewOutputArtifact["source"];
  sourceUrl: string | null;
  updatedAt: string | null;
  action: string;
  lane: ReviewOutputArtifact["lane"];
  reviewState: string | null;
};

export type M049S02Audit = {
  sourceAvailability: {
    telemetry: EvidenceAvailability;
    publishResolution: EvidenceAvailability;
  };
  query: {
    text: string | null;
    timespan: string;
    workspaceCount: number;
    matchedRowCount: number;
  };
  telemetry: ExplicitLaneEvidence["telemetry"];
  publishResolution: string | null;
};

export type M049S02Report = {
  command: "verify:m049:s02";
  generated_at: string;
  repo: string;
  review_output_key: string | null;
  delivery_id: string | null;
  success: boolean;
  status_code: M049S02StatusCode;
  preflight: {
    githubAccess: AccessState;
    azureAccess: AccessState;
  };
  artifactCounts: ReviewOutputArtifactCounts;
  artifact: M049S02ReportArtifact | null;
  bodyContract: CollapsedApproveReviewBodyValidation | null;
  audit: M049S02Audit;
  issues: string[];
};

function emptyArtifactCounts(): ReviewOutputArtifactCounts {
  return {
    reviewComments: 0,
    issueComments: 0,
    reviews: 0,
    total: 0,
  };
}

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

  const [owner, repoName, ...rest] = normalized.split("/");
  if (!owner || !repoName || rest.length > 0) {
    return null;
  }

  return `${owner}/${repoName}`;
}

function readOptionValue(args: string[], index: number): { value: string | null; consumed: boolean } {
  const candidate = args[index + 1];
  if (typeof candidate !== "string" || candidate.startsWith("--")) {
    return {
      value: null,
      consumed: false,
    };
  }

  return {
    value: candidate,
    consumed: true,
  };
}

export function parseVerifyM049S02Args(args: string[]): {
  help?: boolean;
  json?: boolean;
  repo: string;
  reviewOutputKey: string | null;
} {
  let repo = DEFAULT_REPO;
  let reviewOutputKey: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo") {
      const { value, consumed } = readOptionValue(args, index);
      if (value) {
        repo = value;
      }
      if (consumed) {
        index += 1;
      }
      continue;
    }

    if (arg === "--review-output-key") {
      const { value, consumed } = readOptionValue(args, index);
      reviewOutputKey = value;
      if (consumed) {
        index += 1;
      }
    }
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    repo,
    reviewOutputKey,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m049:s02 -- --repo <owner/repo> --review-output-key <key> [--json]",
    "",
    "Options:",
    `  --repo               Repository to verify (default: ${DEFAULT_REPO})`,
    "  --review-output-key  Required explicit reviewOutputKey to verify",
    "  --json               Print machine-readable JSON output",
    "  --help               Show this help",
    "",
    "Environment:",
    "  GITHUB_APP_ID + GITHUB_PRIVATE_KEY(_BASE64)  Required for live GitHub proof",
    "  ACA_RESOURCE_GROUP / AZURE_LOG_WORKSPACE_IDS Optional Azure workspace discovery overrides",
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
    slackWebhookRelaySources: [],
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

function getAzureLogResourceGroup(): string {
  return process.env.ACA_RESOURCE_GROUP ?? DEFAULT_RESOURCE_GROUP;
}

export async function discoverAuditWorkspaceIds(): Promise<string[]> {
  const explicitWorkspaceIds = process.env.AZURE_LOG_WORKSPACE_IDS
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return discoverLogAnalyticsWorkspaceIds({
    resourceGroup: getAzureLogResourceGroup(),
    explicitWorkspaceIds,
  });
}

function buildReportArtifact(artifact: ReviewOutputArtifact | null): M049S02ReportArtifact | null {
  if (!artifact) {
    return null;
  }

  return {
    prNumber: artifact.prNumber,
    prUrl: artifact.prUrl,
    source: artifact.source,
    sourceUrl: artifact.sourceUrl,
    updatedAt: artifact.updatedAt,
    action: artifact.action,
    lane: artifact.lane,
    reviewState: artifact.reviewState,
  };
}

function createBaseReport(params: {
  repo: string;
  generatedAt?: string;
  reviewOutputKey?: string | null;
  deliveryId?: string | null;
  statusCode: M049S02StatusCode;
  success: boolean;
  githubAccess?: AccessState;
  azureAccess?: AccessState;
  artifactCounts?: ReviewOutputArtifactCounts;
  artifact?: ReviewOutputArtifact | null;
  bodyContract?: CollapsedApproveReviewBodyValidation | null;
  auditSourceAvailability?: M049S02Audit["sourceAvailability"];
  queryText?: string | null;
  workspaceCount?: number;
  matchedRowCount?: number;
  telemetry?: ExplicitLaneEvidence["telemetry"];
  publishResolution?: string | null;
  issues?: string[];
}): M049S02Report {
  return {
    command: "verify:m049:s02",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    repo: params.repo,
    review_output_key: params.reviewOutputKey ?? null,
    delivery_id: params.deliveryId ?? null,
    success: params.success,
    status_code: params.statusCode,
    preflight: {
      githubAccess: params.githubAccess ?? "missing",
      azureAccess: params.azureAccess ?? "missing",
    },
    artifactCounts: params.artifactCounts ?? emptyArtifactCounts(),
    artifact: buildReportArtifact(params.artifact ?? null),
    bodyContract: params.bodyContract ?? null,
    audit: {
      sourceAvailability: params.auditSourceAvailability ?? {
        telemetry: params.azureAccess === "unavailable" ? "unavailable" : "missing",
        publishResolution: params.azureAccess === "unavailable" ? "unavailable" : "missing",
      },
      query: {
        text: params.queryText ?? null,
        timespan: DEFAULT_TIMESPAN,
        workspaceCount: params.workspaceCount ?? 0,
        matchedRowCount: params.matchedRowCount ?? 0,
      },
      telemetry: params.telemetry ?? null,
      publishResolution: params.publishResolution ?? null,
    },
    issues: params.issues ?? [],
  };
}

function mapGitHubProofFailure(proof: ExactReviewOutputProof): M049S02StatusCode {
  switch (proof.status) {
    case "missing_artifact":
      return "m049_s02_no_matching_artifact";
    case "duplicate_artifacts":
      return "m049_s02_duplicate_visible_outputs";
    case "wrong_artifact_source":
      return "m049_s02_wrong_surface";
    case "wrong_review_state":
      return "m049_s02_wrong_review_state";
    case "invalid_artifact_metadata":
      return proof.issues.some((issue) => issue.includes("reviewState"))
        ? "m049_s02_wrong_review_state"
        : "m049_s02_body_drift";
    case "body_drift":
      return "m049_s02_body_drift";
    case "ok":
      return "m049_s02_ok";
  }
}

function isMissingGitHubAccessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("GitHub App is not installed")
    || message.includes("Missing GitHub App private key")
    || message.includes("Bad credentials")
    || message.includes("Resource not accessible by integration");
}

function validateArgs(params: {
  repo: string;
  reviewOutputKey: string | null | undefined;
}): {
  repo: string;
  reviewOutputKey: string;
  deliveryId: string;
} | {
  issues: string[];
} {
  const issues: string[] = [];
  const normalizedRepo = normalizeRepo(params.repo);
  const normalizedReviewOutputKey = normalizeIdentifier(params.reviewOutputKey);

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
    if (parsedKey.action !== "mention-review") {
      issues.push("--review-output-key must encode the explicit mention-review action.");
    }

    if (normalizedRepo && parsedKey.repoFullName !== normalizedRepo) {
      issues.push("Provided --repo does not match the repository encoded in --review-output-key.");
    }
  }

  if (issues.length > 0) {
    return { issues };
  }

  return {
    repo: normalizedRepo!,
    reviewOutputKey: normalizedReviewOutputKey,
    deliveryId: parseReviewOutputKey(normalizedReviewOutputKey)!.effectiveDeliveryId,
  };
}

async function collectArtifactsLive(params: {
  repo: string;
  reviewOutputKey: string;
}): Promise<ReviewOutputArtifactCollection> {
  const live = await createLiveGitHubContext(params.repo);
  return collectReviewOutputArtifacts({
    octokit: live.octokit as never,
    reviewOutputKey: params.reviewOutputKey,
  });
}

function buildBodyContract(params: {
  reviewOutputKey: string;
  artifact: ReviewOutputArtifact | null;
  proof: ExactReviewOutputProof;
}): CollapsedApproveReviewBodyValidation | null {
  if (!params.artifact) {
    return params.proof.validation ?? null;
  }

  return validateCollapsedApproveReviewBody({
    reviewOutputKey: params.reviewOutputKey,
    body: params.artifact.body,
  });
}

async function queryExplicitAuditLogs(params: {
  workspaceIds: string[];
  reviewOutputKey: string;
  deliveryId: string;
}): Promise<{ query: string; rows: NormalizedLogAnalyticsRow[] }> {
  return queryReviewAuditLogs({
    workspaceIds: params.workspaceIds,
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
    timespan: DEFAULT_TIMESPAN,
    limit: DEFAULT_QUERY_LIMIT,
  });
}

export async function evaluateM049S02(params: {
  repo: string;
  reviewOutputKey: string;
  generatedAt?: string;
  githubAccess?: AccessState;
  azureAccess?: AccessState;
  workspaceIds?: string[];
  collectArtifacts?: (params: PullRequestRef) => Promise<ReviewOutputArtifactCollection>;
  discoverWorkspaceIds?: () => Promise<string[]>;
  queryLogs?: (params: {
    workspaceIds: string[];
    reviewOutputKey: string;
    deliveryId: string;
    timespan: string;
    limit: number;
  }) => Promise<{ query: string; rows: NormalizedLogAnalyticsRow[] }>;
}): Promise<M049S02Report> {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const validated = validateArgs({
    repo: params.repo,
    reviewOutputKey: params.reviewOutputKey,
  });

  if ("issues" in validated) {
    return createBaseReport({
      repo: params.repo,
      generatedAt,
      reviewOutputKey: normalizeIdentifier(params.reviewOutputKey),
      deliveryId: parseReviewOutputKey(normalizeIdentifier(params.reviewOutputKey) ?? "")?.effectiveDeliveryId ?? null,
      statusCode: "m049_s02_invalid_arg",
      success: false,
      issues: validated.issues,
    });
  }

  let githubAccess = params.githubAccess ?? (hasGitHubEnv() ? "available" : "missing");
  if (githubAccess === "missing") {
    return createBaseReport({
      repo: validated.repo,
      generatedAt,
      reviewOutputKey: validated.reviewOutputKey,
      deliveryId: validated.deliveryId,
      statusCode: "m049_s02_missing_github_access",
      success: false,
      githubAccess,
      azureAccess: params.azureAccess ?? "missing",
      issues: ["GitHub App credentials are unavailable for live explicit-review verification."],
    });
  }

  let collection: ReviewOutputArtifactCollection;
  try {
    collection = await (params.collectArtifacts ?? ((artifactParams) => collectArtifactsLive({
      repo: validated.repo,
      reviewOutputKey: artifactParams.reviewOutputKey,
    })))({
      prNumber: parseReviewOutputKey(validated.reviewOutputKey)!.prNumber,
      reviewOutputKey: validated.reviewOutputKey,
    });
  } catch (error) {
    if (error instanceof ReviewOutputArtifactCollectionError && error.code === "invalid_review_output_key") {
      return createBaseReport({
        repo: validated.repo,
        generatedAt,
        reviewOutputKey: validated.reviewOutputKey,
        deliveryId: validated.deliveryId,
        statusCode: "m049_s02_invalid_arg",
        success: false,
        githubAccess,
        azureAccess: params.azureAccess ?? "missing",
        issues: ["Malformed --review-output-key."],
      });
    }

    const message = error instanceof Error ? error.message : String(error);
    const statusCode = isMissingGitHubAccessError(error)
      ? "m049_s02_missing_github_access"
      : "m049_s02_github_unavailable";

    if (statusCode === "m049_s02_missing_github_access") {
      githubAccess = "missing";
    } else {
      githubAccess = "unavailable";
    }

    return createBaseReport({
      repo: validated.repo,
      generatedAt,
      reviewOutputKey: validated.reviewOutputKey,
      deliveryId: validated.deliveryId,
      statusCode,
      success: false,
      githubAccess,
      azureAccess: params.azureAccess ?? "missing",
      issues: [
        statusCode === "m049_s02_missing_github_access"
          ? `GitHub access is unavailable for ${validated.repo}: ${message}`
          : `GitHub review artifact collection failed: ${message}`,
      ],
    });
  }

  const proof = evaluateExactReviewOutputProof(collection);
  const bodyContract = buildBodyContract({
    reviewOutputKey: validated.reviewOutputKey,
    artifact: proof.artifact,
    proof,
  });

  if (!proof.ok) {
    return createBaseReport({
      repo: validated.repo,
      generatedAt,
      reviewOutputKey: validated.reviewOutputKey,
      deliveryId: validated.deliveryId,
      statusCode: mapGitHubProofFailure(proof),
      success: false,
      githubAccess,
      azureAccess: params.azureAccess ?? "missing",
      artifactCounts: collection.artifactCounts,
      artifact: proof.artifact,
      bodyContract,
      issues: proof.issues,
    });
  }

  let workspaceIds = params.workspaceIds ?? [];
  let azureAccess = params.azureAccess ?? (workspaceIds.length > 0 ? "available" : "missing");

  if (azureAccess === "unavailable") {
    return createBaseReport({
      repo: validated.repo,
      generatedAt,
      reviewOutputKey: validated.reviewOutputKey,
      deliveryId: validated.deliveryId,
      statusCode: "m049_s02_azure_unavailable",
      success: false,
      githubAccess,
      azureAccess,
      artifactCounts: collection.artifactCounts,
      artifact: proof.artifact,
      bodyContract,
      issues: ["Azure Log Analytics access is unavailable for explicit audit correlation."],
    });
  }

  if (!params.workspaceIds) {
    try {
      workspaceIds = await (params.discoverWorkspaceIds ?? discoverAuditWorkspaceIds)();
      azureAccess = workspaceIds.length > 0 ? "available" : "missing";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createBaseReport({
        repo: validated.repo,
        generatedAt,
        reviewOutputKey: validated.reviewOutputKey,
        deliveryId: validated.deliveryId,
        statusCode: "m049_s02_azure_unavailable",
        success: false,
        githubAccess,
        azureAccess: "unavailable",
        artifactCounts: collection.artifactCounts,
        artifact: proof.artifact,
        bodyContract,
        issues: [`Azure workspace discovery failed: ${message}`],
      });
    }
  }

  if (workspaceIds.length === 0) {
    return createBaseReport({
      repo: validated.repo,
      generatedAt,
      reviewOutputKey: validated.reviewOutputKey,
      deliveryId: validated.deliveryId,
      statusCode: "m049_s02_audit_unavailable",
      success: false,
      githubAccess,
      azureAccess,
      artifactCounts: collection.artifactCounts,
      artifact: proof.artifact,
      bodyContract,
      issues: ["No Azure Log Analytics workspaces are available for explicit audit correlation."],
    });
  }

  try {
    const queryResult = await (params.queryLogs ?? queryExplicitAuditLogs)({
      workspaceIds,
      reviewOutputKey: validated.reviewOutputKey,
      deliveryId: validated.deliveryId,
      timespan: DEFAULT_TIMESPAN,
      limit: DEFAULT_QUERY_LIMIT,
    });
    const explicitEvidence = buildExplicitLaneEvidenceFromLogs(queryResult.rows);

    if (explicitEvidence.sourceAvailability.publishResolution !== "present" || !explicitEvidence.publishResolution) {
      return createBaseReport({
        repo: validated.repo,
        generatedAt,
        reviewOutputKey: validated.reviewOutputKey,
        deliveryId: validated.deliveryId,
        statusCode: "m049_s02_audit_unavailable",
        success: false,
        githubAccess,
        azureAccess,
        artifactCounts: collection.artifactCounts,
        artifact: proof.artifact,
        bodyContract,
        auditSourceAvailability: explicitEvidence.sourceAvailability,
        queryText: queryResult.query,
        workspaceCount: workspaceIds.length,
        matchedRowCount: queryResult.rows.length,
        telemetry: explicitEvidence.telemetry,
        publishResolution: explicitEvidence.publishResolution,
        issues: [queryResult.rows.length === 0
          ? "Azure audit logs returned no rows for the requested reviewOutputKey and delivery id."
          : "Azure audit logs did not include a publishResolution for the requested explicit review output."],
      });
    }

    if (!CLEAN_PUBLISH_RESOLUTIONS.has(explicitEvidence.publishResolution)) {
      return createBaseReport({
        repo: validated.repo,
        generatedAt,
        reviewOutputKey: validated.reviewOutputKey,
        deliveryId: validated.deliveryId,
        statusCode: "m049_s02_audit_mismatch",
        success: false,
        githubAccess,
        azureAccess,
        artifactCounts: collection.artifactCounts,
        artifact: proof.artifact,
        bodyContract,
        auditSourceAvailability: explicitEvidence.sourceAvailability,
        queryText: queryResult.query,
        workspaceCount: workspaceIds.length,
        matchedRowCount: queryResult.rows.length,
        telemetry: explicitEvidence.telemetry,
        publishResolution: explicitEvidence.publishResolution,
        issues: [
          `Expected a clean explicit publishResolution (approval-bridge, idempotency-skip, duplicate-suppressed), found ${explicitEvidence.publishResolution}.`,
        ],
      });
    }

    return createBaseReport({
      repo: validated.repo,
      generatedAt,
      reviewOutputKey: validated.reviewOutputKey,
      deliveryId: validated.deliveryId,
      statusCode: "m049_s02_ok",
      success: true,
      githubAccess,
      azureAccess,
      artifactCounts: collection.artifactCounts,
      artifact: proof.artifact,
      bodyContract,
      auditSourceAvailability: explicitEvidence.sourceAvailability,
      queryText: queryResult.query,
      workspaceCount: workspaceIds.length,
      matchedRowCount: queryResult.rows.length,
      telemetry: explicitEvidence.telemetry,
      publishResolution: explicitEvidence.publishResolution,
      issues: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createBaseReport({
      repo: validated.repo,
      generatedAt,
      reviewOutputKey: validated.reviewOutputKey,
      deliveryId: validated.deliveryId,
      statusCode: "m049_s02_azure_unavailable",
      success: false,
      githubAccess,
      azureAccess: "unavailable",
      artifactCounts: collection.artifactCounts,
      artifact: proof.artifact,
      bodyContract,
      issues: [`Azure Log Analytics query failed: ${message}`],
    });
  }
}

function formatBoolean(value: boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "unavailable";
  }

  return String(value);
}

export function renderM049S02Report(report: M049S02Report): string {
  const lines = [
    "# M049 S02 — Explicit Clean Approval Verifier",
    "",
    `Status: ${report.status_code}`,
    `Repo: ${report.repo}`,
    `Review output key: ${report.review_output_key ?? "unavailable"}`,
    `Delivery id: ${report.delivery_id ?? "unavailable"}`,
    `Preflight: github=${report.preflight.githubAccess} azure=${report.preflight.azureAccess}`,
    `Artifact counts: review_comments=${report.artifactCounts.reviewComments} issue_comments=${report.artifactCounts.issueComments} reviews=${report.artifactCounts.reviews} total=${report.artifactCounts.total}`,
  ];

  if (report.artifact) {
    lines.push(
      `Artifact: source=${report.artifact.source} lane=${report.artifact.lane ?? "unavailable"} action=${report.artifact.action} state=${report.artifact.reviewState ?? "unavailable"} updated=${report.artifact.updatedAt ?? "unavailable"}`,
      `Review URL: ${report.artifact.sourceUrl ?? "unavailable"}`,
      `Pull request: ${report.artifact.prUrl}`,
    );
  }

  if (report.bodyContract) {
    lines.push(
      `Body contract: valid=${formatBoolean(report.bodyContract.valid)} decision_approve=${formatBoolean(report.bodyContract.hasDecisionApprove)} issues_none=${formatBoolean(report.bodyContract.hasIssuesNone)} evidence_heading=${formatBoolean(report.bodyContract.hasEvidenceHeading)} only_evidence_bullets=${formatBoolean(report.bodyContract.hasOnlyEvidenceBullets)} evidence_bullets=${report.bodyContract.evidenceBulletCount} exact_marker=${formatBoolean(report.bodyContract.hasExactMarker)} details_wrapper=${formatBoolean(report.bodyContract.hasDetailsWrapper)}`,
    );
  }

  lines.push(
    `Audit: workspaces=${report.audit.query.workspaceCount} matched_rows=${report.audit.query.matchedRowCount} telemetry=${report.audit.sourceAvailability.telemetry} publish_resolution=${report.audit.sourceAvailability.publishResolution}`,
    `Publish resolution: ${report.audit.publishResolution ?? "unavailable"}`,
  );

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
    evaluate?: (params: { repo: string; reviewOutputKey: string }) => Promise<M049S02Report>;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const options = parseVerifyM049S02Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const validated = validateArgs({
    repo: options.repo,
    reviewOutputKey: options.reviewOutputKey,
  });
  if ("issues" in validated) {
    const report = createBaseReport({
      repo: normalizeRepo(options.repo) ?? options.repo,
      reviewOutputKey: normalizeIdentifier(options.reviewOutputKey),
      deliveryId: parseReviewOutputKey(normalizeIdentifier(options.reviewOutputKey) ?? "")?.effectiveDeliveryId ?? null,
      statusCode: "m049_s02_invalid_arg",
      success: false,
      issues: validated.issues,
    });

    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM049S02Report(report));
    return 1;
  }

  try {
    const report = await (deps?.evaluate ?? ((evaluateParams) => evaluateM049S02(evaluateParams)))({
      repo: validated.repo,
      reviewOutputKey: validated.reviewOutputKey,
    });

    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM049S02Report(report));
    return report.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`verify:m049:s02 failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
