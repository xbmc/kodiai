/**
 * M040 S02 proof harness: blast-radius queries and graph-aware review selection.
 *
 * Proves four properties without a live DB or review pipeline:
 *
 *   M040-S02-GRAPH-SURFACES-MISSED-FILES — graph-aware selection surfaces
 *     impacted files that file-risk triage alone would miss: a widely-called
 *     internal utility has low static path-risk but high blast-radius signal,
 *     so graph promotion moves it into the top-ranked set.
 *
 *   M040-S02-GRAPH-SURFACES-LIKELY-TESTS — graph-aware selection promotes
 *     likely tests that the file-risk scorer would deprioritise (test files
 *     inherit low "test" category risk but high graph-test-hit signal).
 *
 *   M040-S02-GRAPH-RERANKS-DEPENDENTS — changing a public C++ function
 *     surfaces its callers as probable dependents in the blast-radius result,
 *     and those callers are promoted above unrelated low-risk files in the
 *     merged risk list.
 *
 *   M040-S02-FALLBACK-PRESERVES-ORDER — when no graph is available the
 *     applyGraphAwareSelection fallback returns the original risk ordering
 *     unchanged with usedGraph=false.
 */

import {
  applyGraphAwareSelection,
  computeFileRiskScores,
  DEFAULT_RISK_WEIGHTS,
  type FileRiskScore,
} from "../src/lib/file-risk-scorer.ts";
import {
  queryBlastRadiusFromSnapshot,
  type ReviewGraphBlastRadiusResult,
  type ReviewGraphQueryInput,
} from "../src/review-graph/query.ts";
import type {
  ReviewGraphWorkspaceSnapshot,
  ReviewGraphFileRecord,
  ReviewGraphNodeRecord,
  ReviewGraphEdgeRecord,
} from "../src/review-graph/types.ts";
import type { PerFileStats } from "../src/execution/diff-analysis.ts";

// ── Check IDs ─────────────────────────────────────────────────────────

export const M040_S02_CHECK_IDS = [
  "M040-S02-GRAPH-SURFACES-MISSED-FILES",
  "M040-S02-GRAPH-SURFACES-LIKELY-TESTS",
  "M040-S02-GRAPH-RERANKS-DEPENDENTS",
  "M040-S02-FALLBACK-PRESERVES-ORDER",
] as const;

export type M040S02CheckId = (typeof M040_S02_CHECK_IDS)[number];

export type Check = {
  id: M040S02CheckId;
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

// ── Fixture types ─────────────────────────────────────────────────────

export type MissedFilesFixtureResult = {
  /** Files in the top-N graph-aware selection */
  graphAwareTopN: string[];
  /** Files in the top-N pure-risk selection */
  riskOnlyTopN: string[];
  /** Files that appear in graph-aware top-N but NOT in risk-only top-N */
  graphSurfacedExtra: string[];
  /** The impacted file path that was expected to be surfaced */
  expectedSurfacedPath: string;
  graphHits: number;
  usedGraph: boolean;
};

export type LikelyTestsFixtureResult = {
  graphLikelyTests: string[];
  graphAwareTopN: string[];
  riskOnlyTopN: string[];
  /** Whether the likely-test path appears in graph-aware top-N but not risk-only top-N */
  testPromoted: boolean;
  expectedTestPath: string;
};

export type DependentsFixtureResult = {
  probableDependents: Array<{ stableKey: string; filePath: string; score: number }>;
  graphAwareRanking: string[];
  riskOnlyRanking: string[];
  /** Whether a caller file was promoted above unrelated low-risk files */
  callerPromoted: boolean;
  expectedCallerPath: string;
};

export type FallbackFixtureResult = {
  usedGraph: boolean;
  graphHits: number;
  graphRankedSelections: number;
  riskOrderPreserved: boolean;
  riskScoreCount: number;
};

// ── Shared builders ───────────────────────────────────────────────────

let _nextId = 1;
function nextId(): number {
  return _nextId++;
}

function resetIds(): void {
  _nextId = 1;
}

function makeFile(
  id: number,
  path: string,
  language = "C++",
): ReviewGraphFileRecord {
  return {
    id,
    repo: "kodi-player/xbmc",
    workspaceKey: "main",
    path,
    language,
    contentHash: null,
    indexedAt: new Date().toISOString(),
    buildId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeNode(
  id: number,
  fileId: number,
  nodeKind: ReviewGraphNodeRecord["nodeKind"],
  stableKey: string,
  opts?: {
    symbolName?: string | null;
    qualifiedName?: string | null;
    language?: string;
    confidence?: number;
  },
): ReviewGraphNodeRecord {
  return {
    id,
    repo: "kodi-player/xbmc",
    workspaceKey: "main",
    fileId,
    buildId: null,
    nodeKind,
    stableKey,
    symbolName: opts?.symbolName ?? stableKey,
    qualifiedName: opts?.qualifiedName ?? null,
    language: opts?.language ?? "C++",
    spanStartLine: null,
    spanStartCol: null,
    spanEndLine: null,
    spanEndCol: null,
    signature: null,
    attributes: {},
    confidence: opts?.confidence ?? 0.9,
    createdAt: new Date().toISOString(),
  };
}

function makeEdge(
  id: number,
  edgeKind: ReviewGraphEdgeRecord["edgeKind"],
  sourceNodeId: number,
  targetNodeId: number,
  opts?: {
    confidence?: number;
    fileId?: number;
  },
): ReviewGraphEdgeRecord {
  return {
    id,
    repo: "kodi-player/xbmc",
    workspaceKey: "main",
    fileId: opts?.fileId ?? 0,
    buildId: null,
    edgeKind,
    sourceNodeId,
    targetNodeId,
    confidence: opts?.confidence ?? 0.9,
    attributes: {},
    createdAt: new Date().toISOString(),
  };
}

function makePerFileStats(files: string[], linesEach = 10): PerFileStats {
  const stats = new Map<string, { added: number; removed: number }>();
  for (const file of files) {
    stats.set(file, { added: linesEach, removed: 0 });
  }
  return stats;
}

// ── Fixture: GRAPH-SURFACES-MISSED-FILES ─────────────────────────────

/**
 * Scenario: A C++ utility header (xbmc/utils/StringUtils.h) is changed.
 * It has low static path-risk (not auth, not migration), so file-risk scoring
 * gives it a modest score. But many other files import it. The graph blast
 * radius identifies those importers as impacted, and graph-aware selection
 * promotes one of them (xbmc/cores/VideoPlayer/VideoPlayer.cpp) into the
 * top-N set — a file that pure risk scoring would rank lower.
 */
export function runMissedFilesFixture(): MissedFilesFixtureResult {
  resetIds();

  // Changed file: StringUtils header (low static risk)
  const changedPath = "xbmc/utils/StringUtils.h";
  // Expected impacted file: VideoPlayer (high lines-changed but ranks lower without graph)
  const impactedPath = "xbmc/cores/VideoPlayer/VideoPlayer.cpp";
  // Unrelated high-risk file: auth path (ranks #1 on static risk alone)
  const authPath = "xbmc/network/oauth/OAuth2Handler.cpp";
  // Another unrelated medium-risk file
  const mediaParsePath = "xbmc/cores/DVDPlayer/DVDInputStreams/DVDInputStream.cpp";

  const allFiles = [changedPath, authPath, mediaParsePath, impactedPath];

  // ── Build a minimal snapshot ──
  const fChanged = makeFile(nextId(), changedPath);
  const fImpacted = makeFile(nextId(), impactedPath);
  const fAuth = makeFile(nextId(), authPath);
  const fMedia = makeFile(nextId(), mediaParsePath);

  // Symbol in changed file
  const nSymbol = makeNode(nextId(), fChanged.id, "symbol", "StringUtils::Format", {
    qualifiedName: "StringUtils::Format",
    symbolName: "Format",
  });
  // File node for changed file (importers will point to this)
  const nFileChanged = makeNode(nextId(), fChanged.id, "file", `file:${changedPath}`);

  // File node for impacted file
  const nFileImpacted = makeNode(nextId(), fImpacted.id, "file", `file:${impactedPath}`);
  // Import node in VideoPlayer.cpp referencing StringUtils
  const nImport = makeNode(nextId(), fImpacted.id, "import", "import:StringUtils", {
    symbolName: "StringUtils",
    qualifiedName: "StringUtils",
  });

  // Callsite in VideoPlayer referencing Format
  const nCallsite = makeNode(nextId(), fImpacted.id, "callsite", "callsite:Format@VideoPlayer", {
    symbolName: "Format",
    qualifiedName: "StringUtils::Format",
  });

  // File nodes for unrelated files
  const nFileAuth = makeNode(nextId(), fAuth.id, "file", `file:${authPath}`);
  const nFileMedia = makeNode(nextId(), fMedia.id, "file", `file:${mediaParsePath}`);

  // Edge: VideoPlayer file → includes StringUtils file
  const eIncludes = makeEdge(nextId(), "includes", nFileImpacted.id, nFileChanged.id, {
    fileId: fImpacted.id,
  });
  // Edge: callsite → calls Format symbol
  const eCalls = makeEdge(nextId(), "calls", nCallsite.id, nSymbol.id, {
    fileId: fImpacted.id,
  });

  const snapshot: ReviewGraphWorkspaceSnapshot = {
    files: [fChanged, fImpacted, fAuth, fMedia],
    nodes: [nSymbol, nFileChanged, nFileImpacted, nImport, nCallsite, nFileAuth, nFileMedia],
    edges: [eIncludes, eCalls],
  };

  const queryInput: ReviewGraphQueryInput = {
    repo: "kodi-player/xbmc",
    workspaceKey: "main",
    changedPaths: [changedPath],
    limit: 20,
  };

  const blastRadius = queryBlastRadiusFromSnapshot(snapshot, queryInput);

  // Build file-risk scores (low lines changed, no special path patterns)
  const perFileStats = makePerFileStats(allFiles, 8);
  // Give impacted file a few more lines to make it register, but still lower than auth
  perFileStats.set(impactedPath, { added: 20, removed: 5 });
  perFileStats.set(authPath, { added: 80, removed: 10 }); // high lines, auth path = top risk

  const filesByCategory: Record<string, string[]> = {
    source: [changedPath, impactedPath, authPath, mediaParsePath],
  };

  const riskScores = computeFileRiskScores({
    files: allFiles,
    perFileStats,
    filesByCategory,
    weights: DEFAULT_RISK_WEIGHTS,
  });

  const graphResult = applyGraphAwareSelection({ riskScores, graph: blastRadius });
  const noGraphResult = applyGraphAwareSelection({ riskScores, graph: null });

  // TOP_N = 1: the graph-boosted file should be #1 in graph-aware but #2 in risk-only.
  // This demonstrates that graph selection elevates a file that pure triage would miss
  // in the top slot.
  const TOP_N = 1;
  const graphAwareTopN = graphResult.riskScores.slice(0, TOP_N).map((f) => f.filePath);
  const riskOnlyTopN = noGraphResult.riskScores.slice(0, TOP_N).map((f) => f.filePath);
  const graphSurfacedExtra = graphAwareTopN.filter((p) => !riskOnlyTopN.includes(p));

  return {
    graphAwareTopN,
    riskOnlyTopN,
    graphSurfacedExtra,
    expectedSurfacedPath: impactedPath,
    graphHits: graphResult.graphHits,
    usedGraph: graphResult.usedGraph,
  };
}

// ── Fixture: GRAPH-SURFACES-LIKELY-TESTS ─────────────────────────────

/**
 * Scenario: A Python utility function is changed. There is a test file that
 * the graph knows about via a "tests" edge. File-risk scoring gives test
 * files low category-risk (0.2). Graph-aware selection should promote the
 * test file into the top portion of the ranked list.
 */
export function runLikelyTestsFixture(): LikelyTestsFixtureResult {
  resetIds();

  const changedPath = "xbmc/utils/string_utils.py";
  const testPath = "tests/utils/test_string_utils.py";
  const unrelatedPath = "xbmc/cores/player/player.py";

  const allFiles = [changedPath, unrelatedPath, testPath];

  const fChanged = makeFile(nextId(), changedPath, "Python");
  const fTest = makeFile(nextId(), testPath, "Python");
  const fUnrelated = makeFile(nextId(), unrelatedPath, "Python");

  const nSymbol = makeNode(nextId(), fChanged.id, "symbol", "string_utils.format_string", {
    symbolName: "format_string",
    qualifiedName: "string_utils.format_string",
    language: "Python",
  });
  const nTestNode = makeNode(nextId(), fTest.id, "test", "test:test_format_string", {
    symbolName: "test_format_string",
    qualifiedName: "test_string_utils.test_format_string",
    language: "Python",
  });
  const nUnrelated = makeNode(nextId(), fUnrelated.id, "symbol", "player.play", {
    symbolName: "play",
    qualifiedName: "player.play",
    language: "Python",
  });

  // Test node tests the changed symbol
  const eTests = makeEdge(nextId(), "tests", nTestNode.id, nSymbol.id, {
    fileId: fTest.id,
    confidence: 0.95,
  });

  const snapshot: ReviewGraphWorkspaceSnapshot = {
    files: [fChanged, fTest, fUnrelated],
    nodes: [nSymbol, nTestNode, nUnrelated],
    edges: [eTests],
  };

  const blastRadius = queryBlastRadiusFromSnapshot(snapshot, {
    repo: "kodi-player/xbmc",
    workspaceKey: "main",
    changedPaths: [changedPath],
    limit: 20,
  });

  const perFileStats = makePerFileStats(allFiles);
  perFileStats.set(unrelatedPath, { added: 50, removed: 20 }); // highest raw lines

  const filesByCategory: Record<string, string[]> = {
    source: [changedPath, unrelatedPath],
    test: [testPath],
  };

  const riskScores = computeFileRiskScores({
    files: allFiles,
    perFileStats,
    filesByCategory,
    weights: DEFAULT_RISK_WEIGHTS,
  });

  const graphResult = applyGraphAwareSelection({ riskScores, graph: blastRadius });
  const noGraphResult = applyGraphAwareSelection({ riskScores, graph: null });

  const TOP_N = 2;
  const graphAwareTopN = graphResult.riskScores.slice(0, TOP_N).map((f) => f.filePath);
  const riskOnlyTopN = noGraphResult.riskScores.slice(0, TOP_N).map((f) => f.filePath);

  const testPromoted = graphAwareTopN.includes(testPath) && !riskOnlyTopN.includes(testPath);

  return {
    graphLikelyTests: blastRadius.likelyTests.map((t) => t.path),
    graphAwareTopN,
    riskOnlyTopN,
    testPromoted,
    expectedTestPath: testPath,
  };
}

// ── Fixture: GRAPH-RERANKS-DEPENDENTS ────────────────────────────────

/**
 * Scenario: A C++ public API function is changed. The graph has direct
 * call edges from a caller file to the changed symbol. The blast-radius
 * query returns the caller as a probable dependent, and graph-aware
 * selection promotes it above an unrelated file with similar raw risk score.
 */
export function runDependentsFixture(): DependentsFixtureResult {
  resetIds();

  const changedPath = "xbmc/utils/URIUtils.cpp";
  const callerPath = "xbmc/filesystem/FileCurl.cpp";
  const unrelatedPath = "xbmc/pvr/PVRManager.cpp";

  const allFiles = [changedPath, unrelatedPath, callerPath];

  const fChanged = makeFile(nextId(), changedPath);
  const fCaller = makeFile(nextId(), callerPath);
  const fUnrelated = makeFile(nextId(), unrelatedPath);

  const nChangedSymbol = makeNode(nextId(), fChanged.id, "symbol", "URIUtils::GetExtension", {
    symbolName: "GetExtension",
    qualifiedName: "URIUtils::GetExtension",
  });
  const nCallerSymbol = makeNode(nextId(), fCaller.id, "symbol", "FileCurl::Open", {
    symbolName: "Open",
    qualifiedName: "FileCurl::Open",
  });
  const nCallsite = makeNode(nextId(), fCaller.id, "callsite", "callsite:GetExtension@FileCurl", {
    symbolName: "GetExtension",
    qualifiedName: "URIUtils::GetExtension",
  });
  const nUnrelatedSymbol = makeNode(nextId(), fUnrelated.id, "symbol", "PVRManager::Start", {
    symbolName: "Start",
    qualifiedName: "PVRManager::Start",
  });

  // Direct call from caller symbol to changed symbol
  const eCalls = makeEdge(nextId(), "calls", nCallerSymbol.id, nChangedSymbol.id, {
    fileId: fCaller.id,
    confidence: 0.95,
  });

  const snapshot: ReviewGraphWorkspaceSnapshot = {
    files: [fChanged, fCaller, fUnrelated],
    nodes: [nChangedSymbol, nCallerSymbol, nCallsite, nUnrelatedSymbol],
    edges: [eCalls],
  };

  const blastRadius = queryBlastRadiusFromSnapshot(snapshot, {
    repo: "kodi-player/xbmc",
    workspaceKey: "main",
    changedPaths: [changedPath],
    limit: 20,
  });

  const perFileStats = makePerFileStats(allFiles);
  // Caller and unrelated have same raw lines; unrelated gets a slight raw-risk head start
  perFileStats.set(callerPath, { added: 15, removed: 5 });
  perFileStats.set(unrelatedPath, { added: 18, removed: 3 });

  const filesByCategory: Record<string, string[]> = {
    source: [changedPath, callerPath, unrelatedPath],
  };

  const riskScores = computeFileRiskScores({
    files: allFiles,
    perFileStats,
    filesByCategory,
    weights: DEFAULT_RISK_WEIGHTS,
  });

  const graphResult = applyGraphAwareSelection({ riskScores, graph: blastRadius });
  const noGraphResult = applyGraphAwareSelection({ riskScores, graph: null });

  const graphAwareRanking = graphResult.riskScores.map((f) => f.filePath);
  const riskOnlyRanking = noGraphResult.riskScores.map((f) => f.filePath);

  const callerGraphPos = graphAwareRanking.indexOf(callerPath);
  const callerRiskPos = riskOnlyRanking.indexOf(callerPath);
  const unrelatedGraphPos = graphAwareRanking.indexOf(unrelatedPath);

  // Caller should be promoted (higher position = lower index) compared to risk-only
  const callerPromoted =
    callerGraphPos !== -1 &&
    (callerGraphPos < callerRiskPos || callerGraphPos < unrelatedGraphPos);

  return {
    probableDependents: blastRadius.probableDependents.map((d) => ({
      stableKey: d.stableKey,
      filePath: d.filePath,
      score: d.score,
    })),
    graphAwareRanking,
    riskOnlyRanking,
    callerPromoted,
    expectedCallerPath: callerPath,
  };
}

// ── Fixture: FALLBACK-PRESERVES-ORDER ────────────────────────────────

/**
 * Scenario: No graph is available. applyGraphAwareSelection returns the
 * original risk scores unchanged with usedGraph=false.
 */
export function runFallbackFixture(): FallbackFixtureResult {
  const files = [
    "xbmc/utils/URIUtils.cpp",
    "xbmc/cores/VideoPlayer/VideoPlayer.cpp",
    "xbmc/network/oauth/OAuth2Handler.cpp",
  ];

  const perFileStats = makePerFileStats(files);
  perFileStats.set("xbmc/network/oauth/OAuth2Handler.cpp", { added: 80, removed: 10 });

  const filesByCategory: Record<string, string[]> = {
    source: files,
  };

  const riskScores = computeFileRiskScores({
    files,
    perFileStats,
    filesByCategory,
    weights: DEFAULT_RISK_WEIGHTS,
  });

  const result = applyGraphAwareSelection({ riskScores, graph: null });

  const originalOrder = riskScores.map((f) => f.filePath);
  const resultOrder = result.riskScores.map((f) => f.filePath);
  const riskOrderPreserved =
    originalOrder.length === resultOrder.length &&
    originalOrder.every((p, i) => resultOrder[i] === p);

  return {
    usedGraph: result.usedGraph,
    graphHits: result.graphHits,
    graphRankedSelections: result.graphRankedSelections,
    riskOrderPreserved,
    riskScoreCount: result.riskScores.length,
  };
}

// ── Check functions ───────────────────────────────────────────────────

export async function runMissedFilesCheck(
  _runFn?: () => MissedFilesFixtureResult,
): Promise<Check> {
  const result = (_runFn ?? runMissedFilesFixture)();
  const problems: string[] = [];

  if (!result.usedGraph) {
    problems.push("usedGraph=false: graph was not applied");
  }
  if (result.graphHits === 0) {
    problems.push("graphHits=0: no impacted files from blast-radius query");
  }
  if (!result.graphAwareTopN.includes(result.expectedSurfacedPath)) {
    problems.push(
      `${result.expectedSurfacedPath} not in graphAwareTopN=${JSON.stringify(result.graphAwareTopN)}`,
    );
  }
  if (result.graphSurfacedExtra.length === 0) {
    problems.push(
      `graphSurfacedExtra is empty: graph selection did not surface any new files beyond risk-only top-N=${JSON.stringify(result.riskOnlyTopN)}`,
    );
  }

  if (problems.length === 0) {
    return {
      id: "M040-S02-GRAPH-SURFACES-MISSED-FILES",
      passed: true,
      skipped: false,
      status_code: "graph_surfaces_impacted_files_beyond_risk_triage",
      detail: `graphHits=${result.graphHits} graphAwareTopN=${JSON.stringify(result.graphAwareTopN)} riskOnlyTopN=${JSON.stringify(result.riskOnlyTopN)} graphSurfacedExtra=${JSON.stringify(result.graphSurfacedExtra)}`,
    };
  }

  return {
    id: "M040-S02-GRAPH-SURFACES-MISSED-FILES",
    passed: false,
    skipped: false,
    status_code: "graph_missed_files_check_failed",
    detail: problems.join("; "),
  };
}

export async function runLikelyTestsCheck(
  _runFn?: () => LikelyTestsFixtureResult,
): Promise<Check> {
  const result = (_runFn ?? runLikelyTestsFixture)();
  const problems: string[] = [];

  if (result.graphLikelyTests.length === 0) {
    problems.push("graphLikelyTests is empty: blast-radius query surfaced no test files");
  }
  if (!result.graphLikelyTests.includes(result.expectedTestPath)) {
    problems.push(
      `expected test path ${result.expectedTestPath} not in graphLikelyTests=${JSON.stringify(result.graphLikelyTests)}`,
    );
  }
  if (!result.testPromoted) {
    problems.push(
      `test file was not promoted: graphAwareTopN=${JSON.stringify(result.graphAwareTopN)} riskOnlyTopN=${JSON.stringify(result.riskOnlyTopN)}`,
    );
  }

  if (problems.length === 0) {
    return {
      id: "M040-S02-GRAPH-SURFACES-LIKELY-TESTS",
      passed: true,
      skipped: false,
      status_code: "graph_promotes_likely_tests_above_risk_floor",
      detail: `graphLikelyTests=${JSON.stringify(result.graphLikelyTests)} testPromoted=${result.testPromoted} graphAwareTopN=${JSON.stringify(result.graphAwareTopN)}`,
    };
  }

  return {
    id: "M040-S02-GRAPH-SURFACES-LIKELY-TESTS",
    passed: false,
    skipped: false,
    status_code: "likely_tests_check_failed",
    detail: problems.join("; "),
  };
}

export async function runDependentsCheck(
  _runFn?: () => DependentsFixtureResult,
): Promise<Check> {
  const result = (_runFn ?? runDependentsFixture)();
  const problems: string[] = [];

  if (result.probableDependents.length === 0) {
    problems.push("probableDependents is empty: blast-radius query surfaced no dependents");
  }
  const expectedDependent = result.probableDependents.find(
    (d) => d.filePath === result.expectedCallerPath,
  );
  if (!expectedDependent) {
    problems.push(
      `caller file ${result.expectedCallerPath} not in probableDependents paths=${JSON.stringify(result.probableDependents.map((d) => d.filePath))}`,
    );
  }
  if (!result.callerPromoted) {
    problems.push(
      `caller was not promoted: graphAware=${JSON.stringify(result.graphAwareRanking)} riskOnly=${JSON.stringify(result.riskOnlyRanking)}`,
    );
  }

  if (problems.length === 0) {
    return {
      id: "M040-S02-GRAPH-RERANKS-DEPENDENTS",
      passed: true,
      skipped: false,
      status_code: "graph_promotes_callers_above_unrelated_files",
      detail: `dependentCount=${result.probableDependents.length} callerPromoted=${result.callerPromoted} graphAwareRanking=${JSON.stringify(result.graphAwareRanking)}`,
    };
  }

  return {
    id: "M040-S02-GRAPH-RERANKS-DEPENDENTS",
    passed: false,
    skipped: false,
    status_code: "dependents_reranking_check_failed",
    detail: problems.join("; "),
  };
}

export async function runFallbackCheck(
  _runFn?: () => FallbackFixtureResult,
): Promise<Check> {
  const result = (_runFn ?? runFallbackFixture)();
  const problems: string[] = [];

  if (result.usedGraph) {
    problems.push("usedGraph=true when graph was null: fallback contract violated");
  }
  if (result.graphHits !== 0) {
    problems.push(`graphHits=${result.graphHits} expected 0`);
  }
  if (result.graphRankedSelections !== 0) {
    problems.push(`graphRankedSelections=${result.graphRankedSelections} expected 0`);
  }
  if (!result.riskOrderPreserved) {
    problems.push("risk order was not preserved in fallback path");
  }
  if (result.riskScoreCount !== 3) {
    problems.push(`riskScoreCount=${result.riskScoreCount} expected 3`);
  }

  if (problems.length === 0) {
    return {
      id: "M040-S02-FALLBACK-PRESERVES-ORDER",
      passed: true,
      skipped: false,
      status_code: "fallback_preserves_risk_order_unchanged",
      detail: `usedGraph=${result.usedGraph} graphHits=${result.graphHits} riskOrderPreserved=${result.riskOrderPreserved} riskScoreCount=${result.riskScoreCount}`,
    };
  }

  return {
    id: "M040-S02-FALLBACK-PRESERVES-ORDER",
    passed: false,
    skipped: false,
    status_code: "fallback_order_check_failed",
    detail: problems.join("; "),
  };
}

// ── Evaluation ────────────────────────────────────────────────────────

export async function evaluateM040S02(opts?: {
  _missedFilesRunFn?: () => MissedFilesFixtureResult;
  _likelyTestsRunFn?: () => LikelyTestsFixtureResult;
  _dependentsRunFn?: () => DependentsFixtureResult;
  _fallbackRunFn?: () => FallbackFixtureResult;
}): Promise<EvaluationReport> {
  const [missedFiles, likelyTests, dependents, fallback] = await Promise.all([
    runMissedFilesCheck(opts?._missedFilesRunFn),
    runLikelyTestsCheck(opts?._likelyTestsRunFn),
    runDependentsCheck(opts?._dependentsRunFn),
    runFallbackCheck(opts?._fallbackRunFn),
  ]);

  const checks: Check[] = [missedFiles, likelyTests, dependents, fallback];
  const overallPassed = checks.filter((c) => !c.skipped).every((c) => c.passed);

  return {
    check_ids: M040_S02_CHECK_IDS,
    overallPassed,
    checks,
  };
}

// ── Rendering ─────────────────────────────────────────────────────────

function renderReport(report: EvaluationReport): string {
  const lines = [
    "M040 S02 proof harness: blast-radius queries and graph-aware review selection",
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

export async function buildM040S02ProofHarness(opts?: {
  _missedFilesRunFn?: () => MissedFilesFixtureResult;
  _likelyTestsRunFn?: () => LikelyTestsFixtureResult;
  _dependentsRunFn?: () => DependentsFixtureResult;
  _fallbackRunFn?: () => FallbackFixtureResult;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const useJson = opts?.json ?? false;

  const report = await evaluateM040S02({
    _missedFilesRunFn: opts?._missedFilesRunFn,
    _likelyTestsRunFn: opts?._likelyTestsRunFn,
    _dependentsRunFn: opts?._dependentsRunFn,
    _fallbackRunFn: opts?._fallbackRunFn,
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
    stderr.write(`verify:m040:s02 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM040S02ProofHarness({ json: useJson });
  process.exit(exitCode);
}
