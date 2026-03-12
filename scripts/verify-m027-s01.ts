import type { EmbeddingAuditEnvelope } from "../src/knowledge/embedding-audit.ts";
import type { RetrieverVerifierReport } from "../src/knowledge/retriever-verifier.ts";
import { runEmbeddingAuditCli } from "./embedding-audit.ts";
import { parseRetrieverVerifyCliArgs, runRetrieverVerifyCli } from "./retriever-verify.ts";

export const M027_S01_CHECK_IDS = ["M027-S01-AUDIT", "M027-S01-RETRIEVER"] as const;

export type M027S01CheckId = typeof M027_S01_CHECK_IDS[number];

export type M027S01Check = {
  id: M027S01CheckId;
  passed: boolean;
  status_code: string;
  detail: string;
};

export type M027S01EvaluationReport = {
  check_ids: M027S01CheckId[];
  overallPassed: boolean;
  checks: M027S01Check[];
};

export type M027S01ProofHarnessReport = M027S01EvaluationReport & {
  repo: string;
  query: string;
  generated_at: string;
  success: boolean;
  status_code: "m027_s01_ok" | "m027_s01_failed";
  audit: EmbeddingAuditEnvelope;
  retriever: RetrieverVerifierReport;
};

export function parseVerifyM027S01CliArgs(args: string[]): {
  help?: boolean;
  json?: boolean;
  repo?: string;
  query?: string;
} {
  return parseRetrieverVerifyCliArgs(args);
}

function describeAuditCheck(report: {
  success: boolean;
  status_code: string;
  overall_status?: string;
}): string {
  return `audit status_code=${report.status_code} overall_status=${report.overall_status ?? "unknown"}`;
}

function describeRetrieverCheck(report: {
  success: boolean;
  status_code: string;
  query_embedding?: { status: string };
  not_in_retriever?: string[];
}): string {
  const gaps = report.not_in_retriever?.length ? report.not_in_retriever.join(",") : "none";
  return [
    `retriever status_code=${report.status_code}`,
    `query_embedding=${report.query_embedding?.status ?? "unknown"}`,
    `not_in_retriever=${gaps}`,
  ].join(" ");
}

export async function evaluateM027S01Checks(deps: {
  runAudit: () => Promise<{ success: boolean; status_code: string; overall_status?: string }>;
  runRetrieverVerify: () => Promise<{
    success: boolean;
    status_code: string;
    query_embedding?: { status: string };
    not_in_retriever?: string[];
  }>;
}): Promise<M027S01EvaluationReport> {
  const audit = await deps.runAudit();
  const retriever = await deps.runRetrieverVerify();

  const checks: M027S01Check[] = [
    {
      id: "M027-S01-AUDIT",
      passed: audit.success,
      status_code: audit.status_code,
      detail: describeAuditCheck(audit),
    },
    {
      id: "M027-S01-RETRIEVER",
      passed: retriever.success,
      status_code: retriever.status_code,
      detail: describeRetrieverCheck(retriever),
    },
  ];

  return {
    check_ids: [...M027_S01_CHECK_IDS],
    overallPassed: checks.every((check) => check.passed),
    checks,
  };
}

export function buildM027S01ProofHarnessReport(input: {
  repo: string;
  query: string;
  audit: EmbeddingAuditEnvelope;
  retriever: RetrieverVerifierReport;
  evaluation?: M027S01EvaluationReport;
}): M027S01ProofHarnessReport {
  const evaluation = input.evaluation ?? {
    check_ids: [...M027_S01_CHECK_IDS],
    overallPassed: input.audit.success && input.retriever.success,
    checks: [
      {
        id: "M027-S01-AUDIT",
        passed: input.audit.success,
        status_code: input.audit.status_code,
        detail: describeAuditCheck(input.audit),
      },
      {
        id: "M027-S01-RETRIEVER",
        passed: input.retriever.success,
        status_code: input.retriever.status_code,
        detail: describeRetrieverCheck(input.retriever),
      },
    ],
  };

  return {
    ...evaluation,
    repo: input.repo,
    query: input.query,
    generated_at: new Date().toISOString(),
    success: evaluation.overallPassed,
    status_code: evaluation.overallPassed ? "m027_s01_ok" : "m027_s01_failed",
    audit: input.audit,
    retriever: input.retriever,
  };
}

export function renderM027S01Report(report: M027S01EvaluationReport): string {
  const lines = [
    "M027 / S01 proof harness",
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(
      `- ${check.id} ${check.passed ? "PASS" : "FAIL"} status_code=${check.status_code} ${check.detail}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function runM027S01ProofHarness(deps: {
  repo: string;
  query: string;
  runAudit?: () => Promise<EmbeddingAuditEnvelope>;
  runRetrieverVerify?: () => Promise<RetrieverVerifierReport>;
}): Promise<{
  report: M027S01ProofHarnessReport;
  human: string;
  json: string;
}> {
  const audit = deps.runAudit
    ? await deps.runAudit()
    : (await runEmbeddingAuditCli()).report;

  const retriever = deps.runRetrieverVerify
    ? await deps.runRetrieverVerify()
    : (await runRetrieverVerifyCli({ repo: deps.repo, query: deps.query })).report;

  const evaluation = await evaluateM027S01Checks({
    runAudit: async () => audit,
    runRetrieverVerify: async () => retriever,
  });

  const report = buildM027S01ProofHarnessReport({
    repo: deps.repo,
    query: deps.query,
    audit,
    retriever,
    evaluation,
  });

  return {
    report,
    human: renderM027S01Report(report),
    json: `${JSON.stringify(report, null, 2)}\n`,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m027:s01 --repo <owner/repo> --query <text> [--json]",
    "",
    "Options:",
    "  --repo    Repository in owner/repo form",
    "  --query   Query text to run through the live retriever verifier",
    "  --json    Print machine-readable JSON output including audit and verifier evidence",
    "  --help    Show this help",
    "",
    "Environment:",
    "  DATABASE_URL     PostgreSQL connection string (required for the audit and verifier)",
    "  VOYAGE_API_KEY   Enables live query embeddings; without it the verifier reports query_embedding_unavailable",
  ].join("\n");
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    runAudit?: () => Promise<EmbeddingAuditEnvelope>;
    runRetrieverVerify?: () => Promise<RetrieverVerifierReport>;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  },
): Promise<number> {
  const options = parseVerifyM027S01CliArgs(args);
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (!options.repo) {
    stderr.write("verify:m027:s01 failed: Missing required --repo <owner/repo>\n");
    return 1;
  }

  if (!options.query) {
    stderr.write("verify:m027:s01 failed: Missing required --query <text>\n");
    return 1;
  }

  try {
    const { report, human, json } = await runM027S01ProofHarness({
      repo: options.repo,
      query: options.query,
      runAudit: deps?.runAudit,
      runRetrieverVerify: deps?.runRetrieverVerify,
    });

    if (options.json) {
      stdout.write(json);
    } else {
      stdout.write(human);
    }

    if (!report.overallPassed) {
      const failingCodes = report.checks
        .filter((check) => !check.passed)
        .map((check) => `${check.id}:${check.status_code}`)
        .join(", ");
      stderr.write(`verify:m027:s01 failed: ${failingCodes}\n`);
    }

    return report.overallPassed ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`verify:m027:s01 failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
