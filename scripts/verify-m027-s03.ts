import type { EmbeddingAuditCorpusReport, EmbeddingAuditEnvelope } from "../src/knowledge/embedding-audit.ts";
import { NON_WIKI_REPAIR_CORPORA, NON_WIKI_TARGET_EMBEDDING_MODEL, type EmbeddingRepairCorpus } from "../src/knowledge/embedding-repair.ts";
import { runEmbeddingAuditCli } from "./embedding-audit.ts";
import { runEmbeddingRepairCli, type RepairCliReport } from "./embedding-repair.ts";

export const M027_S03_CHECK_IDS = ["M027-S03-REPAIR", "M027-S03-STATUS", "M027-S03-NOOP", "M027-S03-AUDIT"] as const;

export type M027S03CheckId = typeof M027_S03_CHECK_IDS[number];

export type M027S03Check = {
  id: M027S03CheckId;
  passed: boolean;
  status_code: string;
  detail: string;
};

export type M027S03EvaluationReport = {
  check_ids: M027S03CheckId[];
  overallPassed: boolean;
  status_code: "m027_s03_ok" | "m027_s03_resume_required" | "m027_s03_failed";
  checks: M027S03Check[];
  repair_evidence: RepairCliReport;
  status_evidence: RepairCliReport;
  noop_probe_evidence: RepairCliReport;
  audit_evidence: EmbeddingAuditEnvelope;
};

export type M027S03ProofHarnessReport = M027S03EvaluationReport & {
  command: "verify:m027:s03";
  generated_at: string;
  corpus: EmbeddingRepairCorpus;
  noop_corpus: EmbeddingRepairCorpus;
  success: boolean;
};

const DEFAULT_NOOP_CORPORA: EmbeddingRepairCorpus[] = [
  "issues",
  "issue_comments",
  "learning_memories",
  "code_snippets",
  "review_comments",
];

function isEmbeddingRepairCorpus(value: string | undefined): value is EmbeddingRepairCorpus {
  return value != null && NON_WIKI_REPAIR_CORPORA.includes(value as EmbeddingRepairCorpus);
}

export function parseVerifyM027S03Args(args: string[]): {
  help?: boolean;
  json?: boolean;
  corpus?: EmbeddingRepairCorpus;
  noopCorpus?: EmbeddingRepairCorpus;
} {
  let corpus: EmbeddingRepairCorpus | undefined;
  let noopCorpus: EmbeddingRepairCorpus | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--corpus") {
      const value = args[index + 1];
      if (isEmbeddingRepairCorpus(value)) {
        corpus = value;
      }
      index += 1;
      continue;
    }

    if (arg === "--noop-corpus") {
      const value = args[index + 1];
      if (isEmbeddingRepairCorpus(value)) {
        noopCorpus = value;
      }
      index += 1;
    }
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    corpus,
    noopCorpus,
  };
}

function formatBatch(batchIndex: number | null, batchesTotal: number | null): string {
  if (batchIndex === null || batchesTotal === null || batchesTotal <= 0) {
    return "none";
  }

  return `${batchIndex + 1}/${batchesTotal}`;
}

function summarizeFailureClasses(byClass: Record<string, number>): string {
  const values = Object.entries(byClass)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([failureClass, count]) => `${failureClass}=${count}`);

  return values.length > 0 ? values.join(",") : "none";
}

function describeRepairEvidence(report: RepairCliReport): string {
  return [
    `status_code=${report.status_code}`,
    `run_status=${report.run.status}`,
    `corpus=${report.corpus}`,
    `batch=${formatBatch(report.run.batch_index, report.run.batches_total)}`,
    `last_row_id=${report.run.last_row_id ?? "none"}`,
    `processed=${report.run.processed}`,
    `repaired=${report.run.repaired}`,
    `skipped=${report.run.skipped}`,
    `failed=${report.run.failed}`,
    `last_failure_class=${report.run.failure_summary.last_failure_class ?? "none"}`,
  ].join(" ");
}

function describeStatusEvidence(report: RepairCliReport): string {
  return [
    `status_code=${report.status_code}`,
    `run_status=${report.run.status}`,
    `corpus=${report.corpus}`,
    `cursor_last_row_id=${report.run.last_row_id ?? "none"}`,
    `batch=${formatBatch(report.run.batch_index, report.run.batches_total)}`,
    `processed=${report.run.processed}`,
    `repaired=${report.run.repaired}`,
    `failed=${report.run.failed}`,
    `failure_classes=${summarizeFailureClasses(report.run.failure_summary.by_class)}`,
    `last_failure_class=${report.run.failure_summary.last_failure_class ?? "none"}`,
  ].join(" ");
}

function describeNoopProbeEvidence(report: RepairCliReport): string {
  return [
    `status_code=${report.status_code}`,
    `run_status=${report.run.status}`,
    `corpus=${report.corpus}`,
    `dry_run=${report.dry_run}`,
    `processed=${report.run.processed}`,
    `repaired=${report.run.repaired}`,
    `skipped=${report.run.skipped}`,
    `failed=${report.run.failed}`,
    `last_failure_class=${report.run.failure_summary.last_failure_class ?? "none"}`,
  ].join(" ");
}

function findAuditCorpus(report: EmbeddingAuditEnvelope, corpus: EmbeddingRepairCorpus): EmbeddingAuditCorpusReport | undefined {
  return report.corpora.find((entry) => entry.corpus === corpus);
}

function didRepairPass(report: RepairCliReport): boolean {
  return report.success
    && (report.status_code === "repair_completed" || report.status_code === "repair_not_needed")
    && (report.run.status === "completed" || report.run.status === "not_needed");
}

function didStatusPass(report: RepairCliReport): boolean {
  return report.success
    && report.status_code === "repair_completed"
    && (report.run.status === "completed" || report.run.status === "not_needed")
    && report.run.failed === 0
    && report.run.failure_summary.last_failure_class == null;
}

function didNoopProbePass(report: RepairCliReport): boolean {
  return report.success
    && report.dry_run
    && report.status_code === "repair_not_needed"
    && report.run.status === "not_needed"
    && report.run.processed === 0
    && report.run.repaired === 0
    && report.run.skipped === 0
    && report.run.failed === 0;
}

function didAuditCorpusPass(corpus: EmbeddingAuditCorpusReport | undefined): boolean {
  return corpus != null
    && corpus.status === "pass"
    && corpus.expected_model === NON_WIKI_TARGET_EMBEDDING_MODEL
    && corpus.model_mismatch === 0
    && corpus.missing_or_null === 0;
}

function describeAuditEvidence(report: EmbeddingAuditEnvelope, corpora: EmbeddingRepairCorpus[]): string {
  const details = corpora.map((corpus) => {
    const entry = findAuditCorpus(report, corpus);
    if (!entry) {
      return `${corpus}=missing`;
    }

    return `${corpus}:status=${entry.status},missing_or_null=${entry.missing_or_null},model_mismatch=${entry.model_mismatch},expected_model=${entry.expected_model}`;
  });

  return [
    `status_code=${report.status_code}`,
    `overall_status=${report.overall_status}`,
    ...details,
  ].join(" ");
}

function deriveOverallStatusCode(checks: M027S03Check[]): M027S03EvaluationReport["status_code"] {
  const statusCheck = checks.find((check) => check.id === "M027-S03-STATUS");
  if (statusCheck && !statusCheck.passed && statusCheck.status_code === "repair_resume_available") {
    return "m027_s03_resume_required";
  }

  return checks.every((check) => check.passed) ? "m027_s03_ok" : "m027_s03_failed";
}

export async function evaluateM027S03Checks(deps: {
  runRepair: () => Promise<RepairCliReport>;
  getRepairStatus: () => Promise<RepairCliReport>;
  runNoopProbe: () => Promise<RepairCliReport>;
  runAudit: () => Promise<EmbeddingAuditEnvelope>;
}): Promise<M027S03EvaluationReport> {
  const repair = await deps.runRepair();
  const status = await deps.getRepairStatus();
  const noopProbe = await deps.runNoopProbe();
  const audit = await deps.runAudit();
  const auditedCorpora: EmbeddingRepairCorpus[] = [repair.corpus, noopProbe.corpus];

  const checks: M027S03Check[] = [
    {
      id: "M027-S03-REPAIR",
      passed: didRepairPass(repair),
      status_code: repair.status_code,
      detail: describeRepairEvidence(repair),
    },
    {
      id: "M027-S03-STATUS",
      passed: didStatusPass(status),
      status_code: status.status_code,
      detail: describeStatusEvidence(status),
    },
    {
      id: "M027-S03-NOOP",
      passed: didNoopProbePass(noopProbe),
      status_code: noopProbe.status_code,
      detail: describeNoopProbeEvidence(noopProbe),
    },
    {
      id: "M027-S03-AUDIT",
      passed: auditedCorpora.every((corpus) => didAuditCorpusPass(findAuditCorpus(audit, corpus))),
      status_code: audit.status_code,
      detail: describeAuditEvidence(audit, auditedCorpora),
    },
  ];

  return {
    check_ids: [...M027_S03_CHECK_IDS],
    overallPassed: checks.every((check) => check.passed),
    status_code: deriveOverallStatusCode(checks),
    checks,
    repair_evidence: repair,
    status_evidence: status,
    noop_probe_evidence: noopProbe,
    audit_evidence: audit,
  };
}

export function buildM027S03ProofHarnessReport(input: {
  corpus: EmbeddingRepairCorpus;
  noopCorpus: EmbeddingRepairCorpus;
  evaluation: M027S03EvaluationReport;
}): M027S03ProofHarnessReport {
  return {
    ...input.evaluation,
    command: "verify:m027:s03",
    generated_at: new Date().toISOString(),
    corpus: input.corpus,
    noop_corpus: input.noopCorpus,
    success: input.evaluation.overallPassed,
  };
}

export function renderM027S03Report(report: M027S03EvaluationReport): string {
  const lines = [
    "M027 / S03 proof harness",
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.id} ${check.passed ? "PASS" : "FAIL"} status_code=${check.status_code} ${check.detail}`);
  }

  return `${lines.join("\n")}\n`;
}

async function executeRepair(corpus: EmbeddingRepairCorpus): Promise<RepairCliReport> {
  return (await runEmbeddingRepairCli({ args: ["--corpus", corpus, "--json"] })).report;
}

async function executeStatus(corpus: EmbeddingRepairCorpus): Promise<RepairCliReport> {
  return (await runEmbeddingRepairCli({ args: ["--corpus", corpus, "--status", "--json"] })).report;
}

async function executeNoopProbe(corpus: EmbeddingRepairCorpus): Promise<RepairCliReport> {
  return (await runEmbeddingRepairCli({ args: ["--corpus", corpus, "--dry-run", "--json"] })).report;
}

async function selectNoopCorpus(targetCorpus: EmbeddingRepairCorpus, requestedNoopCorpus?: EmbeddingRepairCorpus): Promise<RepairCliReport> {
  if (requestedNoopCorpus) {
    return executeNoopProbe(requestedNoopCorpus);
  }

  const candidateCorpora = DEFAULT_NOOP_CORPORA.filter((corpus, index, values) => corpus !== targetCorpus && values.indexOf(corpus) === index);
  let lastReport: RepairCliReport | null = null;

  for (const corpus of candidateCorpora) {
    const report = await executeNoopProbe(corpus);
    lastReport = report;
    if (didNoopProbePass(report)) {
      return report;
    }
  }

  if (lastReport) {
    return lastReport;
  }

  throw new Error(`No noop probe corpus available after excluding ${targetCorpus}`);
}

export async function runM027S03ProofHarness(deps: {
  corpus: EmbeddingRepairCorpus;
  noopCorpus?: EmbeddingRepairCorpus;
  runRepair?: () => Promise<RepairCliReport>;
  getRepairStatus?: () => Promise<RepairCliReport>;
  runNoopProbe?: () => Promise<RepairCliReport>;
  runAudit?: () => Promise<EmbeddingAuditEnvelope>;
}): Promise<{
  report: M027S03ProofHarnessReport;
  human: string;
  json: string;
}> {
  const repair = deps.runRepair
    ? await deps.runRepair()
    : await executeRepair(deps.corpus);

  const status = deps.getRepairStatus
    ? await deps.getRepairStatus()
    : await executeStatus(deps.corpus);

  const noopProbe = deps.runNoopProbe
    ? await deps.runNoopProbe()
    : await selectNoopCorpus(deps.corpus, deps.noopCorpus);

  const audit = deps.runAudit
    ? await deps.runAudit()
    : (await runEmbeddingAuditCli()).report;

  const evaluation = await evaluateM027S03Checks({
    runRepair: async () => repair,
    getRepairStatus: async () => status,
    runNoopProbe: async () => noopProbe,
    runAudit: async () => audit,
  });

  const report = buildM027S03ProofHarnessReport({
    corpus: deps.corpus,
    noopCorpus: noopProbe.corpus,
    evaluation,
  });

  return {
    report,
    human: renderM027S03Report(report),
    json: `${JSON.stringify(report, null, 2)}\n`,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m027:s03 -- --corpus <name> [--noop-corpus <name>] [--json]",
    "",
    "Options:",
    "  --corpus <name>       Required. Target degraded non-wiki corpus to repair and verify",
    "  --noop-corpus <name>  Optional. Remaining corpus to prove through a safe no-op dry-run path",
    "  --json                Print machine-readable JSON output including repair/status/noop/audit evidence",
    "  --help                Show this help",
    "",
    "Environment:",
    "  DATABASE_URL          PostgreSQL connection string (required)",
    "  VOYAGE_API_KEY        VoyageAI API key (required for the live repair step)",
  ].join("\n");
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    runRepair?: () => Promise<RepairCliReport>;
    getRepairStatus?: () => Promise<RepairCliReport>;
    runNoopProbe?: () => Promise<RepairCliReport>;
    runAudit?: () => Promise<EmbeddingAuditEnvelope>;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  },
): Promise<number> {
  const options = parseVerifyM027S03Args(args);
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (!options.corpus) {
    stderr.write("verify:m027:s03 failed: Missing required --corpus <name>\n");
    return 1;
  }

  try {
    const { report, human, json } = await runM027S03ProofHarness({
      corpus: options.corpus,
      noopCorpus: options.noopCorpus,
      runRepair: deps?.runRepair,
      getRepairStatus: deps?.getRepairStatus,
      runNoopProbe: deps?.runNoopProbe,
      runAudit: deps?.runAudit,
    });

    stdout.write(options.json ? json : human);

    if (!report.overallPassed) {
      const failingCodes = report.checks
        .filter((check) => !check.passed)
        .map((check) => `${check.id}:${check.status_code}`)
        .join(", ");
      const failureClasses = [
        report.repair_evidence.run.failure_summary.last_failure_class,
        report.status_evidence.run.failure_summary.last_failure_class,
        report.noop_probe_evidence.run.failure_summary.last_failure_class,
      ].filter((value): value is string => Boolean(value));
      stderr.write(
        `verify:m027:s03 failed: ${failingCodes}${failureClasses.length > 0 ? ` failure_classes=${failureClasses.join(",")}` : ""}\n`,
      );
    }

    return report.overallPassed ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`verify:m027:s03 failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
