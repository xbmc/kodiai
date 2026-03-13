import { NON_WIKI_REPAIR_CORPORA, type EmbeddingRepairCorpus } from "../src/knowledge/embedding-repair.ts";
import {
  runM027S01ProofHarness,
  type M027S01ProofHarnessReport,
} from "./verify-m027-s01.ts";
import {
  runM027S02ProofHarness,
  type M027S02ProofHarnessReport,
} from "./verify-m027-s02.ts";
import {
  runM027S03ProofHarness,
  type M027S03ProofHarnessReport,
} from "./verify-m027-s03.ts";

export const M027_S04_CHECK_IDS = [
  "M027-S04-FULL-AUDIT",
  "M027-S04-RETRIEVER",
  "M027-S04-WIKI-REPAIR-STATE",
  "M027-S04-NON-WIKI-REPAIR-STATE",
] as const;

export type M027S04CheckId = typeof M027_S04_CHECK_IDS[number];

export type M027S04Check = {
  id: M027S04CheckId;
  passed: boolean;
  status_code: string;
  detail: string;
};

export type M027S04EvaluationReport = {
  check_ids: M027S04CheckId[];
  overallPassed: boolean;
  status_code: "m027_s04_ok" | "m027_s04_resume_required" | "m027_s04_failed";
  checks: M027S04Check[];
  s01: M027S01ProofHarnessReport;
  s02: M027S02ProofHarnessReport;
  s03: M027S03ProofHarnessReport;
};

export type M027S04ProofHarnessReport = M027S04EvaluationReport & {
  command: "verify:m027:s04";
  generated_at: string;
  repo: string;
  query: string;
  page_title: string;
  corpus: EmbeddingRepairCorpus;
  success: boolean;
};

function isEmbeddingRepairCorpus(value: string | undefined): value is EmbeddingRepairCorpus {
  return value != null && NON_WIKI_REPAIR_CORPORA.includes(value as EmbeddingRepairCorpus);
}

export function parseVerifyM027S04Args(args: string[]): {
  help?: boolean;
  json?: boolean;
  repo?: string;
  query?: string;
  pageTitle?: string;
  corpus?: EmbeddingRepairCorpus;
} {
  let repo: string | undefined;
  let query: string | undefined;
  let pageTitle: string | undefined;
  let corpus: EmbeddingRepairCorpus | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo") {
      repo = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--query") {
      query = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--page-title") {
      pageTitle = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--corpus") {
      const value = args[index + 1];
      if (isEmbeddingRepairCorpus(value)) {
        corpus = value;
      }
      index += 1;
    }
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    repo,
    query,
    pageTitle,
    corpus,
  };
}

function summarizeAuditCorpora(report: M027S01ProofHarnessReport["audit"]): string {
  return report.corpora
    .map((corpus) => `${corpus.corpus}:${corpus.status}`)
    .join(",");
}

function describeFullAuditCheck(report: M027S01ProofHarnessReport): string {
  const failing = report.audit.corpora
    .filter((corpus) => corpus.status !== "pass" || corpus.model_mismatch !== 0 || corpus.missing_or_null !== 0)
    .map((corpus) => `${corpus.corpus}:status=${corpus.status},missing_or_null=${corpus.missing_or_null},model_mismatch=${corpus.model_mismatch}`);

  return [
    `s01_status=${report.status_code}`,
    `audit_status_code=${report.audit.status_code}`,
    `overall_status=${report.audit.overall_status}`,
    `corpora=${summarizeAuditCorpora(report.audit)}`,
    `failures=${failing.length > 0 ? failing.join(";") : "none"}`,
  ].join(" ");
}

function getRetrieverStatusCode(report: M027S01ProofHarnessReport): string {
  const notInRetriever = report.retriever.not_in_retriever ?? [];
  if (!notInRetriever.includes("issue_comments")) {
    return "retriever_scope_mismatch";
  }

  return report.retriever.status_code;
}

function didRetrieverPass(report: M027S01ProofHarnessReport): boolean {
  return report.retriever.success
    && report.retriever.status_code === "retrieval_hits"
    && report.retriever.query_embedding?.status === "generated"
    && (report.retriever.not_in_retriever ?? []).includes("issue_comments");
}

function describeRetrieverCheck(report: M027S01ProofHarnessReport): string {
  const notInRetriever = report.retriever.not_in_retriever?.length
    ? report.retriever.not_in_retriever.join(",")
    : "none";
  const scopeTruthful = (report.retriever.not_in_retriever ?? []).includes("issue_comments");

  return [
    `s01_status=${report.status_code}`,
    `retriever_status_code=${report.retriever.status_code}`,
    `query_embedding=${report.retriever.query_embedding?.status ?? "unknown"}`,
    `not_in_retriever=${notInRetriever}`,
    `scope_truthful=${scopeTruthful}`,
    scopeTruthful ? "expected_gap=issue_comments" : "missing_expected_gap=issue_comments",
  ].join(" ");
}

function didWikiRepairProbePass(report: M027S02ProofHarnessReport): boolean {
  return report.repair_evidence.success
    && ["repair_completed", "repair_not_needed"].includes(report.repair_evidence.status_code)
    && ["completed", "not_needed"].includes(report.repair_evidence.run.status);
}

function didWikiDurableStatusPass(report: M027S02ProofHarnessReport): boolean {
  return report.status_evidence.success
    && report.status_evidence.status_code === "repair_completed"
    && ["completed", "not_needed"].includes(report.status_evidence.run.status)
    && report.status_evidence.run.failed === 0
    && report.status_evidence.run.failure_summary.last_failure_class == null;
}

function describeWikiRepairStateCheck(report: M027S02ProofHarnessReport): string {
  return [
    `s02_status=${report.status_code}`,
    `repair_probe_status_code=${report.repair_evidence.status_code}`,
    `repair_probe_run_status=${report.repair_evidence.run.status}`,
    `durable_status_code=${report.status_evidence.status_code}`,
    `durable_run_status=${report.status_evidence.run.status}`,
    `page_title=${report.status_evidence.run.page_title ?? report.page_title ?? "none"}`,
    `failed=${report.status_evidence.run.failed}`,
    `last_failure_class=${report.status_evidence.run.failure_summary.last_failure_class ?? "none"}`,
  ].join(" ");
}

function didNonWikiRepairProbePass(report: M027S03ProofHarnessReport): boolean {
  return report.repair_evidence.success
    && ["repair_completed", "repair_not_needed"].includes(report.repair_evidence.status_code)
    && ["completed", "not_needed"].includes(report.repair_evidence.run.status)
    && report.repair_evidence.run.failed === 0;
}

function didNonWikiDurableStatusPass(report: M027S03ProofHarnessReport): boolean {
  return report.status_evidence.success
    && report.status_evidence.status_code === "repair_completed"
    && ["completed", "not_needed"].includes(report.status_evidence.run.status)
    && report.status_evidence.run.failed === 0
    && report.status_evidence.run.failure_summary.last_failure_class == null;
}

function describeNonWikiRepairStateCheck(report: M027S03ProofHarnessReport): string {
  return [
    `s03_status=${report.status_code}`,
    `corpus=${report.corpus}`,
    `repair_probe_status_code=${report.repair_evidence.status_code}`,
    `repair_probe_run_status=${report.repair_evidence.run.status}`,
    `durable_status_code=${report.status_evidence.status_code}`,
    `durable_run_status=${report.status_evidence.run.status}`,
    `last_row_id=${report.status_evidence.run.last_row_id ?? "none"}`,
    `failed=${report.status_evidence.run.failed}`,
    `last_failure_class=${report.status_evidence.run.failure_summary.last_failure_class ?? "none"}`,
  ].join(" ");
}

function deriveOverallStatusCode(checks: M027S04Check[]): M027S04EvaluationReport["status_code"] {
  const repairStateChecks = checks.filter(
    (check) => check.id === "M027-S04-WIKI-REPAIR-STATE" || check.id === "M027-S04-NON-WIKI-REPAIR-STATE",
  );

  if (repairStateChecks.some((check) => !check.passed && check.status_code === "repair_resume_available")) {
    return "m027_s04_resume_required";
  }

  return checks.every((check) => check.passed) ? "m027_s04_ok" : "m027_s04_failed";
}

export async function evaluateM027S04Checks(deps: {
  runS01: () => Promise<M027S01ProofHarnessReport>;
  runS02: () => Promise<M027S02ProofHarnessReport>;
  runS03: () => Promise<M027S03ProofHarnessReport>;
}): Promise<M027S04EvaluationReport> {
  const s01 = await deps.runS01();
  const s02 = await deps.runS02();
  const s03 = await deps.runS03();

  const fullAuditPassed = s01.audit.success
    && s01.audit.status_code === "audit_ok"
    && s01.audit.overall_status === "pass"
    && s01.audit.corpora.length >= 6
    && s01.audit.corpora.every((corpus) => corpus.status === "pass" && corpus.model_mismatch === 0 && corpus.missing_or_null === 0);

  const wikiRepairStatePassed = didWikiRepairProbePass(s02) && didWikiDurableStatusPass(s02);
  const nonWikiRepairStatePassed = didNonWikiRepairProbePass(s03) && didNonWikiDurableStatusPass(s03);

  const checks: M027S04Check[] = [
    {
      id: "M027-S04-FULL-AUDIT",
      passed: fullAuditPassed,
      status_code: s01.audit.status_code,
      detail: describeFullAuditCheck(s01),
    },
    {
      id: "M027-S04-RETRIEVER",
      passed: didRetrieverPass(s01),
      status_code: getRetrieverStatusCode(s01),
      detail: describeRetrieverCheck(s01),
    },
    {
      id: "M027-S04-WIKI-REPAIR-STATE",
      passed: wikiRepairStatePassed,
      status_code: s02.status_evidence.status_code,
      detail: describeWikiRepairStateCheck(s02),
    },
    {
      id: "M027-S04-NON-WIKI-REPAIR-STATE",
      passed: nonWikiRepairStatePassed,
      status_code: s03.status_evidence.status_code,
      detail: describeNonWikiRepairStateCheck(s03),
    },
  ];

  return {
    check_ids: [...M027_S04_CHECK_IDS],
    overallPassed: checks.every((check) => check.passed),
    status_code: deriveOverallStatusCode(checks),
    checks,
    s01,
    s02,
    s03,
  };
}

export function buildM027S04ProofHarnessReport(input: {
  repo: string;
  query: string;
  pageTitle: string;
  corpus: EmbeddingRepairCorpus;
  evaluation: M027S04EvaluationReport;
}): M027S04ProofHarnessReport {
  return {
    ...input.evaluation,
    command: "verify:m027:s04",
    generated_at: new Date().toISOString(),
    repo: input.repo,
    query: input.query,
    page_title: input.pageTitle,
    corpus: input.corpus,
    success: input.evaluation.overallPassed,
  };
}

export function renderM027S04Report(report: M027S04EvaluationReport): string {
  const lines = [
    "M027 / S04 final integrated proof harness",
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    `Status code: ${report.status_code}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.id} ${check.passed ? "PASS" : "FAIL"} status_code=${check.status_code} ${check.detail}`);
  }

  lines.push(
    "Nested evidence:",
    `- s01 status_code=${report.s01.status_code} retriever_status=${report.s01.retriever.status_code} not_in_retriever=${report.s01.retriever.not_in_retriever?.join(",") ?? "none"}`,
    `- s02 status_code=${report.s02.status_code} repair_probe=${report.s02.repair_evidence.status_code} durable_status=${report.s02.status_evidence.status_code}`,
    `- s03 status_code=${report.s03.status_code} repair_probe=${report.s03.repair_evidence.status_code} durable_status=${report.s03.status_evidence.status_code}`,
  );

  return `${lines.join("\n")}\n`;
}

export async function runM027S04ProofHarness(deps: {
  repo: string;
  query: string;
  pageTitle: string;
  corpus: EmbeddingRepairCorpus;
  runS01?: () => Promise<M027S01ProofHarnessReport>;
  runS02?: () => Promise<M027S02ProofHarnessReport>;
  runS03?: () => Promise<M027S03ProofHarnessReport>;
}): Promise<{
  report: M027S04ProofHarnessReport;
  human: string;
  json: string;
}> {
  const s01 = deps.runS01
    ? await deps.runS01()
    : (await runM027S01ProofHarness({ repo: deps.repo, query: deps.query })).report;

  const s02 = deps.runS02
    ? await deps.runS02()
    : (await runM027S02ProofHarness({ pageTitle: deps.pageTitle })).report;

  const s03 = deps.runS03
    ? await deps.runS03()
    : (await runM027S03ProofHarness({ corpus: deps.corpus })).report;

  const evaluation = await evaluateM027S04Checks({
    runS01: async () => s01,
    runS02: async () => s02,
    runS03: async () => s03,
  });

  const report = buildM027S04ProofHarnessReport({
    repo: deps.repo,
    query: deps.query,
    pageTitle: deps.pageTitle,
    corpus: deps.corpus,
    evaluation,
  });

  return {
    report,
    human: renderM027S04Report(report),
    json: `${JSON.stringify(report, null, 2)}\n`,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m027:s04 -- --repo <owner/repo> --query <text> --page-title <title> --corpus <name> [--json]",
    "",
    "Options:",
    "  --repo <owner/repo>   Required. Repository to exercise through the live retriever verifier",
    "  --query <text>        Required. Query text to run through the live retriever verifier",
    "  --page-title <title>  Required. Representative wiki page title for the wiki repair proof",
    "  --corpus <name>       Required. Target non-wiki corpus for the durable repair proof",
    "  --json                Print machine-readable JSON output including nested s01/s02/s03 evidence",
    "  --help                Show this help",
    "",
    "Environment:",
    "  DATABASE_URL          PostgreSQL connection string (required)",
    "  VOYAGE_API_KEY        VoyageAI API key (required for live retriever and repair proofs)",
  ].join("\n");
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    runS01?: () => Promise<M027S01ProofHarnessReport>;
    runS02?: () => Promise<M027S02ProofHarnessReport>;
    runS03?: () => Promise<M027S03ProofHarnessReport>;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  },
): Promise<number> {
  const options = parseVerifyM027S04Args(args);
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (!options.repo) {
    stderr.write("verify:m027:s04 failed: Missing required --repo <owner/repo>\n");
    return 1;
  }

  if (!options.query) {
    stderr.write("verify:m027:s04 failed: Missing required --query <text>\n");
    return 1;
  }

  if (!options.pageTitle) {
    stderr.write("verify:m027:s04 failed: Missing required --page-title <title>\n");
    return 1;
  }

  if (!options.corpus) {
    stderr.write("verify:m027:s04 failed: Missing required --corpus <name>\n");
    return 1;
  }

  try {
    const { report, human, json } = await runM027S04ProofHarness({
      repo: options.repo,
      query: options.query,
      pageTitle: options.pageTitle,
      corpus: options.corpus,
      runS01: deps?.runS01,
      runS02: deps?.runS02,
      runS03: deps?.runS03,
    });

    stdout.write(options.json ? json : human);

    if (!report.overallPassed) {
      const failingCodes = report.checks
        .filter((check) => !check.passed)
        .map((check) => `${check.id}:${check.status_code}`)
        .join(", ");
      stderr.write(`verify:m027:s04 failed: ${failingCodes}\n`);
    }

    return report.overallPassed ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`verify:m027:s04 failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
