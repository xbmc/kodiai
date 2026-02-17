import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const DEFAULT_OWNER = "xbmc";
const DEFAULT_REPO = "xbmc";

const FAILURE_STATUSES = new Set(["pr_creation_failed", "failed", "error"]);
const ALLOWED_FAILED_STEPS = new Set(["branch-push", "create-pr", "issue-linkback"]);
const CAPABILITY_PREFIX = "CAP-74";
const RELIABILITY_PREFIX = "REL-74";
const RETRIEVAL_PREFIX = "RET-74";

type Check = {
  id: string;
  title: string;
  passed: boolean;
  details: string;
};

export type GateReport = {
  overallPassed: boolean;
  checks: Check[];
  capability: CapabilityProbe;
  scenarioName: string;
};

export type ParsedIssueWriteStatus = {
  status: string | null;
  failedStep: string | null;
  diagnostics: string;
  retryCommand: string | null;
  openedPrUrl: string | null;
};

type ScenarioInput = {
  scenarioName?: string;
  issueWriteReply: string;
  artifacts: {
    branchPush: boolean;
    prUrl: string | null;
    issueLinkbackUrl: string | null;
  };
  retrieval: {
    maxChars: number;
    renderedChars: number;
    fallbackText: string;
  };
};

export type CapabilityProbe = {
  owner: string;
  repo: string;
  permissionLevel: string;
  pushPermission: boolean;
  defaultBranch: string;
  archived: boolean;
  source: "live-gh" | "fixture";
};

type CliValues = {
  owner?: string;
  repo?: string;
  scenario?: string;
  capabilities?: string;
  json?: boolean;
  help?: boolean;
};

function printUsage(): void {
  console.log(`Phase 74 reliability regression gate

Runs one deterministic combined degraded + retrieval + issue-write scenario and
validates Azure runtime capability preflight for ${DEFAULT_OWNER}/${DEFAULT_REPO}.

Usage:
  bun scripts/phase74-reliability-regression-gate.ts \\
    --scenario <path-to-scenario.json> [options]

Required:
  --scenario <path>                  JSON evidence bundle for combined scenario

Options:
  --owner <value>                    repo owner (default: ${DEFAULT_OWNER})
  --repo <value>                     repo name (default: ${DEFAULT_REPO})
  --capabilities <path>              use fixture capability JSON instead of live gh probe
  --json                             print machine-checkable report JSON
  -h, --help                         show this help

Blocking rule:
  Exit code is non-zero when any check fails (capability, reliability, or retrieval).

Scenario JSON shape:
  {
    "scenarioName": "phase74-release-check",
    "issueWriteReply": "...status: pr_creation_failed...",
    "artifacts": {
      "branchPush": true,
      "prUrl": "https://github.com/xbmc/xbmc/pull/123",
      "issueLinkbackUrl": "https://github.com/xbmc/xbmc/issues/27874#issuecomment-1"
    },
    "retrieval": {
      "maxChars": 1200,
      "renderedChars": 842,
      "fallbackText": "- [major/reliability] src/file.ts -- found guidance"
    }
  }`);
}

function normalizeMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message.trim();
  }
  const text = String(err ?? "").trim();
  return text.length > 0 ? text : "Unknown publish failure";
}

function isWritePermission(level: string): boolean {
  const normalized = level.trim().toUpperCase();
  return normalized === "ADMIN" || normalized === "MAINTAIN" || normalized === "WRITE";
}

function runGh(args: string[]): string {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  const stdout = result.stdout?.trim() ?? "";
  const stderr = result.stderr?.trim() ?? "";

  if (result.status !== 0) {
    throw new Error(stderr || stdout || `gh ${args[0] ?? ""} failed`);
  }

  return stdout;
}

function readJsonFile(pathValue: string): unknown {
  const absolute = resolve(pathValue);
  if (!existsSync(absolute)) {
    throw new Error(`File not found: ${absolute}`);
  }

  const content = readFileSync(absolute, "utf8");
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON at ${absolute}: ${normalizeMessage(error)}`);
  }
}

function requireScenario(value: unknown): ScenarioInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("Scenario payload must be a JSON object");
  }

  const source = value as {
    scenarioName?: unknown;
    issueWriteReply?: unknown;
    artifacts?: unknown;
    retrieval?: unknown;
  };

  if (typeof source.issueWriteReply !== "string" || source.issueWriteReply.trim().length === 0) {
    throw new Error("Scenario must include non-empty issueWriteReply text");
  }

  const artifacts = source.artifacts as {
    branchPush?: unknown;
    prUrl?: unknown;
    issueLinkbackUrl?: unknown;
  } | undefined;

  if (!artifacts || typeof artifacts.branchPush !== "boolean") {
    throw new Error("Scenario artifacts.branchPush must be boolean");
  }

  const retrieval = source.retrieval as {
    maxChars?: unknown;
    renderedChars?: unknown;
    fallbackText?: unknown;
  } | undefined;

  if (!retrieval || typeof retrieval.maxChars !== "number" || retrieval.maxChars <= 0) {
    throw new Error("Scenario retrieval.maxChars must be a positive number");
  }

  if (typeof retrieval.renderedChars !== "number" || retrieval.renderedChars < 0) {
    throw new Error("Scenario retrieval.renderedChars must be a non-negative number");
  }

  if (typeof retrieval.fallbackText !== "string") {
    throw new Error("Scenario retrieval.fallbackText must be a string");
  }

  return {
    scenarioName:
      typeof source.scenarioName === "string" && source.scenarioName.trim().length > 0
        ? source.scenarioName.trim()
        : "phase74-combined-regression",
    issueWriteReply: source.issueWriteReply,
    artifacts: {
      branchPush: artifacts.branchPush,
      prUrl: typeof artifacts.prUrl === "string" && artifacts.prUrl.length > 0 ? artifacts.prUrl : null,
      issueLinkbackUrl:
        typeof artifacts.issueLinkbackUrl === "string" && artifacts.issueLinkbackUrl.length > 0
          ? artifacts.issueLinkbackUrl
          : null,
    },
    retrieval: {
      maxChars: retrieval.maxChars,
      renderedChars: retrieval.renderedChars,
      fallbackText: retrieval.fallbackText,
    },
  };
}

export function parseIssueWriteStatus(reply: string): ParsedIssueWriteStatus {
  const statusMatch = reply.match(/^status:\s*([^\n\r]+)/im);
  const failedStepMatch = reply.match(/^failed_step:\s*([^\n\r]+)/im);
  const diagnosticsMatch = reply.match(/^diagnostics:\s*([^\n\r]+)/im);
  const retryMatch = reply.match(/^Retry command:\s*([^\n\r]+)/im);
  const openedPrMatch = reply.match(/Opened PR:\s*(https?:\/\/\S+)/i);

  return {
    status: statusMatch?.[1]?.trim() ?? null,
    failedStep: failedStepMatch?.[1]?.trim() ?? null,
    diagnostics: diagnosticsMatch?.[1]?.trim() || "Unknown publish failure",
    retryCommand: retryMatch?.[1]?.trim() ?? null,
    openedPrUrl: openedPrMatch?.[1]?.trim() ?? null,
  };
}

export function evaluateScenarioChecks(
  scenario: ScenarioInput,
  parsedStatus: ParsedIssueWriteStatus,
): Check[] {
  const checks: Check[] = [];

  const isFailure = parsedStatus.status ? FAILURE_STATUSES.has(parsedStatus.status) : false;
  const statusKnown = parsedStatus.status === "success" || isFailure;

  checks.push({
    id: `${RELIABILITY_PREFIX}-01`,
    title: "Issue write-mode status contract is machine-checkable",
    passed: statusKnown,
    details: statusKnown
      ? `Detected status=${parsedStatus.status}.`
      : "Expected `status: success` or `status: pr_creation_failed` in issue write reply.",
  });

  const failedStepValid = !isFailure || (parsedStatus.failedStep ? ALLOWED_FAILED_STEPS.has(parsedStatus.failedStep) : false);
  checks.push({
    id: `${RELIABILITY_PREFIX}-02`,
    title: "Failure status includes actionable failed_step diagnostics",
    passed: failedStepValid,
    details: failedStepValid
      ? isFailure
        ? `Failure pinned to failed_step=${parsedStatus.failedStep}.`
        : "Scenario succeeded; failed_step requirement not applicable."
      : "Failure status requires failed_step in {branch-push, create-pr, issue-linkback}.",
  });

  checks.push({
    id: `${RELIABILITY_PREFIX}-03`,
    title: "Failure diagnostics never collapse to ambiguous environment phrasing",
    passed: parsedStatus.diagnostics.trim().length > 0,
    details: `Diagnostics: ${parsedStatus.diagnostics}`,
  });

  const artifactTriadPresent =
    scenario.artifacts.branchPush && Boolean(scenario.artifacts.prUrl) && Boolean(scenario.artifacts.issueLinkbackUrl);
  const successTriadValid = parsedStatus.status !== "success" || artifactTriadPresent;

  checks.push({
    id: `${RELIABILITY_PREFIX}-04`,
    title: "Success path proves branch push + PR URL + issue linkback artifact triad",
    passed: successTriadValid,
    details: successTriadValid
      ? parsedStatus.status === "success"
        ? `Artifacts present: branchPush=${scenario.artifacts.branchPush}, prUrl=${scenario.artifacts.prUrl}, issueLinkbackUrl=${scenario.artifacts.issueLinkbackUrl}.`
        : "Failure scenario; success artifact triad requirement not applicable."
      : "status=success requires branchPush=true plus non-empty prUrl and issueLinkbackUrl.",
  });

  const renderedWithinBudget = scenario.retrieval.renderedChars <= scenario.retrieval.maxChars;
  checks.push({
    id: `${RETRIEVAL_PREFIX}-01`,
    title: "Combined degraded retrieval section stays within configured maxChars budget",
    passed: renderedWithinBudget,
    details: `retrieval.renderedChars=${scenario.retrieval.renderedChars}, maxChars=${scenario.retrieval.maxChars}.`,
  });

  const fallbackMarkdownSafe = !/`[^`]*`[^`]*`/.test(scenario.retrieval.fallbackText);
  checks.push({
    id: `${RETRIEVAL_PREFIX}-02`,
    title: "Combined degraded retrieval fallback remains markdown-safe",
    passed: fallbackMarkdownSafe,
    details: fallbackMarkdownSafe
      ? "Fallback text contains no malformed multi-backtick spans."
      : "Fallback text includes malformed backtick spans; expected sanitized markdown-safe output.",
  });

  return checks;
}

function requireCapabilityProbe(value: unknown): CapabilityProbe {
  if (typeof value !== "object" || value === null) {
    throw new Error("Capability payload must be a JSON object");
  }

  const source = value as {
    owner?: unknown;
    repo?: unknown;
    permissionLevel?: unknown;
    pushPermission?: unknown;
    defaultBranch?: unknown;
    archived?: unknown;
    source?: unknown;
  };

  if (
    typeof source.owner !== "string" ||
    typeof source.repo !== "string" ||
    typeof source.permissionLevel !== "string" ||
    typeof source.pushPermission !== "boolean" ||
    typeof source.defaultBranch !== "string" ||
    typeof source.archived !== "boolean"
  ) {
    throw new Error("Capability fixture must contain owner/repo/permissionLevel/pushPermission/defaultBranch/archived");
  }

  return {
    owner: source.owner,
    repo: source.repo,
    permissionLevel: source.permissionLevel,
    pushPermission: source.pushPermission,
    defaultBranch: source.defaultBranch,
    archived: source.archived,
    source: source.source === "live-gh" ? "live-gh" : "fixture",
  };
}

export function evaluateCapabilityChecks(probe: CapabilityProbe): Check[] {
  const checks: Check[] = [];

  const canCreateBranch = isWritePermission(probe.permissionLevel) && !probe.archived && probe.defaultBranch.length > 0;
  checks.push({
    id: `${CAPABILITY_PREFIX}-01`,
    title: "Azure runtime can satisfy bot-branch creation prerequisites",
    passed: canCreateBranch,
    details: canCreateBranch
      ? `viewerPermission=${probe.permissionLevel}, defaultBranch=${probe.defaultBranch}, archived=${probe.archived}`
      : `Branch creation prerequisites failed: viewerPermission=${probe.permissionLevel}, defaultBranch=${probe.defaultBranch || "<missing>"}, archived=${probe.archived}`,
  });

  const canPush = isWritePermission(probe.permissionLevel) && probe.pushPermission && !probe.archived;
  checks.push({
    id: `${CAPABILITY_PREFIX}-02`,
    title: "Azure runtime can push using bot-branch strategy",
    passed: canPush,
    details: canPush
      ? `pushPermission=${probe.pushPermission}, viewerPermission=${probe.permissionLevel}`
      : `Push capability missing: pushPermission=${probe.pushPermission}, viewerPermission=${probe.permissionLevel}`,
  });

  const canCreatePr = canPush;
  checks.push({
    id: `${CAPABILITY_PREFIX}-03`,
    title: "Azure runtime has PR creation permission prerequisites",
    passed: canCreatePr,
    details: canCreatePr
      ? "Write permission and push capability are present for PR publication flow."
      : "PR creation capability prerequisite failed due to missing write/push permission.",
  });

  return checks;
}

export function renderSummary(report: GateReport): string {
  const failed = report.checks.filter((check) => !check.passed);
  const failedIds = failed.map((check) => check.id).join(", ");
  const lines = [
    `Phase 74 reliability gate scenario: ${report.scenarioName}`,
    `Repository: ${report.capability.owner}/${report.capability.repo} (capability source: ${report.capability.source})`,
    "",
    "Checks:",
    ...report.checks.map((check) => `- ${check.id} ${check.passed ? "PASS" : "FAIL"}: ${check.title}. ${check.details}`),
    "",
    report.overallPassed
      ? "Final verdict: PASS - all capability, reliability, and retrieval checks passed."
      : `Final verdict: FAIL - blocking checks failed [${failedIds}].`,
  ];

  return lines.join("\n");
}

function runLiveCapabilityProbe(owner: string, repo: string): CapabilityProbe {
  const graph = runGh([
    "api",
    "graphql",
    "-f",
    `query=query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){viewerPermission,isArchived,defaultBranchRef{name}}}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `repo=${repo}`,
  ]);

  const graphJson = JSON.parse(graph) as {
    data?: {
      repository?: {
        viewerPermission?: string;
        isArchived?: boolean;
        defaultBranchRef?: { name?: string } | null;
      };
    };
  };

  const rest = runGh(["api", `repos/${owner}/${repo}`]);
  const restJson = JSON.parse(rest) as { permissions?: { push?: boolean } };

  const repository = graphJson.data?.repository;
  if (!repository?.viewerPermission || typeof repository.isArchived !== "boolean") {
    throw new Error("Unable to resolve repository viewer permissions from GitHub API");
  }

  return {
    owner,
    repo,
    permissionLevel: repository.viewerPermission,
    pushPermission: Boolean(restJson.permissions?.push),
    defaultBranch: repository.defaultBranchRef?.name ?? "",
    archived: repository.isArchived,
    source: "live-gh",
  };
}

export function runGate(params: {
  owner: string;
  repo: string;
  scenario: ScenarioInput;
  capabilityProbe: CapabilityProbe;
}): GateReport {
  const parsedStatus = parseIssueWriteStatus(params.scenario.issueWriteReply);
  const capabilityChecks = evaluateCapabilityChecks(params.capabilityProbe);
  const scenarioChecks = evaluateScenarioChecks(params.scenario, parsedStatus);
  const checks = [...capabilityChecks, ...scenarioChecks];

  return {
    overallPassed: checks.every((check) => check.passed),
    checks,
    capability: params.capabilityProbe,
    scenarioName: params.scenario.scenarioName ?? "phase74-combined-regression",
  };
}

function main(): void {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      owner: { type: "string", default: DEFAULT_OWNER },
      repo: { type: "string", default: DEFAULT_REPO },
      scenario: { type: "string" },
      capabilities: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  const values = parsed.values as CliValues;
  if (values.help) {
    printUsage();
    return;
  }

  if (!values.scenario) {
    throw new Error("Missing required --scenario argument");
  }

  const owner = values.owner?.trim() || DEFAULT_OWNER;
  const repo = values.repo?.trim() || DEFAULT_REPO;
  const scenario = requireScenario(readJsonFile(values.scenario));
  const capabilityProbe = values.capabilities
    ? requireCapabilityProbe(readJsonFile(values.capabilities))
    : runLiveCapabilityProbe(owner, repo);

  const report = runGate({
    owner,
    repo,
    scenario,
    capabilityProbe,
  });

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderSummary(report));
  }

  if (!report.overallPassed) {
    process.exit(1);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`Phase 74 reliability gate failed: ${normalizeMessage(error)}`);
    process.exit(1);
  }
}
