import { createGeneratedRuleSweep, type GeneratedRuleSweepResult } from "../src/knowledge/generated-rule-sweep.ts";
import type { GeneratedRuleStore } from "../src/knowledge/generated-rule-store.ts";
import type { GeneratedRuleProposalCandidate } from "../src/knowledge/generated-rule-proposals.ts";
import type { MemoryOutcome } from "../src/knowledge/types.ts";
import type { Logger } from "pino";

export const M036_S01_CHECK_IDS = [
  "M036-S01-PROPOSAL-CREATED",
  "M036-S01-FAIL-OPEN",
] as const;

export type M036S01CheckId = (typeof M036_S01_CHECK_IDS)[number];

export type Check = {
  id: M036S01CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  check_ids: readonly string[];
  overallPassed: boolean;
  checks: Check[];
};

type ProposalSweepFixtureResult = {
  result: GeneratedRuleSweepResult;
  savedRules: Array<{ repo: string; title: string; ruleText: string }>;
};

type FailOpenFixtureResult = {
  result: GeneratedRuleSweepResult;
  warnCount: number;
};

function createMockLogger() {
  const logger = {
    info: (..._args: unknown[]) => {},
    warn: (..._args: unknown[]) => {},
    error: (..._args: unknown[]) => {},
    debug: (..._args: unknown[]) => {},
    child: () => logger,
  };
  return logger as unknown as Logger;
}

function createSpyLogger(): Logger & { _warnCalls: unknown[][] } {
  const warnCalls: unknown[][] = [];
  const logger = {
    _warnCalls: warnCalls,
    info: (..._args: unknown[]) => {},
    warn: (...args: unknown[]) => { warnCalls.push(args); },
    error: (..._args: unknown[]) => {},
    debug: (..._args: unknown[]) => {},
    child: () => logger,
  };
  return logger as unknown as Logger & { _warnCalls: unknown[][] };
}

function normalizedEmbedding(seed: number, dim = 8): Float32Array {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    arr[i] = next() * 2 - 1;
  }

  let norm = 0;
  for (let i = 0; i < dim; i++) norm += arr[i]! * arr[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) arr[i] = arr[i]! / norm;
  return arr;
}

function slightlyAdjustedEmbedding(base: Float32Array, delta: number): Float32Array {
  const arr = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) {
    arr[i] = base[i]! + delta;
  }

  let norm = 0;
  for (let i = 0; i < arr.length; i++) norm += arr[i]! * arr[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < arr.length; i++) arr[i] = arr[i]! / norm;
  return arr;
}

function toVectorString(arr: Float32Array): string {
  return `[${Array.from(arr).join(",")}]`;
}

function makeMemoryRow(overrides: {
  id: number;
  embedding: Float32Array;
  findingText: string;
  outcome?: MemoryOutcome;
  filePath?: string;
}) {
  return {
    id: overrides.id,
    outcome: overrides.outcome ?? "accepted",
    finding_text: overrides.findingText,
    file_path: overrides.filePath ?? `src/file-${overrides.id}.ts`,
    embedding: toVectorString(overrides.embedding),
    created_at: `2026-03-${String((overrides.id % 20) + 1).padStart(2, "0")}T00:00:00Z`,
  };
}

function createCapturingStore(savedRules: Array<{ repo: string; title: string; ruleText: string }>): GeneratedRuleStore {
  return {
    savePendingRule: async (proposal) => {
      savedRules.push({ repo: proposal.repo, title: proposal.title, ruleText: proposal.ruleText });
      return {
        id: savedRules.length,
        repo: proposal.repo,
        title: proposal.title,
        ruleText: proposal.ruleText,
        status: "pending",
        origin: "generated",
        signalScore: proposal.signalScore,
        memberCount: proposal.memberCount,
        clusterCentroid: proposal.clusterCentroid ?? new Float32Array(0),
        createdAt: "2026-04-04T00:00:00Z",
        updatedAt: "2026-04-04T00:00:00Z",
        activatedAt: null,
        retiredAt: null,
      };
    },
    getRule: async () => null,
    listRulesForRepo: async () => [],
    getActiveRulesForRepo: async () => [],
    activateRule: async () => null,
    retireRule: async () => null,
    getLifecycleCounts: async () => ({ pending: 0, active: 0, retired: 0, total: 0 }),
  };
}

async function runProposalFixture(): Promise<ProposalSweepFixtureResult> {
  const logger = createMockLogger();
  const savedRules: Array<{ repo: string; title: string; ruleText: string }> = [];
  const base = normalizedEmbedding(10);
  const noisy = normalizedEmbedding(99);

  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("GROUP BY repo") && query.includes("memory_count")) {
      return [{ repo: "xbmc/xbmc", memory_count: 6 }];
    }

    if (query.includes("SELECT id, outcome, finding_text, file_path, embedding, created_at")) {
      if (values[0] !== "xbmc/xbmc") {
        throw new Error(`unexpected repo ${String(values[0])}`);
      }
      return [
        makeMemoryRow({ id: 1, embedding: base, findingText: "Add an explicit null guard before dereferencing optional pointers when the API can return nullptr." }),
        makeMemoryRow({ id: 2, embedding: slightlyAdjustedEmbedding(base, 0.001), findingText: "Check the pointer for null before calling methods on the optional response object." }),
        makeMemoryRow({ id: 3, embedding: slightlyAdjustedEmbedding(base, -0.001), findingText: "Return early when the optional settings object is null instead of dereferencing it." }),
        makeMemoryRow({ id: 4, embedding: slightlyAdjustedEmbedding(base, 0.002), findingText: "Guard against null before reading members from the optional config object." }),
        makeMemoryRow({ id: 5, embedding: slightlyAdjustedEmbedding(base, -0.002), findingText: "Avoid null dereferences by checking the optional context pointer before using it.", outcome: "thumbs_up" }),
        makeMemoryRow({ id: 9, embedding: noisy, findingText: "Unrelated formatting issue in a different part of the repo." }),
      ];
    }

    throw new Error(`Unexpected SQL query: ${query}`);
  }) as any;

  const sweep = createGeneratedRuleSweep({
    sql,
    logger,
    store: createCapturingStore(savedRules),
  });

  const result = await sweep.run();
  return { result, savedRules };
}

async function runFailOpenFixture(): Promise<FailOpenFixtureResult> {
  const logger = createSpyLogger();
  let saveCalls = 0;

  const store: GeneratedRuleStore = {
    savePendingRule: async (proposal) => {
      saveCalls++;
      if (proposal.repo === "broken/repo") {
        throw new Error("simulated persistence failure");
      }
      return {
        id: saveCalls,
        repo: proposal.repo,
        title: proposal.title,
        ruleText: proposal.ruleText,
        status: "pending",
        origin: "generated",
        signalScore: proposal.signalScore,
        memberCount: proposal.memberCount,
        clusterCentroid: proposal.clusterCentroid ?? new Float32Array(0),
        createdAt: "2026-04-04T00:00:00Z",
        updatedAt: "2026-04-04T00:00:00Z",
        activatedAt: null,
        retiredAt: null,
      };
    },
    getRule: async () => null,
    listRulesForRepo: async () => [],
    getActiveRulesForRepo: async () => [],
    activateRule: async () => null,
    retireRule: async () => null,
    getLifecycleCounts: async () => ({ pending: 0, active: 0, retired: 0, total: 0 }),
  };

  const candidate = (repo: string, id: number): GeneratedRuleProposalCandidate => ({
    repo,
    title: `Rule ${id}`,
    ruleText: `Rule text ${id}.`,
    signalScore: 0.5,
    memberCount: 5,
    clusterCentroid: new Float32Array([1, 0]),
    clusterSize: 5,
    positiveCount: 5,
    negativeCount: 0,
    acceptedCount: 4,
    thumbsUpCount: 1,
    positiveRatio: 1,
    representativeMemoryId: id,
    representativeFindingText: `Rule text ${id}.`,
  });

  const sweep = createGeneratedRuleSweep({
    sql: (async () => []) as any,
    logger,
    store,
    _generateFn: async (repo) => {
      if (repo === "crashing/repo") {
        throw new Error("generation failed");
      }
      return [candidate(repo, repo === "broken/repo" ? 1 : 2)];
    },
  });

  const result = await sweep.run({ repos: ["broken/repo", "crashing/repo", "healthy/repo"] });
  return { result, warnCount: logger._warnCalls.length };
}

export async function runProposalCreatedFromPositiveCluster(
  _runFn?: () => Promise<ProposalSweepFixtureResult>,
): Promise<Check> {
  const { result, savedRules } = await (_runFn ?? runProposalFixture)();
  const representativeMemoryId = result.repoResults[0]?.representativeMemoryIds[0] ?? null;
  const firstRule = savedRules[0];

  const hasSavedRule = savedRules.length > 0;
  const looksRepresentative = representativeMemoryId === 1
    && firstRule?.ruleText.toLowerCase().includes("null")
    && firstRule?.title.toLowerCase().includes("null");

  if (hasSavedRule && looksRepresentative && result.proposalsPersisted >= 1) {
    return {
      id: "M036-S01-PROPOSAL-CREATED",
      passed: true,
      skipped: false,
      status_code: "proposal_created_from_positive_cluster",
      detail: `repo=${firstRule!.repo} title="${firstRule!.title}" representativeMemoryId=${representativeMemoryId}`,
    };
  }

  const problems: string[] = [];
  if (!hasSavedRule) problems.push("no proposals were persisted");
  if (representativeMemoryId !== 1) problems.push(`representativeMemoryId=${String(representativeMemoryId)} expected 1`);
  if (!firstRule?.ruleText.toLowerCase().includes("null")) problems.push("rule text did not retain positive-cluster signal");

  return {
    id: "M036-S01-PROPOSAL-CREATED",
    passed: false,
    skipped: false,
    status_code: "proposal_not_created",
    detail: problems.join("; "),
  };
}

export async function runFailOpenCheck(
  _runFn?: () => Promise<FailOpenFixtureResult>,
): Promise<Check> {
  const { result, warnCount } = await (_runFn ?? runFailOpenFixture)();

  const keptGoing = result.repoCount === 3
    && result.reposProcessed === 2
    && result.reposFailed === 1
    && result.proposalsPersisted === 1
    && result.persistFailures === 1
    && warnCount >= 2;

  if (keptGoing) {
    return {
      id: "M036-S01-FAIL-OPEN",
      passed: true,
      skipped: false,
      status_code: "sweep_fail_open",
      detail: `reposProcessed=${result.reposProcessed} reposFailed=${result.reposFailed} proposalsPersisted=${result.proposalsPersisted} persistFailures=${result.persistFailures} warnCount=${warnCount}`,
    };
  }

  return {
    id: "M036-S01-FAIL-OPEN",
    passed: false,
    skipped: false,
    status_code: "sweep_not_fail_open",
    detail: `reposProcessed=${result.reposProcessed} reposFailed=${result.reposFailed} proposalsPersisted=${result.proposalsPersisted} persistFailures=${result.persistFailures} warnCount=${warnCount}`,
  };
}

export async function evaluateM036S01(opts?: {
  _proposalRunFn?: () => Promise<ProposalSweepFixtureResult>;
  _failOpenRunFn?: () => Promise<FailOpenFixtureResult>;
}): Promise<EvaluationReport> {
  const [proposalCreated, failOpen] = await Promise.all([
    runProposalCreatedFromPositiveCluster(opts?._proposalRunFn),
    runFailOpenCheck(opts?._failOpenRunFn),
  ]);

  const checks: Check[] = [proposalCreated, failOpen];
  const overallPassed = checks.filter((check) => !check.skipped).every((check) => check.passed);

  return {
    check_ids: M036_S01_CHECK_IDS,
    overallPassed,
    checks,
  };
}

function renderReport(report: EvaluationReport): string {
  const lines = [
    "M036 S01 proof harness",
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    const detail = check.detail ? ` ${check.detail}` : "";
    lines.push(`- ${check.id} ${verdict} status_code=${check.status_code}${detail}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function buildM036S01ProofHarness(opts?: {
  _proposalRunFn?: () => Promise<ProposalSweepFixtureResult>;
  _failOpenRunFn?: () => Promise<FailOpenFixtureResult>;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const useJson = opts?.json ?? false;

  const report = await evaluateM036S01({
    _proposalRunFn: opts?._proposalRunFn,
    _failOpenRunFn: opts?._failOpenRunFn,
  });

  if (useJson) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderReport(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m036:s01 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM036S01ProofHarness({ json: useJson });
  process.exit(exitCode);
}
