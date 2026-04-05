import pino from "pino";
import { buildReviewPrompt } from "../src/execution/review-prompt.ts";
import { formatReviewDetailsSummary } from "../src/lib/review-utils.ts";
import type { StructuralImpactPayload } from "../src/structural-impact/types.ts";

export const M038_S02_CHECK_IDS = [
  "M038-S02-CPP-REVIEW-DETAILS-STRUCTURAL-IMPACT",
  "M038-S02-PYTHON-BREAKING-CHANGE-EVIDENCE",
] as const;

export type M038S02CheckId = (typeof M038_S02_CHECK_IDS)[number];

export type M038S02ScenarioId = "cpp" | "python";

export type M038S02ScenarioFixture = {
  id: M038S02ScenarioId;
  language: "C++" | "Python";
  title: string;
  changedFiles: string[];
  structuralImpact: StructuralImpactPayload;
  expected: {
    changedSymbol: string;
    callerPath: string;
    impactedFilePath: string;
    likelyTestPath: string;
    evidencePath: string;
    breakingChangePhrase: string;
    renderedCountsLine: string;
  };
};

export type M038S02ScenarioOutput = {
  id: M038S02ScenarioId;
  language: "C++" | "Python";
  promptIncludesStructuralSection: boolean;
  reviewDetailsIncludesStructuralSection: boolean;
  reviewDetailsIncludesChangedSymbol: boolean;
  reviewDetailsIncludesCaller: boolean;
  reviewDetailsIncludesImpactedFile: boolean;
  reviewDetailsIncludesLikelyTest: boolean;
  reviewDetailsIncludesEvidencePath: boolean;
  reviewDetailsIncludesRenderedCounts: boolean;
  promptUsesStructuralBreakingChangeWording: boolean;
  promptStructuralImpactHeadingCount: number;
  reviewDetailsStructuralImpactHeadingCount: number;
};

export type M038S02Check = {
  id: M038S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type M038S02EvaluationReport = {
  check_ids: readonly string[];
  overallPassed: boolean;
  checks: M038S02Check[];
  scenarios: M038S02ScenarioOutput[];
};

const silentLogger = pino({ level: "silent" });

function makeCppFixture(): M038S02ScenarioFixture {
  return {
    id: "cpp",
    language: "C++",
    title: "C++ review renders bounded structural impact evidence in Review Details",
    changedFiles: ["xbmc/interfaces/json-rpc/PlayerOperations.cpp"],
    structuralImpact: {
      status: "ok",
      changedFiles: ["xbmc/interfaces/json-rpc/PlayerOperations.cpp"],
      seedSymbols: [
        {
          stableKey: "CPlayerOperations::SetSubtitleDelay",
          symbolName: "SetSubtitleDelay",
          qualifiedName: "CPlayerOperations::SetSubtitleDelay",
          filePath: "xbmc/interfaces/json-rpc/PlayerOperations.cpp",
        },
      ],
      probableCallers: [
        {
          stableKey: "CApplicationPlayer::SetSubtitleDelay",
          symbolName: "SetSubtitleDelay",
          qualifiedName: "CApplicationPlayer::SetSubtitleDelay",
          filePath: "xbmc/application/ApplicationPlayer.cpp",
          score: 0.997,
          confidence: 1,
          reasons: ["direct graph edge from changed symbol"],
        },
        {
          stableKey: "CVideoPlayer::SetSubTitleDelay",
          symbolName: "SetSubTitleDelay",
          qualifiedName: "CVideoPlayer::SetSubTitleDelay",
          filePath: "xbmc/cores/VideoPlayer/VideoPlayer.cpp",
          score: 0.941,
          confidence: 0.96,
          reasons: ["probable caller in playback path"],
        },
      ],
      impactedFiles: [
        {
          path: "xbmc/application/ApplicationPlayer.cpp",
          score: 0.997,
          confidence: 1,
          reasons: ["contains direct caller of changed symbol"],
          languages: ["C++"],
        },
        {
          path: "xbmc/cores/VideoPlayer/VideoPlayer.cpp",
          score: 0.941,
          confidence: 0.96,
          reasons: ["playback path depends on subtitle delay API"],
          languages: ["C++"],
        },
      ],
      likelyTests: [
        {
          path: "xbmc/interfaces/json-rpc/test/TestPlayerOperations.cpp",
          score: 0.81,
          confidence: 0.84,
          reasons: ["covers PlayerOperations subtitle delay RPC"],
          testSymbols: ["TestSetSubtitleDelay"],
        },
      ],
      graphStats: {
        changedFilesRequested: 1,
        changedFilesFound: 1,
        files: 5,
        nodes: 18,
        edges: 24,
      },
      canonicalEvidence: [
        {
          filePath: "xbmc/application/ApplicationPlayer.cpp",
          startLine: 440,
          endLine: 446,
          language: "C++",
          chunkType: "method",
          symbolName: "CApplicationPlayer::SetSubtitleDelay",
          chunkText: "void CApplicationPlayer::SetSubtitleDelay(float delay) { m_pPlayer->SetSubtitleDelay(delay); }",
          distance: 0.08,
          commitSha: "head1234",
          canonicalRef: "master",
        },
      ],
      degradations: [],
    },
    expected: {
      changedSymbol: "CPlayerOperations::SetSubtitleDelay",
      callerPath: "xbmc/application/ApplicationPlayer.cpp",
      impactedFilePath: "xbmc/cores/VideoPlayer/VideoPlayer.cpp",
      likelyTestPath: "xbmc/interfaces/json-rpc/test/TestPlayerOperations.cpp",
      evidencePath: "xbmc/application/ApplicationPlayer.cpp:440-446",
      breakingChangePhrase: "You may strengthen breaking-change wording when probable callers, impacted files, or likely tests are present (callers: 2, impacted files: 2, tests: 1).",
      renderedCountsLine: "- Structural Impact rendered: callers 2/2; files 2/2; tests 1/1; unchanged evidence 1/1",
    },
  };
}

function makePythonFixture(): M038S02ScenarioFixture {
  return {
    id: "python",
    language: "Python",
    title: "Python review strengthens breaking-change wording from structural evidence",
    changedFiles: ["xbmc/interfaces/jsonrpc/media.py"],
    structuralImpact: {
      status: "ok",
      changedFiles: ["xbmc/interfaces/jsonrpc/media.py"],
      seedSymbols: [
        {
          stableKey: "media.remove_library_source",
          symbolName: "remove_library_source",
          qualifiedName: "media.remove_library_source",
          filePath: "xbmc/interfaces/jsonrpc/media.py",
        },
      ],
      probableCallers: [
        {
          stableKey: "sources.handle_remove_source",
          symbolName: "handle_remove_source",
          qualifiedName: "sources.handle_remove_source",
          filePath: "xbmc/services/sources.py",
          score: 0.991,
          confidence: 1,
          reasons: ["direct Python call edge"],
        },
      ],
      impactedFiles: [
        {
          path: "xbmc/services/sources.py",
          score: 0.991,
          confidence: 1,
          reasons: ["calls remove_library_source"],
          languages: ["Python"],
        },
        {
          path: "xbmc/plugins/library_cleanup.py",
          score: 0.874,
          confidence: 0.91,
          reasons: ["cleanup workflow imports changed helper"],
          languages: ["Python"],
        },
      ],
      likelyTests: [
        {
          path: "xbmc/interfaces/jsonrpc/tests/test_media.py",
          score: 0.77,
          confidence: 0.8,
          reasons: ["exercise JSON-RPC media source removal"],
          testSymbols: ["test_remove_library_source"],
        },
      ],
      graphStats: {
        changedFilesRequested: 1,
        changedFilesFound: 1,
        files: 4,
        nodes: 12,
        edges: 15,
      },
      canonicalEvidence: [
        {
          filePath: "xbmc/services/sources.py",
          startLine: 88,
          endLine: 94,
          language: "Python",
          chunkType: "function",
          symbolName: "handle_remove_source",
          chunkText: "def handle_remove_source(source_id):\n    return remove_library_source(source_id)",
          distance: 0.05,
          commitSha: "head5678",
          canonicalRef: "master",
        },
      ],
      degradations: [],
    },
    expected: {
      changedSymbol: "media.remove_library_source",
      callerPath: "xbmc/services/sources.py",
      impactedFilePath: "xbmc/plugins/library_cleanup.py",
      likelyTestPath: "xbmc/interfaces/jsonrpc/tests/test_media.py",
      evidencePath: "xbmc/services/sources.py:88-94",
      breakingChangePhrase: "You may strengthen breaking-change wording when probable callers, impacted files, or likely tests are present (callers: 1, impacted files: 2, tests: 1).",
      renderedCountsLine: "- Structural Impact rendered: callers 1/1; files 2/2; tests 1/1; unchanged evidence 1/1",
    },
  };
}

export function createM038S02Fixtures(): M038S02ScenarioFixture[] {
  return [makeCppFixture(), makePythonFixture()];
}

export function renderM038S02Scenario(fixture: M038S02ScenarioFixture): {
  fixture: M038S02ScenarioFixture;
  prompt: string;
  reviewDetails: string;
  output: M038S02ScenarioOutput;
} {
  const prompt = buildReviewPrompt({
    owner: "xbmc",
    repo: "xbmc",
    prNumber: fixture.id === "cpp" ? 3802 : 3803,
    prTitle: fixture.title,
    prBody: fixture.title,
    prAuthor: "kodiai-bot",
    baseBranch: "master",
    headBranch: fixture.id === "cpp" ? "feat/cpp-subtitle-delay" : "feat/python-remove-source",
    changedFiles: fixture.changedFiles,
    filesByLanguage: { [fixture.language]: fixture.changedFiles },
    structuralImpact: fixture.structuralImpact,
  });

  const reviewDetails = formatReviewDetailsSummary({
    reviewOutputKey: `m038-s02-${fixture.id}`,
    filesReviewed: fixture.changedFiles.length,
    linesAdded: fixture.id === "cpp" ? 27 : 19,
    linesRemoved: fixture.id === "cpp" ? 11 : 8,
    findingCounts: { critical: 0, major: 1, medium: 0, minor: 0 },
    profileSelection: {
      selectedProfile: "balanced",
      source: "auto",
      linesChanged: fixture.id === "cpp" ? 38 : 27,
    },
    authorTier: "regular",
    structuralImpact: fixture.structuralImpact,
  });

  const output: M038S02ScenarioOutput = {
    id: fixture.id,
    language: fixture.language,
    promptIncludesStructuralSection: prompt.includes("## Structural Impact Evidence"),
    reviewDetailsIncludesStructuralSection: reviewDetails.includes("### Structural Impact"),
    reviewDetailsIncludesChangedSymbol: reviewDetails.includes(fixture.expected.changedSymbol),
    reviewDetailsIncludesCaller: reviewDetails.includes(fixture.expected.callerPath),
    reviewDetailsIncludesImpactedFile: reviewDetails.includes(fixture.expected.impactedFilePath),
    reviewDetailsIncludesLikelyTest: reviewDetails.includes(fixture.expected.likelyTestPath),
    reviewDetailsIncludesEvidencePath: reviewDetails.includes(fixture.expected.evidencePath),
    reviewDetailsIncludesRenderedCounts: reviewDetails.includes(fixture.expected.renderedCountsLine),
    promptUsesStructuralBreakingChangeWording: prompt.includes(fixture.expected.breakingChangePhrase),
    promptStructuralImpactHeadingCount: prompt.split("## Structural Impact Evidence").length - 1,
    reviewDetailsStructuralImpactHeadingCount: reviewDetails.split("### Structural Impact").length - 1,
  };

  return { fixture, prompt, reviewDetails, output };
}

export function evaluateM038S02Checks(
  scenarios: M038S02ScenarioOutput[],
): M038S02EvaluationReport {
  const cpp = scenarios.find((scenario) => scenario.id === "cpp");
  const python = scenarios.find((scenario) => scenario.id === "python");

  const checks: M038S02Check[] = [
    {
      id: "M038-S02-CPP-REVIEW-DETAILS-STRUCTURAL-IMPACT",
      passed: Boolean(
        cpp
          && cpp.promptIncludesStructuralSection
          && cpp.reviewDetailsIncludesStructuralSection
          && cpp.reviewDetailsIncludesChangedSymbol
          && cpp.reviewDetailsIncludesCaller
          && cpp.reviewDetailsIncludesImpactedFile
          && cpp.reviewDetailsIncludesLikelyTest
          && cpp.reviewDetailsIncludesEvidencePath
          && cpp.reviewDetailsIncludesRenderedCounts
          && cpp.promptStructuralImpactHeadingCount === 1
          && cpp.reviewDetailsStructuralImpactHeadingCount === 1,
      ),
      skipped: false,
      status_code: cpp
        && cpp.promptIncludesStructuralSection
        && cpp.reviewDetailsIncludesStructuralSection
        && cpp.reviewDetailsIncludesChangedSymbol
        && cpp.reviewDetailsIncludesCaller
        && cpp.reviewDetailsIncludesImpactedFile
        && cpp.reviewDetailsIncludesLikelyTest
        && cpp.reviewDetailsIncludesEvidencePath
        && cpp.reviewDetailsIncludesRenderedCounts
        && cpp.promptStructuralImpactHeadingCount === 1
        && cpp.reviewDetailsStructuralImpactHeadingCount === 1
        ? "cpp_review_details_structural_impact_rendered"
        : "cpp_review_details_structural_impact_missing",
      detail: cpp
        ? `promptSection=${cpp.promptIncludesStructuralSection}; reviewDetailsSection=${cpp.reviewDetailsIncludesStructuralSection}; changedSymbol=${cpp.reviewDetailsIncludesChangedSymbol}; caller=${cpp.reviewDetailsIncludesCaller}; impactedFile=${cpp.reviewDetailsIncludesImpactedFile}; likelyTest=${cpp.reviewDetailsIncludesLikelyTest}; evidencePath=${cpp.reviewDetailsIncludesEvidencePath}; renderedCounts=${cpp.reviewDetailsIncludesRenderedCounts}; promptHeadingCount=${cpp.promptStructuralImpactHeadingCount}; reviewDetailsHeadingCount=${cpp.reviewDetailsStructuralImpactHeadingCount}`
        : "cpp scenario missing",
    },
    {
      id: "M038-S02-PYTHON-BREAKING-CHANGE-EVIDENCE",
      passed: Boolean(
        python
          && python.promptIncludesStructuralSection
          && python.reviewDetailsIncludesStructuralSection
          && python.promptUsesStructuralBreakingChangeWording
          && python.reviewDetailsIncludesCaller
          && python.reviewDetailsIncludesImpactedFile
          && python.reviewDetailsIncludesRenderedCounts
          && python.promptStructuralImpactHeadingCount === 1
          && python.reviewDetailsStructuralImpactHeadingCount === 1,
      ),
      skipped: false,
      status_code: python
        && python.promptIncludesStructuralSection
        && python.reviewDetailsIncludesStructuralSection
        && python.promptUsesStructuralBreakingChangeWording
        && python.reviewDetailsIncludesCaller
        && python.reviewDetailsIncludesImpactedFile
        && python.reviewDetailsIncludesRenderedCounts
        && python.promptStructuralImpactHeadingCount === 1
        && python.reviewDetailsStructuralImpactHeadingCount === 1
        ? "python_breaking_change_structural_evidence_rendered"
        : "python_breaking_change_structural_evidence_missing",
      detail: python
        ? `promptSection=${python.promptIncludesStructuralSection}; reviewDetailsSection=${python.reviewDetailsIncludesStructuralSection}; structuralBreakingChangeWording=${python.promptUsesStructuralBreakingChangeWording}; caller=${python.reviewDetailsIncludesCaller}; impactedFile=${python.reviewDetailsIncludesImpactedFile}; renderedCounts=${python.reviewDetailsIncludesRenderedCounts}; promptHeadingCount=${python.promptStructuralImpactHeadingCount}; reviewDetailsHeadingCount=${python.reviewDetailsStructuralImpactHeadingCount}`
        : "python scenario missing",
    },
  ];

  return {
    check_ids: M038_S02_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed),
    checks,
    scenarios,
  };
}

export function renderM038S02Report(report: M038S02EvaluationReport): {
  human: string;
  json: string;
} {
  const humanLines = [
    "M038 S02 structural impact rendering verifier",
    `overallPassed=${report.overallPassed}`,
    "",
    "Checks:",
    ...report.checks.map((check) => `- ${check.id}: ${check.passed ? "PASS" : "FAIL"} (${check.status_code})${check.detail ? ` — ${check.detail}` : ""}`),
    "",
    "Scenarios:",
    ...report.scenarios.map((scenario) => `- ${scenario.id}/${scenario.language}: promptSection=${scenario.promptIncludesStructuralSection}; reviewDetailsSection=${scenario.reviewDetailsIncludesStructuralSection}; breakingChangeWording=${scenario.promptUsesStructuralBreakingChangeWording}; reviewDetailsCounts=${scenario.reviewDetailsIncludesRenderedCounts}`),
  ];

  return {
    human: `${humanLines.join("\n")}\n`,
    json: `${JSON.stringify(report, null, 2)}\n`,
  };
}

export async function buildM038S02ProofHarness(opts?: {
  json?: boolean;
  stdout?: Pick<typeof process.stdout, "write">;
  stderr?: Pick<typeof process.stderr, "write">;
}): Promise<{ exitCode: number; report: M038S02EvaluationReport }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const scenarios = createM038S02Fixtures().map((fixture) => renderM038S02Scenario(fixture).output);
  const report = evaluateM038S02Checks(scenarios);
  const rendered = renderM038S02Report(report);

  stdout.write(opts?.json ? rendered.json : rendered.human);

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed)
      .map((check) => check.status_code)
      .join(",");
    stderr.write(`verify:m038:s02 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export async function main(argv = process.argv.slice(2), io?: {
  stdout?: Pick<typeof process.stdout, "write">;
  stderr?: Pick<typeof process.stderr, "write">;
}): Promise<number> {
  const useJson = argv.includes("--json");
  const { exitCode } = await buildM038S02ProofHarness({
    json: useJson,
    stdout: io?.stdout,
    stderr: io?.stderr,
  });
  return exitCode;
}

if (import.meta.main) {
  const exitCode = await main();
  silentLogger.flush?.();
  process.exit(exitCode);
}
