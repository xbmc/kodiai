import type { EmbeddingAuditEnvelope, EmbeddingAuditCorpusReport } from "../src/knowledge/embedding-audit.ts";
import type { RepairCliReport } from "./wiki-embedding-repair.ts";
import { runEmbeddingAuditCli } from "./embedding-audit.ts";
import { runWikiEmbeddingRepairCli } from "./wiki-embedding-repair.ts";

export const M027_S02_CHECK_IDS = ["M027-S02-REPAIR", "M027-S02-STATUS", "M027-S02-AUDIT"] as const;

export type M027S02CheckId = typeof M027_S02_CHECK_IDS[number];

export type M027S02Check = {
  id: M027S02CheckId;
  passed: boolean;
  status_code: string;
  detail: string;
};

export type M027S02EvaluationReport = {
  check_ids: M027S02CheckId[];
  overallPassed: boolean;
  status_code: "m027_s02_ok" | "m027_s02_resume_required" | "m027_s02_failed";
  checks: M027S02Check[];
  repair_evidence: RepairCliReport;
  status_evidence: RepairCliReport;
  audit_evidence: EmbeddingAuditEnvelope;
};

export type M027S02ProofHarnessReport = M027S02EvaluationReport & {
  command: "verify:m027:s02";
  generated_at: string;
  page_title: string | null;
  success: boolean;
};

export function parseVerifyM027S02Args(args: string[]): {
  help?: boolean;
  json?: boolean;
  pageTitle?: string;
} {
  let pageTitle: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--page-title") {
      pageTitle = args[index + 1];
      index += 1;
    }
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    pageTitle,
  };
}

function formatWindow(windowIndex: number | null, windowsTotal: number | null): string {
  if (windowIndex === null || windowsTotal === null || windowsTotal <= 0) {
    return "none";
  }

  return `${windowIndex + 1}/${windowsTotal}`;
}

function describeRepairCheck(report: RepairCliReport): string {
  return [
    `status_code=${report.status_code}`,
    `run_status=${report.run.status}`,
    `page_title=${report.run.page_title ?? report.requested_page_title ?? "none"}`,
    `window=${formatWindow(report.run.window_index, report.run.windows_total)}`,
    `repaired=${report.run.repaired}`,
    `failed=${report.run.failed}`,
    `retry_count=${report.run.retry_count}`,
    `used_split_fallback=${report.run.used_split_fallback}`,
    `last_failure_class=${report.run.failure_summary.last_failure_class ?? "none"}`,
  ].join(" ");
}

function describeStatusCheck(report: RepairCliReport): string {
  const failureClasses = Object.keys(report.run.failure_summary.by_class).sort();
  return [
    `status_code=${report.status_code}`,
    `run_status=${report.run.status}`,
    `cursor_page_title=${report.run.page_title ?? "none"}`,
    `window=${formatWindow(report.run.window_index, report.run.windows_total)}`,
    `repaired=${report.run.repaired}`,
    `failed=${report.run.failed}`,
    `retry_count=${report.run.retry_count}`,
    `failure_classes=${failureClasses.length > 0 ? failureClasses.join(",") : "none"}`,
    `last_failure_class=${report.run.failure_summary.last_failure_class ?? "none"}`,
  ].join(" ");
}

function findWikiAuditCorpus(report: EmbeddingAuditEnvelope): EmbeddingAuditCorpusReport | undefined {
  return report.corpora.find((corpus) => corpus.corpus === "wiki_pages");
}

function didWikiAuditPass(report: EmbeddingAuditEnvelope): boolean {
  const wiki = findWikiAuditCorpus(report);
  if (!wiki) {
    return false;
  }

  return wiki.status === "pass"
    && wiki.expected_model === "voyage-context-3"
    && wiki.model_mismatch === 0
    && wiki.missing_or_null === 0;
}

function describeAuditCheck(report: EmbeddingAuditEnvelope): string {
  const wiki = findWikiAuditCorpus(report);
  if (!wiki) {
    return `status_code=${report.status_code} wiki_pages=missing`;
  }

  return [
    `status_code=${report.status_code}`,
    `overall_status=${report.overall_status}`,
    `wiki_status=${wiki.status}`,
    `wiki_expected_model=${wiki.expected_model}`,
    `wiki_actual_models=${wiki.actual_models.length > 0 ? wiki.actual_models.join(",") : "none"}`,
    `wiki_model_mismatch=${wiki.model_mismatch}`,
    `wiki_missing_or_null=${wiki.missing_or_null}`,
  ].join(" ");
}

function deriveOverallStatusCode(checks: M027S02Check[]): M027S02EvaluationReport["status_code"] {
  const statusCheck = checks.find((check) => check.id === "M027-S02-STATUS");
  if (statusCheck && !statusCheck.passed && statusCheck.status_code === "repair_resume_available") {
    return "m027_s02_resume_required";
  }

  return checks.every((check) => check.passed) ? "m027_s02_ok" : "m027_s02_failed";
}

export async function evaluateM027S02Checks(deps: {
  runRepair: () => Promise<RepairCliReport>;
  getRepairStatus: () => Promise<RepairCliReport>;
  runAudit: () => Promise<EmbeddingAuditEnvelope>;
}): Promise<M027S02EvaluationReport> {
  const repair = await deps.runRepair();
  const status = await deps.getRepairStatus();
  const audit = await deps.runAudit();

  const checks: M027S02Check[] = [
    {
      id: "M027-S02-REPAIR",
      passed: repair.success && repair.status_code === "repair_completed",
      status_code: repair.status_code,
      detail: describeRepairCheck(repair),
    },
    {
      id: "M027-S02-STATUS",
      passed: status.success && status.status_code === "repair_completed" && status.run.status === "completed",
      status_code: status.status_code,
      detail: describeStatusCheck(status),
    },
    {
      id: "M027-S02-AUDIT",
      passed: didWikiAuditPass(audit),
      status_code: audit.status_code,
      detail: describeAuditCheck(audit),
    },
  ];

  return {
    check_ids: [...M027_S02_CHECK_IDS],
    overallPassed: checks.every((check) => check.passed),
    status_code: deriveOverallStatusCode(checks),
    checks,
    repair_evidence: repair,
    status_evidence: status,
    audit_evidence: audit,
  };
}

export function buildM027S02ProofHarnessReport(input: {
  pageTitle: string | null;
  evaluation: M027S02EvaluationReport;
}): M027S02ProofHarnessReport {
  return {
    ...input.evaluation,
    command: "verify:m027:s02",
    generated_at: new Date().toISOString(),
    page_title: input.pageTitle,
    success: input.evaluation.overallPassed,
  };
}

export function renderM027S02Report(report: M027S02EvaluationReport): string {
  const lines = [
    "M027 / S02 proof harness",
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.id} ${check.passed ? "PASS" : "FAIL"} status_code=${check.status_code} ${check.detail}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function runM027S02ProofHarness(deps: {
  pageTitle: string;
  runRepair?: () => Promise<RepairCliReport>;
  getRepairStatus?: () => Promise<RepairCliReport>;
  runAudit?: () => Promise<EmbeddingAuditEnvelope>;
}): Promise<{
  report: M027S02ProofHarnessReport;
  human: string;
  json: string;
}> {
  const repair = deps.runRepair
    ? await deps.runRepair()
    : (await runWikiEmbeddingRepairCli({ args: ["--page-title", deps.pageTitle, "--json"] })).report;

  const status = deps.getRepairStatus
    ? await deps.getRepairStatus()
    : (await runWikiEmbeddingRepairCli({ args: ["--status", "--json"] })).report;

  const audit = deps.runAudit
    ? await deps.runAudit()
    : (await runEmbeddingAuditCli()).report;

  const evaluation = await evaluateM027S02Checks({
    runRepair: async () => repair,
    getRepairStatus: async () => status,
    runAudit: async () => audit,
  });

  const report = buildM027S02ProofHarnessReport({
    pageTitle: deps.pageTitle,
    evaluation,
  });

  return {
    report,
    human: renderM027S02Report(report),
    json: `${JSON.stringify(report, null, 2)}\n`,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m027:s02 -- --page-title <title> [--json]",
    "",
    "Options:",
    "  --page-title <title>  Target representative wiki page title to repair and verify",
    "  --json                Print machine-readable JSON output including repair/status/audit evidence",
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
    runAudit?: () => Promise<EmbeddingAuditEnvelope>;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  },
): Promise<number> {
  const options = parseVerifyM027S02Args(args);
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (!options.pageTitle) {
    stderr.write("verify:m027:s02 failed: Missing required --page-title <title>\n");
    return 1;
  }

  try {
    const { report, human, json } = await runM027S02ProofHarness({
      pageTitle: options.pageTitle,
      runRepair: deps?.runRepair,
      getRepairStatus: deps?.getRepairStatus,
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
      ].filter((value): value is string => Boolean(value));
      stderr.write(
        `verify:m027:s02 failed: ${failingCodes}${failureClasses.length > 0 ? ` failure_classes=${failureClasses.join(",")}` : ""}\n`,
      );
    }

    return report.overallPassed ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`verify:m027:s02 failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
