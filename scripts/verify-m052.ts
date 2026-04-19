import {
  evaluateM052S01,
  type M052S01Report,
} from "./verify-m052-s01.ts";
import {
  evaluateM052S02,
  type M052S02Report,
} from "./verify-m052-s02.ts";

export type M052CheckId = "M052-S03-S01-PROOF" | "M052-S03-S02-PROOF";

export interface M052Check {
  id: M052CheckId;
  passed: boolean;
  detail: string;
}

export interface M052Report {
  command: "verify:m052";
  generatedAt: string;
  overallPassed: boolean;
  status_code: "m052_ok" | "m052_proof_drift";
  checks: M052Check[];
  s01: M052S01Report | null;
  s02: M052S02Report | null;
  issues: string[];
}

function buildCheck(input: { id: M052CheckId; passed: boolean; detail: string }): M052Check {
  return {
    id: input.id,
    passed: input.passed,
    detail: input.detail,
  };
}

export async function evaluateM052(opts?: {
  generatedAt?: string;
  _evaluateS01?: typeof evaluateM052S01;
  _evaluateS02?: typeof evaluateM052S02;
}): Promise<M052Report> {
  const generatedAt = opts?.generatedAt ?? new Date().toISOString();
  const evaluateS01Impl = opts?._evaluateS01 ?? evaluateM052S01;
  const evaluateS02Impl = opts?._evaluateS02 ?? evaluateM052S02;

  const [s01, s02] = await Promise.all([
    evaluateS01Impl({ generatedAt }),
    evaluateS02Impl({ generatedAt }),
  ]);

  const checks: M052Check[] = [
    buildCheck({
      id: "M052-S03-S01-PROOF",
      passed: s01.success,
      detail: s01.success
        ? `S01 proof passed with status ${s01.status_code}`
        : `S01 proof drifted with status ${s01.status_code}`,
    }),
    buildCheck({
      id: "M052-S03-S02-PROOF",
      passed: s02.success,
      detail: s02.success
        ? `S02 proof passed with status ${s02.status_code}`
        : `S02 proof drifted with status ${s02.status_code}`,
    }),
  ];

  const issues = checks.filter((check) => !check.passed).map((check) => `${check.id}: ${check.detail}`);

  return {
    command: "verify:m052",
    generatedAt,
    overallPassed: issues.length === 0,
    status_code: issues.length === 0 ? "m052_ok" : "m052_proof_drift",
    checks,
    s01,
    s02,
    issues,
  };
}

function renderHumanReport(report: M052Report): string {
  return [
    "# verify:m052",
    "",
    `status: ${report.status_code}`,
    `overallPassed: ${report.overallPassed ? "yes" : "no"}`,
    "",
    "checks:",
    ...report.checks.map((check) => `- [${check.passed ? "x" : " "}] ${check.id}: ${check.detail}`),
    ...(report.issues.length > 0 ? ["", "issues:", ...report.issues.map((issue) => `- ${issue}`)] : []),
    "",
  ].join("\n");
}

export async function main(
  args: string[] = process.argv.slice(2),
  io?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluate?: typeof evaluateM052;
  },
): Promise<number> {
  const stdout = io?.stdout ?? process.stdout;
  const stderr = io?.stderr ?? process.stderr;
  const evaluate = io?.evaluate ?? evaluateM052;

  try {
    const report = await evaluate({ generatedAt: new Date().toISOString() });
    if (args.includes("--json")) {
      stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      stdout.write(renderHumanReport(report));
    }
    return report.overallPassed ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
