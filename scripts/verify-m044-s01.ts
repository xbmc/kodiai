import pino from "pino";
import { createDbClient, type Sql } from "../src/db/client.ts";
import { createGitHubApp } from "../src/auth/github-app.ts";
import {
  buildAutomaticLaneLogEvidence,
  buildExplicitLaneEvidenceFromLogs,
  classifyReviewArtifactEvidence,
  loadAutomaticLaneEvidence,
  type AutomaticLaneLogEvidence,
  type ExplicitLaneEvidence,
} from "../src/review-audit/evidence-correlation.ts";
import {
  collectLatestReviewArtifacts,
  selectRecentReviewSample,
  type RecentReviewArtifact,
  type RecentReviewSampleSelection,
} from "../src/review-audit/recent-review-sample.ts";
import {
  discoverLogAnalyticsWorkspaceIds,
  queryReviewAuditLogs,
} from "../src/review-audit/log-analytics.ts";
import { parseReviewOutputKey } from "../src/handlers/review-idempotency.ts";

type PullRequestRef = { number: number; html_url: string };
type AccessState = "available" | "missing" | "unavailable";

type M044S01ArtifactReport = RecentReviewArtifact & {
  verdict: string;
  rationale: string;
  sourceAvailability: Record<string, string>;
  signals: string[];
};

type M044S01Summary = {
  totalArtifacts: number;
  verdictCounts: Record<string, number>;
  laneCounts: Record<string, number>;
};

export type M044S01Report = {
  command: "verify:m044:s01";
  generated_at: string;
  repo: string;
  limit: number;
  success: boolean;
  status_code: "m044_s01_ok" | "m044_s01_missing_github_access" | "m044_s01_no_recent_artifacts";
  preflight: {
    githubAccess: AccessState;
    databaseAccess: AccessState;
    azureLogAccess: AccessState;
    explicitPublishResolution: "unavailable";
  };
  selection: RecentReviewSampleSelection & {
    scannedPullRequests: number;
    collectedArtifacts: number;
  };
  summary: M044S01Summary;
  artifacts: M044S01ArtifactReport[];
};

export function parseVerifyM044S01Args(args: string[]): {
  help?: boolean;
  json?: boolean;
  repo: string;
  limit: number;
} {
  let repo = "xbmc/xbmc";
  let limit = 12;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo") {
      repo = args[index + 1] ?? repo;
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const value = args[index + 1];
      if (value && /^\d+$/.test(value) && Number.parseInt(value, 10) > 0) {
        limit = Number.parseInt(value, 10);
      }
      index += 1;
      continue;
    }
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    repo,
    limit,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m044:s01 -- --repo <owner/repo> [--limit <n>] [--json]",
    "",
    "Options:",
    "  --repo    Repository to audit (default: xbmc/xbmc)",
    "  --limit   Number of PRs in the final sample (default: 12)",
    "  --json    Print machine-readable JSON output",
    "  --help    Show this help",
    "",
    "Environment:",
    "  GITHUB_APP_ID + GITHUB_PRIVATE_KEY(_BASE64)  Required for live GitHub sampling",
    "  DATABASE_URL                               Optional for automatic-lane durable evidence",
  ].join("\n");
}

function parseRepo(repo: string): { owner: string; repoName: string } {
  const [owner, repoName, ...rest] = repo.split("/");
  if (!owner || !repoName || rest.length > 0) {
    throw new Error(`Invalid repo '${repo}'. Expected owner/repo.`);
  }
  return { owner, repoName };
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
    acaResourceGroup: "rg-kodiai",
    acaJobName: "caj-kodiai-agent",
  };
}

async function createLiveGitHubContext(repo: string) {
  const logger = pino({ level: "silent" });
  const githubPrivateKey = await loadPrivateKeyFromEnv();
  const githubApp = createGitHubApp(buildGitHubAppConfig(repo, githubPrivateKey) as never, logger);
  await githubApp.initialize();

  const { owner, repoName } = parseRepo(repo);
  const installationContext = await githubApp.getRepoInstallationContext(owner, repoName);
  if (!installationContext) {
    throw new Error(`GitHub App is not installed on ${repo}.`);
  }

  const octokit = await githubApp.getInstallationOctokit(installationContext.installationId);
  return { octokit, owner, repoName };
}

async function listRecentPullRequests(params: {
  octokit: Awaited<ReturnType<ReturnType<typeof createGitHubApp>["getInstallationOctokit"]>>;
  owner: string;
  repoName: string;
  maxPullRequests: number;
}): Promise<PullRequestRef[]> {
  const pullRequests: PullRequestRef[] = [];

  for (let page = 1; pullRequests.length < params.maxPullRequests; page += 1) {
    const response = await params.octokit.rest.pulls.list({
      owner: params.owner,
      repo: params.repoName,
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: 100,
      page,
    });

    for (const pullRequest of response.data) {
      if (!pullRequest.html_url) {
        continue;
      }
      pullRequests.push({
        number: pullRequest.number,
        html_url: pullRequest.html_url,
      });
      if (pullRequests.length >= params.maxPullRequests) {
        break;
      }
    }

    if (response.data.length < 100) {
      break;
    }
  }

  return pullRequests;
}

function getAzureLogResourceGroup(): string {
  return process.env.ACA_RESOURCE_GROUP ?? "rg-kodiai";
}

async function discoverAuditWorkspaceIds(): Promise<string[]> {
  const explicitWorkspaceIds = process.env.AZURE_LOG_WORKSPACE_IDS
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return discoverLogAnalyticsWorkspaceIds({
    resourceGroup: getAzureLogResourceGroup(),
    explicitWorkspaceIds,
  });
}

async function loadAutomaticLogEvidenceFromAzure(params: {
  workspaceIds: string[];
  artifact: RecentReviewArtifact;
}): Promise<AutomaticLaneLogEvidence> {
  if (params.workspaceIds.length === 0) {
    return {
      sourceAvailability: { azureLogs: "missing" },
      evidenceBundleOutcome: null,
      reviewOutputPublicationState: null,
      idempotencyDecision: null,
    };
  }

  const parsed = parseReviewOutputKey(params.artifact.reviewOutputKey);
  if (!parsed) {
    return {
      sourceAvailability: { azureLogs: "unavailable" },
      evidenceBundleOutcome: null,
      reviewOutputPublicationState: null,
      idempotencyDecision: null,
    };
  }

  const result = await queryReviewAuditLogs({
    workspaceIds: params.workspaceIds,
    reviewOutputKey: params.artifact.reviewOutputKey,
    deliveryId: parsed.effectiveDeliveryId,
    timespan: "P14D",
    limit: 40,
  });

  return buildAutomaticLaneLogEvidence(result.rows);
}

async function loadExplicitLaneEvidenceFromAzure(params: {
  workspaceIds: string[];
  artifact: RecentReviewArtifact;
}): Promise<ExplicitLaneEvidence> {
  if (params.workspaceIds.length === 0) {
    return {
      sourceAvailability: {
        telemetry: "missing",
        publishResolution: "missing",
      },
      telemetry: null,
      publishResolution: null,
    };
  }

  const parsed = parseReviewOutputKey(params.artifact.reviewOutputKey);
  if (!parsed) {
    return {
      sourceAvailability: {
        telemetry: "unavailable",
        publishResolution: "unavailable",
      },
      telemetry: null,
      publishResolution: null,
    };
  }

  const result = await queryReviewAuditLogs({
    workspaceIds: params.workspaceIds,
    reviewOutputKey: params.artifact.reviewOutputKey,
    deliveryId: parsed.effectiveDeliveryId,
    timespan: "P14D",
    limit: 40,
  });

  return buildExplicitLaneEvidenceFromLogs(result.rows);
}

function buildAuditSummary(artifacts: M044S01ArtifactReport[]): M044S01Summary {
  const verdictCounts: Record<string, number> = {
    "clean-valid": 0,
    "findings-published": 0,
    "publish-failure": 0,
    "suspicious-approval": 0,
    "indeterminate": 0,
  };
  const laneCounts: Record<string, number> = {
    automatic: 0,
    explicit: 0,
  };

  for (const artifact of artifacts) {
    verdictCounts[artifact.verdict] = (verdictCounts[artifact.verdict] ?? 0) + 1;
    laneCounts[artifact.lane] = (laneCounts[artifact.lane] ?? 0) + 1;
  }

  return {
    totalArtifacts: artifacts.length,
    verdictCounts,
    laneCounts,
  };
}

export function renderM044S01Report(report: M044S01Report): string {
  const lines = [
    "# M044 S01 — Recent Review Audit",
    "",
    `Status: ${report.status_code}`,
    `Repo: ${report.repo}`,
    `Limit: ${report.limit}`,
    `Preflight: github=${report.preflight.githubAccess} db=${report.preflight.databaseAccess} azure_logs=${report.preflight.azureLogAccess} explicit_publish_resolution=${report.preflight.explicitPublishResolution}`,
    `Selection: scanned_prs=${report.selection.scannedPullRequests} collected_artifacts=${report.selection.collectedArtifacts} selected=${report.artifacts.length} auto=${report.selection.selectedLaneCounts.automatic} explicit=${report.selection.selectedLaneCounts.explicit} fill=${report.selection.fillCount}`,
    `Summary: total=${report.summary.totalArtifacts} clean-valid=${report.summary.verdictCounts["clean-valid"] ?? 0} findings-published=${report.summary.verdictCounts["findings-published"] ?? 0} publish-failure=${report.summary.verdictCounts["publish-failure"] ?? 0} suspicious-approval=${report.summary.verdictCounts["suspicious-approval"] ?? 0} indeterminate=${report.summary.verdictCounts["indeterminate"] ?? 0}`,
    "",
  ];

  if (report.artifacts.length === 0) {
    lines.push("No sampled artifacts.");
    return `${lines.join("\n")}\n`;
  }

  for (const artifact of report.artifacts) {
    lines.push(
      `- PR #${artifact.prNumber} [${artifact.lane}] ${artifact.verdict} source=${artifact.source} updated=${artifact.updatedAt}`,
      `  key=${artifact.reviewOutputKey}`,
      `  rationale=${artifact.rationale}`,
      `  source_availability=${JSON.stringify(artifact.sourceAvailability)}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function evaluateM044S01(params: {
  repo: string;
  limit: number;
  generatedAt?: string;
  githubAccess?: AccessState;
  databaseAccess?: AccessState;
  azureLogAccess?: AccessState;
  loadPullRequests?: () => Promise<PullRequestRef[]>;
  collectArtifacts?: (pullRequests: PullRequestRef[]) => Promise<RecentReviewArtifact[]>;
  loadAutomaticLaneEvidence?: (artifact: RecentReviewArtifact) => Promise<Awaited<ReturnType<typeof loadAutomaticLaneEvidence>>>;
  loadAutomaticLogEvidence?: (artifact: RecentReviewArtifact) => Promise<AutomaticLaneLogEvidence>;
  loadExplicitLaneEvidence?: (artifact: RecentReviewArtifact) => Promise<ExplicitLaneEvidence>;
}): Promise<M044S01Report> {
  const generated_at = params.generatedAt ?? new Date().toISOString();
  const githubAccess = params.githubAccess ?? (hasGitHubEnv() ? "available" : "missing");
  let databaseAccess: AccessState = params.databaseAccess ?? (process.env.DATABASE_URL ? "available" : "missing");
  let azureLogAccess: AccessState = params.azureLogAccess ?? "missing";

  if (githubAccess === "missing") {
    return {
      command: "verify:m044:s01",
      generated_at,
      repo: params.repo,
      limit: params.limit,
      success: false,
      status_code: "m044_s01_missing_github_access",
      preflight: {
        githubAccess,
        databaseAccess,
        azureLogAccess,
        explicitPublishResolution: "unavailable",
      },
      selection: {
        scannedPullRequests: 0,
        collectedArtifacts: 0,
        perLaneLimit: Math.max(1, Math.ceil(params.limit / 2)),
        totalLimit: params.limit,
        candidateLaneCounts: { automatic: 0, explicit: 0 },
        selectedLaneCounts: { automatic: 0, explicit: 0 },
        fillCount: 0,
      },
      summary: buildAuditSummary([]),
      artifacts: [],
    };
  }

  let db: ReturnType<typeof createDbClient> | null = null;
  try {
    const loadPullRequests = params.loadPullRequests ?? (async () => {
      const live = await createLiveGitHubContext(params.repo);
      return listRecentPullRequests({
        octokit: live.octokit,
        owner: live.owner,
        repoName: live.repoName,
        maxPullRequests: Math.max(params.limit * 8, 50),
      });
    });

    const collectArtifacts = params.collectArtifacts ?? (async (pullRequests: PullRequestRef[]) => {
      const live = await createLiveGitHubContext(params.repo);
      return collectLatestReviewArtifacts({
        octokit: live.octokit as never,
        owner: live.owner,
        repo: live.repoName,
        pullRequests,
      });
    });

    if (!params.loadAutomaticLaneEvidence && databaseAccess === "available") {
      db = createDbClient({ logger: pino({ level: "silent" }) });
    }
    const sql = db?.sql ?? null;

    let workspaceIds: string[] = [];
    if (params.azureLogAccess === undefined && (!params.loadAutomaticLogEvidence || !params.loadExplicitLaneEvidence)) {
      try {
        workspaceIds = await discoverAuditWorkspaceIds();
        azureLogAccess = workspaceIds.length > 0 ? "available" : "missing";
      } catch {
        azureLogAccess = "unavailable";
        workspaceIds = [];
      }
    }

    const loadAutomaticEvidence = params.loadAutomaticLaneEvidence ?? (async (artifact: RecentReviewArtifact) =>
      loadAutomaticLaneEvidence({ sql, artifact })
    );
    const loadAutomaticLogEvidence = params.loadAutomaticLogEvidence ?? (async (artifact: RecentReviewArtifact) =>
      loadAutomaticLogEvidenceFromAzure({ workspaceIds, artifact })
    );
    const loadExplicitEvidence = params.loadExplicitLaneEvidence ?? (async (artifact: RecentReviewArtifact) =>
      loadExplicitLaneEvidenceFromAzure({ workspaceIds, artifact })
    );

    const pullRequests = await loadPullRequests();
    const collectedArtifacts = await collectArtifacts(pullRequests);
    const sample = selectRecentReviewSample(collectedArtifacts, {
      perLaneLimit: Math.max(1, Math.ceil(params.limit / 2)),
      totalLimit: params.limit,
    });

    if (sample.artifacts.length === 0) {
      return {
        command: "verify:m044:s01",
        generated_at,
        repo: params.repo,
        limit: params.limit,
        success: false,
        status_code: "m044_s01_no_recent_artifacts",
        preflight: {
          githubAccess,
          databaseAccess,
          azureLogAccess,
          explicitPublishResolution: "unavailable",
        },
        selection: {
          scannedPullRequests: pullRequests.length,
          collectedArtifacts: collectedArtifacts.length,
          ...sample.selection,
        },
        summary: buildAuditSummary([]),
        artifacts: [],
      };
    }

    const artifactReports: M044S01ArtifactReport[] = [];
    for (const artifact of sample.artifacts) {
      const classification = artifact.lane === "automatic"
        ? classifyReviewArtifactEvidence({
            artifact,
            automaticEvidence: await (async () => {
              try {
                return await loadAutomaticEvidence(artifact);
              } catch {
                databaseAccess = "unavailable";
                return await loadAutomaticLaneEvidence({ sql: null, artifact });
              }
            })(),
            automaticLogEvidence: await (async () => {
              try {
                return await loadAutomaticLogEvidence(artifact);
              } catch {
                azureLogAccess = "unavailable";
                return {
                  sourceAvailability: { azureLogs: "unavailable" },
                  evidenceBundleOutcome: null,
                  reviewOutputPublicationState: null,
                  idempotencyDecision: null,
                } as AutomaticLaneLogEvidence;
              }
            })(),
          })
        : classifyReviewArtifactEvidence({
            artifact,
            explicitEvidence: await (async () => {
              try {
                return await loadExplicitEvidence(artifact);
              } catch {
                azureLogAccess = "unavailable";
                return {
                  sourceAvailability: {
                    telemetry: "unavailable",
                    publishResolution: "unavailable",
                  },
                  telemetry: null,
                  publishResolution: null,
                } as ExplicitLaneEvidence;
              }
            })(),
          });

      artifactReports.push({
        ...artifact,
        verdict: classification.verdict,
        rationale: classification.rationale,
        sourceAvailability: classification.sourceAvailability,
        signals: classification.signals,
      });
    }

    return {
      command: "verify:m044:s01",
      generated_at,
      repo: params.repo,
      limit: params.limit,
      success: true,
      status_code: "m044_s01_ok",
      preflight: {
        githubAccess,
        databaseAccess,
        azureLogAccess,
        explicitPublishResolution: "unavailable",
      },
      selection: {
        scannedPullRequests: pullRequests.length,
        collectedArtifacts: collectedArtifacts.length,
        ...sample.selection,
      },
      summary: buildAuditSummary(artifactReports),
      artifacts: artifactReports,
    };
  } finally {
    if (db) {
      await db.close();
    }
  }
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluate?: (params: { repo: string; limit: number }) => Promise<M044S01Report>;
  },
): Promise<number> {
  const options = parseVerifyM044S01Args(args);
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const report = await (deps?.evaluate ?? ((params) => evaluateM044S01(params)))({
      repo: options.repo,
      limit: options.limit,
    });

    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM044S01Report(report));
    return report.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`verify:m044:s01 failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
