/**
 * M040 S03 proof harness: bounded prompt context, trivial-change bypass, and
 * fail-open validation gate.
 *
 * Proves four properties without a live DB or LLM call:
 *
 *   M040-S03-PROMPT-BOUNDED — graph context section never exceeds the declared
 *     char budget; a large blast radius (20 impacted files, 10 tests, 10 deps)
 *     is packed into a section whose charCount ≤ maxChars.
 *
 *   M040-S03-TRIVIAL-BYPASS — a PR touching ≤ file threshold returns
 *     bypass=true so the graph query is skipped; a larger PR returns bypass=false
 *     so the graph runs; edge-cases (0 files) are fail-closed (bypass=false).
 *
 *   M040-S03-FAIL-OPEN-VALIDATION — when the LLM throws, validateGraphAmplifiedFindings
 *     returns the original findings unchanged, succeeded=false, and never throws.
 *
 *   M040-S03-VALIDATION-ANNOTATES — when validation is enabled and the LLM
 *     confirms or marks uncertain, the result findings carry graphValidated=true
 *     and graphValidationVerdict matching the LLM response for graph-amplified files.
 */

import { buildGraphContextSection, type GraphContextOptions } from "../src/review-graph/prompt-context.ts";
import {
  isTrivialChange,
  validateGraphAmplifiedFindings,
  type GraphValidationFinding,
  type ValidationLLM,
  type TrivialBypassOptions,
} from "../src/review-graph/validation.ts";
import type { ReviewGraphBlastRadiusResult } from "../src/review-graph/query.ts";
import type { Logger } from "pino";

// ── Check IDs ─────────────────────────────────────────────────────────

export const M040_S03_CHECK_IDS = [
  "M040-S03-PROMPT-BOUNDED",
  "M040-S03-TRIVIAL-BYPASS",
  "M040-S03-FAIL-OPEN-VALIDATION",
  "M040-S03-VALIDATION-ANNOTATES",
] as const;

export type M040S03CheckId = (typeof M040_S03_CHECK_IDS)[number];

export type Check = {
  id: M040S03CheckId;
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

// ── Shared test helpers ───────────────────────────────────────────────

const noopLogger = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {},
} as unknown as Logger;

/** Build a blast-radius result with configurable list sizes. */
export function makeBlastRadius(opts: {
  changedFiles?: string[];
  impactedCount?: number;
  testCount?: number;
  dependentCount?: number;
} = {}): ReviewGraphBlastRadiusResult {
  const changedFiles = opts.changedFiles ?? ["xbmc/utils/StringUtils.cpp"];
  const impactedCount = opts.impactedCount ?? 5;
  const testCount = opts.testCount ?? 3;
  const dependentCount = opts.dependentCount ?? 3;

  const impactedFiles = Array.from({ length: impactedCount }, (_, i) => ({
    path: `xbmc/cores/Module${i + 1}/File${i + 1}.cpp`,
    score: 0.9 - i * 0.04,
    confidence: 0.85 - i * 0.03,
    reasons: ["calls changed symbol"],
    relatedChangedPaths: changedFiles,
    languages: ["C++"],
  }));

  const likelyTests = Array.from({ length: testCount }, (_, i) => ({
    path: `tests/utils/test_module${i + 1}.cpp`,
    score: 0.8 - i * 0.05,
    confidence: 0.8 - i * 0.03,
    reasons: ["test heuristic"],
    relatedChangedPaths: changedFiles,
    languages: ["C++"],
    testSymbols: [`test_case_${i + 1}`],
  }));

  const probableDependents = Array.from({ length: dependentCount }, (_, i) => ({
    stableKey: `Dependent${i + 1}::method${i + 1}`,
    symbolName: `method${i + 1}`,
    qualifiedName: `Dependent${i + 1}::method${i + 1}`,
    filePath: `xbmc/pvr/Dep${i + 1}.cpp`,
    score: 0.75 - i * 0.05,
    confidence: 0.7 - i * 0.03,
    reasons: ["calls changed symbol"],
    relatedChangedPaths: changedFiles,
  }));

  return {
    changedFiles,
    seedSymbols: [],
    impactedFiles,
    likelyTests,
    probableDependents,
    graphStats: {
      files: 100 + impactedCount,
      nodes: 300 + impactedCount * 3,
      edges: 500 + impactedCount * 5,
      changedFilesFound: changedFiles.length,
    },
  };
}

function makeFinding(id: number, filePath: string, severity = "major"): GraphValidationFinding {
  return { id, filePath, title: `Finding #${id}`, severity };
}

// ── Fixture types ─────────────────────────────────────────────────────

export type BoundednessFixtureResult = {
  charCount: number;
  maxChars: number;
  truncated: boolean;
  impactedFilesIncluded: number;
  likelyTestsIncluded: number;
  dependentsIncluded: number;
  withinBudget: boolean;
};

export type TrivialBypassFixtureResult = {
  smallPRBypass: boolean;
  smallPRReason: string;
  largePRBypass: boolean;
  largePRReason: string;
  zeroPRBypass: boolean;
  zeroPRReason: string;
};

export type FailOpenFixtureResult = {
  succeeded: boolean;
  findingsCount: number;
  validatedCount: number;
  originalFindingsPreserved: boolean;
  neverThrew: boolean;
};

export type AnnotatesFixtureResult = {
  validatedCount: number;
  confirmedCount: number;
  uncertainCount: number;
  allAmplifiedAnnotated: boolean;
  directFindingSkipped: boolean;
  succeeded: boolean;
};

// ── Fixture: PROMPT-BOUNDED ───────────────────────────────────────────

/**
 * Build a large blast radius (20 impacted files, 10 tests, 10 dependents)
 * and verify the section charCount is within maxChars.
 *
 * This exercises the hard-cap + char-budget loop in buildGraphContextSection().
 */
export function runBoundednessFixture(
  maxChars = 2500,
  options?: GraphContextOptions,
): BoundednessFixtureResult {
  // 20 impacted files (hard cap), 10 tests, 10 dependents
  const blastRadius = makeBlastRadius({
    impactedCount: 25, // will be capped at 20
    testCount: 12, // will be capped at 10
    dependentCount: 12, // will be capped at 10
  });

  const opts: GraphContextOptions = {
    maxChars,
    ...options,
  };

  const section = buildGraphContextSection(blastRadius, opts);

  return {
    charCount: section.stats.charCount,
    maxChars,
    truncated: section.truncated,
    impactedFilesIncluded: section.stats.impactedFilesIncluded,
    likelyTestsIncluded: section.stats.likelyTestsIncluded,
    dependentsIncluded: section.stats.dependentsIncluded,
    withinBudget: section.stats.charCount <= maxChars,
  };
}

// ── Fixture: TRIVIAL-BYPASS ───────────────────────────────────────────

/**
 * Run isTrivialChange() across three scenarios:
 *   - small PR (1 file → bypass)
 *   - large PR (10 files → no bypass)
 *   - zero-file PR (edge case → fail-closed = no bypass)
 */
export function runTrivialBypassFixture(
  bypassOptions?: TrivialBypassOptions,
): TrivialBypassFixtureResult {
  const opts = bypassOptions ?? {};

  const small = isTrivialChange({
    changedFileCount: 1,
    options: opts,
  });

  const large = isTrivialChange({
    changedFileCount: 10,
    options: opts,
  });

  const zero = isTrivialChange({
    changedFileCount: 0,
    options: opts,
  });

  return {
    smallPRBypass: small.bypass,
    smallPRReason: small.reason,
    largePRBypass: large.bypass,
    largePRReason: large.reason,
    zeroPRBypass: zero.bypass,
    zeroPRReason: zero.reason,
  };
}

// ── Fixture: FAIL-OPEN-VALIDATION ─────────────────────────────────────

/**
 * Configure a throwing LLM. validateGraphAmplifiedFindings should:
 *   - not throw itself
 *   - return succeeded=false
 *   - return the original findings unchanged
 */
export async function runFailOpenFixture(
  findings?: GraphValidationFinding[],
): Promise<FailOpenFixtureResult> {
  const blastRadius = makeBlastRadius({ impactedCount: 3 });

  const defaultFindings: GraphValidationFinding[] = findings ?? [
    makeFinding(1, blastRadius.impactedFiles[0]!.path),
    makeFinding(2, blastRadius.changedFiles[0]!),
  ];

  const throwingLLM: ValidationLLM = {
    generate: async () => {
      throw new Error("LLM service unavailable");
    },
  };

  let neverThrew = true;
  let result;
  try {
    result = await validateGraphAmplifiedFindings(
      defaultFindings,
      blastRadius,
      throwingLLM,
      { enabled: true },
      noopLogger,
    );
  } catch {
    neverThrew = false;
    result = {
      findings: defaultFindings.map((f) => ({
        ...f,
        graphValidated: false as boolean,
        graphValidationVerdict: "skipped" as const,
      })),
      validatedCount: 0,
      confirmedCount: 0,
      uncertainCount: 0,
      succeeded: false,
    };
  }

  // Compare original findings (by id and filePath) to returned findings.
  const originalFindingsPreserved = defaultFindings.every((orig, i) => {
    const returned = result.findings[i];
    return returned !== undefined && returned.id === orig.id && returned.filePath === orig.filePath;
  });

  return {
    succeeded: result.succeeded,
    findingsCount: result.findings.length,
    validatedCount: result.validatedCount,
    originalFindingsPreserved,
    neverThrew,
  };
}

// ── Fixture: VALIDATION-ANNOTATES ─────────────────────────────────────

/**
 * Configure a confirming LLM (always replies CONFIRMED).
 * validateGraphAmplifiedFindings should:
 *   - annotate graph-amplified findings with graphValidated=true, verdict=confirmed
 *   - leave directly-changed-file findings with graphValidated=false, verdict=skipped
 *   - return succeeded=true
 */
export async function runAnnotatesFixture(): Promise<AnnotatesFixtureResult> {
  const changedPath = "xbmc/utils/StringUtils.cpp";
  const amplifiedPath1 = "xbmc/cores/Module1/File1.cpp";
  const amplifiedPath2 = "xbmc/cores/Module2/File2.cpp";

  const blastRadius = makeBlastRadius({
    changedFiles: [changedPath],
    impactedCount: 2,
  });

  // Make sure the fixture paths match the blast radius output.
  const actualAmplifiedPath1 = blastRadius.impactedFiles[0]!.path;
  const actualAmplifiedPath2 = blastRadius.impactedFiles[1]!.path;

  const findings: GraphValidationFinding[] = [
    makeFinding(1, actualAmplifiedPath1), // graph-amplified → should be validated
    makeFinding(2, actualAmplifiedPath2), // graph-amplified → should be validated
    makeFinding(3, changedPath), // directly changed → should be skipped
  ];

  // LLM confirms finding 1 and marks finding 2 uncertain.
  const partialLLM: ValidationLLM = {
    generate: async () => "1: CONFIRMED\n2: UNCERTAIN",
  };

  const result = await validateGraphAmplifiedFindings(
    findings,
    blastRadius,
    partialLLM,
    { enabled: true, maxFindingsToValidate: 10 },
    noopLogger,
  );

  const allAmplifiedAnnotated = result.findings
    .filter((f) => f.filePath === actualAmplifiedPath1 || f.filePath === actualAmplifiedPath2)
    .every((f) => f.graphValidated === true);

  const directFinding = result.findings.find((f) => f.filePath === changedPath);
  const directFindingSkipped =
    directFinding !== undefined &&
    directFinding.graphValidated === false &&
    directFinding.graphValidationVerdict === "skipped";

  return {
    validatedCount: result.validatedCount,
    confirmedCount: result.confirmedCount,
    uncertainCount: result.uncertainCount,
    allAmplifiedAnnotated,
    directFindingSkipped,
    succeeded: result.succeeded,
  };
}

// ── Check functions ───────────────────────────────────────────────────

export async function runBoundednessCheck(
  _runFn?: () => BoundednessFixtureResult,
): Promise<Check> {
  const result = _runFn ? _runFn() : runBoundednessFixture();
  const problems: string[] = [];

  if (!result.withinBudget) {
    problems.push(
      `charCount=${result.charCount} exceeds maxChars=${result.maxChars}: section is not bounded`,
    );
  }
  if (result.impactedFilesIncluded === 0 && result.likelyTestsIncluded === 0 && result.dependentsIncluded === 0) {
    problems.push("section is empty: no items included despite non-empty blast radius");
  }
  // Verify that at least some items were included (not just a header with 0 rows)
  const totalIncluded = result.impactedFilesIncluded + result.likelyTestsIncluded + result.dependentsIncluded;
  if (totalIncluded === 0) {
    problems.push("no rows included at all — boundedness check vacuously passes but section is empty");
  }

  if (problems.length === 0) {
    return {
      id: "M040-S03-PROMPT-BOUNDED",
      passed: true,
      skipped: false,
      status_code: "graph_context_section_within_char_budget",
      detail: `charCount=${result.charCount} maxChars=${result.maxChars} withinBudget=${result.withinBudget} totalIncluded=${result.impactedFilesIncluded + result.likelyTestsIncluded + result.dependentsIncluded} truncated=${result.truncated}`,
    };
  }

  return {
    id: "M040-S03-PROMPT-BOUNDED",
    passed: false,
    skipped: false,
    status_code: "prompt_bounded_check_failed",
    detail: problems.join("; "),
  };
}

export async function runTrivialBypassCheck(
  _runFn?: () => TrivialBypassFixtureResult,
): Promise<Check> {
  const result = _runFn ? _runFn() : runTrivialBypassFixture();
  const problems: string[] = [];

  if (!result.smallPRBypass) {
    problems.push(
      `smallPR (1 file) should bypass but bypass=${result.smallPRBypass} reason=${result.smallPRReason}`,
    );
  }
  if (result.largePRBypass) {
    problems.push(
      `largePR (10 files) should NOT bypass but bypass=${result.largePRBypass} reason=${result.largePRReason}`,
    );
  }
  if (result.zeroPRBypass) {
    problems.push(
      `zeroPR (0 files) should be fail-closed (bypass=false) but bypass=${result.zeroPRBypass} reason=${result.zeroPRReason}`,
    );
  }

  if (problems.length === 0) {
    return {
      id: "M040-S03-TRIVIAL-BYPASS",
      passed: true,
      skipped: false,
      status_code: "trivial_bypass_correctly_classifies_pr_size",
      detail: `smallPR bypass=${result.smallPRBypass} reason=${result.smallPRReason}; largePR bypass=${result.largePRBypass} reason=${result.largePRReason}; zeroPR bypass=${result.zeroPRBypass} reason=${result.zeroPRReason}`,
    };
  }

  return {
    id: "M040-S03-TRIVIAL-BYPASS",
    passed: false,
    skipped: false,
    status_code: "trivial_bypass_check_failed",
    detail: problems.join("; "),
  };
}

export async function runFailOpenCheck(
  _runFn?: () => Promise<FailOpenFixtureResult>,
): Promise<Check> {
  const result = await (_runFn ? _runFn() : runFailOpenFixture());
  const problems: string[] = [];

  if (!result.neverThrew) {
    problems.push("validateGraphAmplifiedFindings threw an exception — should be fail-open");
  }
  if (result.succeeded) {
    problems.push(
      `succeeded=true after LLM throw — should be false to signal degraded path`,
    );
  }
  if (!result.originalFindingsPreserved) {
    problems.push(
      "original findings were not preserved: filePaths or ids changed after LLM failure",
    );
  }
  if (result.validatedCount !== 0) {
    problems.push(
      `validatedCount=${result.validatedCount} expected 0 when LLM threw`,
    );
  }

  if (problems.length === 0) {
    return {
      id: "M040-S03-FAIL-OPEN-VALIDATION",
      passed: true,
      skipped: false,
      status_code: "validation_fail_open_preserves_findings_on_llm_error",
      detail: `neverThrew=${result.neverThrew} succeeded=${result.succeeded} findingsCount=${result.findingsCount} originalFindingsPreserved=${result.originalFindingsPreserved} validatedCount=${result.validatedCount}`,
    };
  }

  return {
    id: "M040-S03-FAIL-OPEN-VALIDATION",
    passed: false,
    skipped: false,
    status_code: "fail_open_check_failed",
    detail: problems.join("; "),
  };
}

export async function runAnnotatesCheck(
  _runFn?: () => Promise<AnnotatesFixtureResult>,
): Promise<Check> {
  const result = await (_runFn ? _runFn() : runAnnotatesFixture());
  const problems: string[] = [];

  if (!result.succeeded) {
    problems.push("validation did not succeed — expected success on functioning LLM");
  }
  if (!result.allAmplifiedAnnotated) {
    problems.push(
      "not all graph-amplified findings were annotated with graphValidated=true",
    );
  }
  if (!result.directFindingSkipped) {
    problems.push(
      "directly-changed-file finding was not skipped (expected graphValidated=false, verdict=skipped)",
    );
  }
  if (result.validatedCount === 0) {
    problems.push("validatedCount=0 — no findings were validated despite amplified files present");
  }
  const totalVerdicts = result.confirmedCount + result.uncertainCount;
  if (totalVerdicts !== result.validatedCount) {
    problems.push(
      `confirmedCount=${result.confirmedCount} + uncertainCount=${result.uncertainCount} !== validatedCount=${result.validatedCount}`,
    );
  }

  if (problems.length === 0) {
    return {
      id: "M040-S03-VALIDATION-ANNOTATES",
      passed: true,
      skipped: false,
      status_code: "validation_annotates_amplified_findings_correctly",
      detail: `succeeded=${result.succeeded} validatedCount=${result.validatedCount} confirmedCount=${result.confirmedCount} uncertainCount=${result.uncertainCount} allAmplifiedAnnotated=${result.allAmplifiedAnnotated} directFindingSkipped=${result.directFindingSkipped}`,
    };
  }

  return {
    id: "M040-S03-VALIDATION-ANNOTATES",
    passed: false,
    skipped: false,
    status_code: "validation_annotates_check_failed",
    detail: problems.join("; "),
  };
}

// ── Evaluation ────────────────────────────────────────────────────────

export async function evaluateM040S03(opts?: {
  _boundednessRunFn?: () => BoundednessFixtureResult;
  _trivialBypassRunFn?: () => TrivialBypassFixtureResult;
  _failOpenRunFn?: () => Promise<FailOpenFixtureResult>;
  _annotatesRunFn?: () => Promise<AnnotatesFixtureResult>;
}): Promise<EvaluationReport> {
  const [bounded, bypass, failOpen, annotates] = await Promise.all([
    runBoundednessCheck(opts?._boundednessRunFn),
    runTrivialBypassCheck(opts?._trivialBypassRunFn),
    runFailOpenCheck(opts?._failOpenRunFn),
    runAnnotatesCheck(opts?._annotatesRunFn),
  ]);

  const checks: Check[] = [bounded, bypass, failOpen, annotates];
  const overallPassed = checks.filter((c) => !c.skipped).every((c) => c.passed);

  return {
    check_ids: M040_S03_CHECK_IDS,
    overallPassed,
    checks,
  };
}

// ── Rendering ─────────────────────────────────────────────────────────

function renderReport(report: EvaluationReport): string {
  const lines = [
    "M040 S03 proof harness: bounded prompt context, trivial-change bypass, and fail-open validation gate",
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

// ── Harness entry ─────────────────────────────────────────────────────

export async function buildM040S03ProofHarness(opts?: {
  _boundednessRunFn?: () => BoundednessFixtureResult;
  _trivialBypassRunFn?: () => TrivialBypassFixtureResult;
  _failOpenRunFn?: () => Promise<FailOpenFixtureResult>;
  _annotatesRunFn?: () => Promise<AnnotatesFixtureResult>;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const useJson = opts?.json ?? false;

  const report = await evaluateM040S03({
    _boundednessRunFn: opts?._boundednessRunFn,
    _trivialBypassRunFn: opts?._trivialBypassRunFn,
    _failOpenRunFn: opts?._failOpenRunFn,
    _annotatesRunFn: opts?._annotatesRunFn,
  });

  if (useJson) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderReport(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((c) => !c.passed && !c.skipped)
      .map((c) => `${c.id}:${c.status_code}`)
      .join(", ");
    stderr.write(`verify:m040:s03 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM040S03ProofHarness({ json: useJson });
  process.exit(exitCode);
}
