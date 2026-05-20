import {
  COMMAND_NAME as S01_COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT as S01_EXPECTED_PACKAGE_SCRIPT,
  evaluateM075S01Contract,
  type M075S01Report,
} from "./verify-m075-s01.ts";
import {
  COMMAND_NAME as S02_COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT as S02_EXPECTED_PACKAGE_SCRIPT,
  evaluateM075S02Contract,
  type M075S02Report,
} from "./verify-m075-s02.ts";
import {
  COMMAND_NAME as S03_COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT as S03_EXPECTED_PACKAGE_SCRIPT,
  evaluateM075S03Contract,
  type M075S03Report,
} from "./verify-m075-s03.ts";
import {
  COMMAND_NAME as S04_COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT as S04_EXPECTED_PACKAGE_SCRIPT,
  evaluateM075S04Contract,
  type M075S04Report,
} from "./verify-m075-s04.ts";
import {
  COMMAND_NAME as S05_COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT as S05_EXPECTED_PACKAGE_SCRIPT,
  evaluateM075S05Contract,
  type M075S05Report,
} from "./verify-m075-s05.ts";
import {
  COMMAND_NAME as S06_COMMAND_NAME,
  EXPECTED_PACKAGE_SCRIPT as S06_EXPECTED_PACKAGE_SCRIPT,
  evaluateM075S06Contract,
  type M075S06Report,
} from "./verify-m075-s06.ts";

export const COMMAND_NAME = "verify:m075" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m075.ts" as const;

export type M075StatusCode =
  | "m075_ok"
  | "m075_contract_failed"
  | "m075_invalid_arg";
export type M075CheckStatus = "pass" | "fail" | "blocked";
export type M075ChildKey = "s01" | "s02" | "s03" | "s04" | "s05" | "s06";
export type M075CheckId =
  | "local.s01.pass"
  | "local.s02.pass"
  | "local.s03.pass"
  | "local.s04.pass"
  | "local.s05.pass"
  | "local.s06.pass"
  | "package-wiring.present"
  | "redaction.safe"
  | "local-contracts.pass";

export type M075Args = { readonly json: boolean; readonly help: boolean };
export type M075Check = { readonly id: M075CheckId; readonly status: M075CheckStatus; readonly message: string; readonly issues: readonly string[] };
export type M075ChildReport = M075S01Report | M075S02Report | M075S03Report | M075S04Report | M075S05Report | M075S06Report;
export type M075ChildEvaluator = () => Promise<unknown>;
export type M075ChildSummary = {
  readonly child: M075ChildKey;
  readonly command: string;
  readonly success: boolean;
  readonly statusCode: string;
  readonly failedCheckIds: readonly string[];
  readonly checkCount: number;
  readonly issueCount: number;
};
export type M075Observed = {
  readonly childCount: number;
  readonly passedChildCount: number;
  readonly failedChildCount: number;
  readonly blockedChildCount: number;
  readonly packageScriptsChecked: readonly string[];
};
export type M075Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: M075StatusCode;
  readonly failedCheckIds: readonly M075CheckId[];
  readonly checks: readonly M075Check[];
  readonly observed: M075Observed;
  readonly children: readonly M075ChildSummary[];
  readonly issues: readonly string[];
};
export type EvaluateM075Options = {
  readonly generatedAt?: string;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly childEvaluators?: Partial<Record<M075ChildKey, M075ChildEvaluator>>;
  /** Intentionally unsupported: aggregate local proof always uses each child verifier's default bounded local contract. */
  readonly fixturePaths?: never;
};
export type M075Writer = { readonly write: (chunk: string) => unknown };
export type M075MainOptions = { readonly stdout?: M075Writer; readonly stderr?: M075Writer; readonly evaluate?: (args: M075Args) => Promise<M075Report> };

const HELP_TEXT = `Usage: bun scripts/verify-m075.ts [--json] [--help]\n\nRuns the aggregate local M075 proof gate by composing S01-S06 bounded local verifier contracts. This command is local-only: it does not accept fixture overrides or live evidence flags.\n`;
const MAX_ISSUES = 30;
const CHILD_ORDER: readonly M075ChildKey[] = ["s01", "s02", "s03", "s04", "s05", "s06"];
const CHILD_COMMANDS: Record<M075ChildKey, string> = {
  s01: S01_COMMAND_NAME,
  s02: S02_COMMAND_NAME,
  s03: S03_COMMAND_NAME,
  s04: S04_COMMAND_NAME,
  s05: S05_COMMAND_NAME,
  s06: S06_COMMAND_NAME,
};
const EXPECTED_PACKAGE_SCRIPTS: Record<string, string> = {
  [COMMAND_NAME]: EXPECTED_PACKAGE_SCRIPT,
  [S01_COMMAND_NAME]: S01_EXPECTED_PACKAGE_SCRIPT,
  [S02_COMMAND_NAME]: S02_EXPECTED_PACKAGE_SCRIPT,
  [S03_COMMAND_NAME]: S03_EXPECTED_PACKAGE_SCRIPT,
  [S04_COMMAND_NAME]: S04_EXPECTED_PACKAGE_SCRIPT,
  [S05_COMMAND_NAME]: S05_EXPECTED_PACKAGE_SCRIPT,
  [S06_COMMAND_NAME]: S06_EXPECTED_PACKAGE_SCRIPT,
};
const FORBIDDEN_RAW_VALUE = /(RAW_PROMPT_CANARY|RAW_MODEL_OUTPUT_CANARY|CANDIDATE_BODY_CANARY|TOOL_PAYLOAD_CANARY|RAW_PAYLOAD_CANARY|RAW_CHECKER_OUTPUT_CANARY|SECRET_TOKEN_CANARY|DIFF_TEXT_CANARY|WORKSPACE_PATH_CANARY|GITHUB_PAYLOAD_CANARY|PROMPT_SECRET|TOKEN=|diff --git|sk-[a-z0-9]|ghp_|github_pat_|-----BEGIN [A-Z ]*PRIVATE KEY-----|\/home\/|\/tmp\/)/i;

export function parseM075Args(args: readonly string[]): M075Args {
  const parsed: Partial<M075Args> = { json: false, help: false };
  for (const arg of args) {
    if (arg === "--json") { parsed.json = true; continue; }
    if (arg === "--help" || arg === "-h") { parsed.help = true; continue; }
    if (arg === "--fixture" || arg === "--live" || arg === "--allow-blocked") throw new Error(`invalid_cli_args: ${arg} is not supported by aggregate local verifier`);
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }
  return parsed as M075Args;
}

export async function evaluateM075Contract(options: EvaluateM075Options = {}): Promise<M075Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const malformedOptions = validateAggregateOptions(options);
  if (malformedOptions.length > 0) {
    const checks: M075Check[] = [
      fail("package-wiring.present", "Package wiring was not evaluated because aggregate options were malformed.", []),
      fail("redaction.safe", "Redaction was not evaluated because aggregate options were malformed.", []),
      fail("local-contracts.pass", "Aggregate verifier options are malformed.", malformedOptions),
    ];
    return finalize(generatedAt, checks, [], malformedOptions.map((issue) => `aggregate-options: ${issue}`), []);
  }

  const packageText = await (options.readPackageJsonText ?? (() => Bun.file("package.json").text()))().catch(() => "{}");
  const sharedPackageReader = async () => packageText;
  const evaluators: Record<M075ChildKey, M075ChildEvaluator> = {
    s01: () => evaluateM075S01Contract(undefined, { readPackageJsonText: sharedPackageReader }),
    s02: () => evaluateM075S02Contract({ readPackageJsonText: sharedPackageReader }),
    s03: () => evaluateM075S03Contract(undefined, { readPackageJsonText: sharedPackageReader }),
    s04: () => evaluateM075S04Contract(undefined, { readPackageJsonText: sharedPackageReader }),
    s05: () => evaluateM075S05Contract(undefined, { readPackageJsonText: sharedPackageReader }),
    s06: () => evaluateM075S06Contract(undefined, { readPackageJsonText: sharedPackageReader }),
    ...options.childEvaluators,
  };

  const childResults = await Promise.all(CHILD_ORDER.map(async (child) => evaluateChild(child, evaluators[child])));
  const childChecks = childResults.map(({ child, report, errorIssues }) => childPassCheck(child, report, errorIssues));
  const packageCheck = packageWiringCheck(packageText);
  const redactionCheck = redactionSafeCheck(childResults);
  const localContractsCheck = localContractsCheckFor(childChecks, packageCheck, redactionCheck);
  const checks = [...childChecks, packageCheck, redactionCheck, localContractsCheck];
  const children = childResults.map(({ child, report, errorIssues }) => summarizeChild(child, report, errorIssues));
  const issues = boundIssues(checks.flatMap((check) => check.issues.map((issue) => `${check.id}: ${sanitizeIssue(issue)}`)));
  return finalize(generatedAt, checks, children, issues, EXPECTED_PACKAGE_SCRIPT_NAMES);
}

async function evaluateChild(child: M075ChildKey, evaluator: M075ChildEvaluator): Promise<{ readonly child: M075ChildKey; readonly report: M075ChildReport | null; readonly errorIssues: readonly string[] }> {
  try {
    const value = await evaluator();
    if (!isChildReport(value, CHILD_COMMANDS[child])) {
      return { child, report: null, errorIssues: [`${child}: evaluator returned malformed report shape.`] };
    }
    return { child, report: value, errorIssues: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { child, report: null, errorIssues: [`${child}: evaluator threw ${sanitizeIssue(message)}`] };
  }
}

function childPassCheck(child: M075ChildKey, report: M075ChildReport | null, errorIssues: readonly string[]): M075Check {
  const id = `local.${child}.pass` as M075CheckId;
  if (!report) return fail(id, `${child.toUpperCase()} verifier failed closed before producing a valid report.`, errorIssues);
  const failed = report.failedCheckIds.map(String);
  const childStatus = childAggregateStatus(report);
  if (report.success && failed.length === 0 && childStatus === "pass") {
    return pass(id, `${report.command} passed with statusCode=${report.statusCode}.`);
  }
  return {
    id,
    status: childStatus,
    message: `${report.command} failed with statusCode=${report.statusCode}.`,
    issues: boundIssues([
      `statusCode=${report.statusCode}`,
      ...failed.map((checkId) => `failedCheckId=${checkId}`),
      ...childIssues(report).map((issue) => sanitizeIssue(String(issue))),
    ]),
  };
}

function childAggregateStatus(report: M075ChildReport): M075CheckStatus {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  if (checks.some((check) => isRecord(check) && check.status === "blocked")) return "blocked";
  return report.success ? "pass" : "fail";
}

function packageWiringCheck(packageJsonText: string): M075Check {
  const issues: string[] = [];
  try {
    const packageJson = JSON.parse(packageJsonText) as { scripts?: Record<string, string> };
    for (const [scriptName, expected] of Object.entries(EXPECTED_PACKAGE_SCRIPTS)) {
      if (packageJson.scripts?.[scriptName] !== expected) issues.push(`${scriptName} must be wired to ${expected}.`);
    }
  } catch {
    issues.push("package.json could not be parsed.");
  }
  return issues.length === 0
    ? pass("package-wiring.present", "Aggregate and S01-S06 package scripts are wired to their verifier entrypoints.")
    : fail("package-wiring.present", "Package script wiring is missing or drifted.", issues);
}

function redactionSafeCheck(childResults: readonly { readonly child: M075ChildKey; readonly report: M075ChildReport | null; readonly errorIssues: readonly string[] }[]): M075Check {
  const issues: string[] = [];
  for (const result of childResults) {
    const serialized = result.report ? JSON.stringify(result.report) : result.errorIssues.join("\n");
    if (FORBIDDEN_RAW_VALUE.test(serialized)) issues.push(`${result.child}: child report contained unsafe raw evidence and was redacted by aggregate verifier.`);
  }
  return issues.length === 0
    ? pass("redaction.safe", "Aggregate child summaries and issue output exclude raw logs, prompts, model/tool payloads, diffs, local paths, and secret-like values.")
    : fail("redaction.safe", "Unsafe child issue text or report content reached the aggregate boundary.", issues);
}

function localContractsCheckFor(childChecks: readonly M075Check[], packageCheck: M075Check, redactionCheck: M075Check): M075Check {
  const failing = [...childChecks, packageCheck, redactionCheck].filter((check) => check.status !== "pass");
  if (failing.length === 0) return pass("local-contracts.pass", "All S01-S06 local verifier contracts passed and aggregate safety checks passed.");
  const hasBlocked = failing.some((check) => check.status === "blocked");
  return {
    id: "local-contracts.pass",
    status: hasBlocked ? "blocked" : "fail",
    message: "One or more local M075 proof contracts failed, blocked, or became unsafe.",
    issues: failing.map((check) => `${check.id}=${check.status}`),
  };
}

function summarizeChild(child: M075ChildKey, report: M075ChildReport | null, errorIssues: readonly string[]): M075ChildSummary {
  if (!report) {
    return {
      child,
      command: CHILD_COMMANDS[child],
      success: false,
      statusCode: "m075_aggregate_child_malformed",
      failedCheckIds: ["child-report.shape"],
      checkCount: 0,
      issueCount: errorIssues.length,
    };
  }
  return {
    child,
    command: report.command,
    success: report.success,
    statusCode: report.statusCode,
    failedCheckIds: report.failedCheckIds.map(String),
    checkCount: report.checks.length,
    issueCount: childIssues(report).length,
  };
}

function finalize(generatedAt: string, checks: readonly M075Check[], children: readonly M075ChildSummary[], issues: readonly string[], packageScriptsChecked: readonly string[]): M075Report {
  const failedCheckIds = uniqueSorted(checks.filter((check) => check.status !== "pass").map((check) => check.id));
  const blockedChildCount = checks.filter((check) => check.id.startsWith("local.s") && check.status === "blocked").length;
  const failedChildCount = checks.filter((check) => check.id.startsWith("local.s") && check.status !== "pass").length;
  const childCount = CHILD_ORDER.length;
  return {
    command: COMMAND_NAME,
    generatedAt,
    success: failedCheckIds.length === 0,
    statusCode: failedCheckIds.length === 0 ? "m075_ok" : "m075_contract_failed",
    failedCheckIds,
    checks,
    observed: {
      childCount,
      passedChildCount: childCount - failedChildCount,
      failedChildCount,
      blockedChildCount,
      packageScriptsChecked,
    },
    children,
    issues: boundIssues(issues.map(sanitizeIssue)),
  };
}

function validateAggregateOptions(options: EvaluateM075Options): string[] {
  const issues: string[] = [];
  if ("fixturePaths" in options) issues.push("aggregate verifier does not accept fixturePaths; child verifiers must use default bounded local fixtures.");
  const childEvaluators = options.childEvaluators;
  if (childEvaluators !== undefined) {
    if (!isRecord(childEvaluators)) issues.push("childEvaluators must be an object keyed by s01-s06.");
    else {
      for (const [key, value] of Object.entries(childEvaluators)) {
        if (!CHILD_ORDER.includes(key as M075ChildKey)) issues.push(`unknown child evaluator key ${key}.`);
        if (typeof value !== "function") issues.push(`child evaluator ${key} must be a function.`);
      }
    }
  }
  return issues;
}

function isChildReport(value: unknown, command: string): value is M075ChildReport {
  if (!isRecord(value)) return false;
  return value.command === command
    && typeof value.generatedAt === "string"
    && typeof value.success === "boolean"
    && typeof value.statusCode === "string"
    && Array.isArray(value.failedCheckIds)
    && Array.isArray(value.checks)
    && (value.issues === undefined || Array.isArray(value.issues));
}

function childIssues(report: M075ChildReport): readonly unknown[] {
  return Array.isArray((report as { readonly issues?: readonly unknown[] }).issues) ? (report as { readonly issues: readonly unknown[] }).issues : [];
}

function pass(id: M075CheckId, message: string): M075Check {
  return { id, status: "pass", message, issues: [] };
}

function fail(id: M075CheckId, message: string, issues: readonly string[]): M075Check {
  return { id, status: "fail", message, issues: boundIssues(issues.map(sanitizeIssue)) };
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return Array.from(new Set(values)).sort();
}

function boundIssues(issues: readonly string[]): readonly string[] {
  return issues.slice(0, MAX_ISSUES);
}

function sanitizeIssue(issue: string): string {
  return FORBIDDEN_RAW_VALUE.test(issue) ? "[redacted unsafe aggregate issue text]" : issue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const EXPECTED_PACKAGE_SCRIPT_NAMES = Object.keys(EXPECTED_PACKAGE_SCRIPTS);

function printTextReport(report: M075Report, writer: M075Writer): void {
  writer.write(`${report.command}: ${report.success ? "PASS" : "FAIL"}\n`);
  for (const check of report.checks) {
    writer.write(`${check.status.toUpperCase()} ${check.id}: ${check.message}\n`);
    for (const issue of check.issues) writer.write(`  - ${issue}\n`);
  }
}

export async function main(rawArgs = Bun.argv.slice(2), options: M075MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  try {
    const args = parseM075Args(rawArgs);
    if (args.help) {
      stdout.write(HELP_TEXT);
      return 0;
    }
    const report = await (options.evaluate ?? (() => evaluateM075Contract()))(args);
    if (args.json) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else printTextReport(report, stdout);
    return report.success ? 0 : 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const report: M075Report = {
      command: COMMAND_NAME,
      generatedAt: new Date().toISOString(),
      success: false,
      statusCode: "m075_invalid_arg",
      failedCheckIds: ["local-contracts.pass"],
      checks: [fail("local-contracts.pass", "CLI arguments are invalid.", [message])],
      observed: { childCount: CHILD_ORDER.length, passedChildCount: 0, failedChildCount: CHILD_ORDER.length, blockedChildCount: 0, packageScriptsChecked: [] },
      children: [],
      issues: [sanitizeIssue(message)],
    };
    stderr.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
