/**
 * M038 S03: Fail-open and cache-reuse verifier
 *
 * Proves that:
 *   1. A second review call for the same (repo, baseSha, headSha) reuses the
 *      cached structural-impact result (cache-hit signal, no adapter calls).
 *   2. When both substrates time out the orchestrator returns status
 *      "unavailable" and the review completes without blocking.
 *   3. When both substrates throw the result stays truthful: status
 *      "unavailable", fallbackUsed=true, hasRenderableEvidence=false, and the
 *      degradation summary surface no invented caller counts.
 *   4. When one substrate fails the result is "partial" — only the available
 *      evidence is claimed; the missing source has a degradation record.
 *
 * All checks are synchronous over in-process fixtures; no network I/O.
 */

import pino from "pino";
import { fetchStructuralImpact, type StructuralImpactSignal } from "../src/structural-impact/orchestrator.ts";
import {
  buildStructuralImpactCacheKey,
  createStructuralImpactCache,
} from "../src/structural-impact/cache.ts";
import { summarizeStructuralImpactDegradation } from "../src/structural-impact/degradation.ts";
import type { GraphAdapter, CorpusAdapter, GraphBlastRadiusResult, CorpusCodeMatch } from "../src/structural-impact/adapters.ts";
import type { StructuralImpactPayload } from "../src/structural-impact/types.ts";

export const M038_S03_CHECK_IDS = [
  "M038-S03-CACHE-REUSE",
  "M038-S03-TIMEOUT-FAIL-OPEN",
  "M038-S03-SUBSTRATE-FAILURE-TRUTHFUL",
  "M038-S03-PARTIAL-DEGRADATION-TRUTHFUL",
] as const;

export type M038S03CheckId = (typeof M038_S03_CHECK_IDS)[number];

export type M038S03Check = {
  id: M038S03CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type M038S03EvaluationReport = {
  check_ids: readonly string[];
  overallPassed: boolean;
  checks: M038S03Check[];
};

// ── Adapter helpers ────────────────────────────────────────────────────────────

function makeGraphResult(): GraphBlastRadiusResult {
  return {
    changedFiles: ["xbmc/cores/VideoPlayer/VideoPlayer.cpp"],
    seedSymbols: [
      {
        stableKey: "CVideoPlayer::OpenFile",
        symbolName: "OpenFile",
        qualifiedName: "CVideoPlayer::OpenFile",
        filePath: "xbmc/cores/VideoPlayer/VideoPlayer.cpp",
      },
    ],
    impactedFiles: [
      {
        path: "xbmc/application/ApplicationPlayer.cpp",
        score: 0.98,
        confidence: 1.0,
        reasons: ["calls OpenFile via IPlayer interface"],
        languages: ["C++"],
      },
      {
        path: "xbmc/cores/VideoPlayer/DVDPlayer.cpp",
        score: 0.87,
        confidence: 0.95,
        reasons: ["wraps CVideoPlayer::OpenFile in DVDPlayer shim"],
        languages: ["C++"],
      },
    ],
    probableDependents: [
      {
        stableKey: "CApplicationPlayer::OpenFile",
        symbolName: "OpenFile",
        qualifiedName: "CApplicationPlayer::OpenFile",
        filePath: "xbmc/application/ApplicationPlayer.cpp",
        score: 0.98,
        confidence: 1.0,
        reasons: ["direct call edge via IPlayer::OpenFile"],
      },
    ],
    likelyTests: [
      {
        path: "xbmc/cores/VideoPlayer/test/TestVideoPlayer.cpp",
        score: 0.85,
        confidence: 0.88,
        reasons: ["covers VideoPlayer open/close lifecycle"],
        testSymbols: ["TestOpenFile"],
      },
    ],
    graphStats: {
      files: 8,
      nodes: 34,
      edges: 72,
      changedFilesFound: 1,
    },
  };
}

function makeCorpusMatches(): CorpusCodeMatch[] {
  return [
    {
      filePath: "xbmc/application/ApplicationPlayer.cpp",
      language: "C++",
      startLine: 210,
      endLine: 218,
      chunkType: "method",
      symbolName: "CApplicationPlayer::OpenFile",
      chunkText: "bool CApplicationPlayer::OpenFile(const CFileItem& item, const CPlayerOptions& options) { return m_pPlayer->OpenFile(item, options); }",
      distance: 0.06,
      commitSha: "c0ffee01",
      canonicalRef: "master",
    },
  ];
}

function makeSuccessGraphAdapter(): GraphAdapter {
  return { queryBlastRadius: () => Promise.resolve(makeGraphResult()) };
}

function makeSuccessCorpusAdapter(): CorpusAdapter {
  return { searchCanonicalCode: () => Promise.resolve(makeCorpusMatches()) };
}

function makeErrorGraphAdapter(msg = "graph adapter unavailable"): GraphAdapter {
  return { queryBlastRadius: () => Promise.reject(new Error(msg)) };
}

function makeErrorCorpusAdapter(msg = "corpus adapter unavailable"): CorpusAdapter {
  return { searchCanonicalCode: () => Promise.reject(new Error(msg)) };
}

function makeSlowAdapter<T>(result: T, delayMs: number): { call: () => Promise<T>; callCount: number } {
  let callCount = 0;
  return {
    get callCount() { return callCount; },
    call: () => new Promise((resolve) => {
      callCount++;
      setTimeout(() => resolve(result), delayMs);
    }),
  };
}

function collectSignals(): { signals: StructuralImpactSignal[]; onSignal: (s: StructuralImpactSignal) => void } {
  const signals: StructuralImpactSignal[] = [];
  return { signals, onSignal: (s: StructuralImpactSignal) => signals.push(s) };
}

const REPO = "xbmc/xbmc";
const BASE_SHA = "base-sha-s03";
const HEAD_SHA = "head-sha-s03";

const BASE_GRAPH_INPUT = {
  repo: REPO,
  workspaceKey: "ws-s03",
  changedPaths: ["xbmc/cores/VideoPlayer/VideoPlayer.cpp"],
};

const BASE_CORPUS_INPUT = {
  repo: REPO,
  canonicalRef: "master",
  query: "CVideoPlayer::OpenFile",
};

// ── Check 1: Cache reuse ───────────────────────────────────────────────────────

export async function checkCacheReuse(): Promise<M038S03Check> {
  const cache = createStructuralImpactCache();
  const cacheKey = buildStructuralImpactCacheKey({ repo: REPO, baseSha: BASE_SHA, headSha: HEAD_SHA });

  let graphCallCount = 0;
  let corpusCallCount = 0;

  const trackingGraphAdapter: GraphAdapter = {
    queryBlastRadius: async (input) => {
      graphCallCount++;
      return makeSuccessGraphAdapter().queryBlastRadius(input);
    },
  };

  const trackingCorpusAdapter: CorpusAdapter = {
    searchCanonicalCode: async (input) => {
      corpusCallCount++;
      return makeSuccessCorpusAdapter().searchCanonicalCode(input);
    },
  };

  // First call — cache miss, adapters should be called.
  const { signals: firstSignals, onSignal: firstOnSignal } = collectSignals();
  const first = await fetchStructuralImpact({
    graphAdapter: trackingGraphAdapter,
    corpusAdapter: trackingCorpusAdapter,
    graphInput: BASE_GRAPH_INPUT,
    corpusInput: BASE_CORPUS_INPUT,
    cache,
    cacheKey,
    onSignal: firstOnSignal,
  });

  const firstCallCount = graphCallCount + corpusCallCount;
  const firstCacheMiss = firstSignals.some((s) => s.kind === "cache-miss");
  const firstCacheWrite = firstSignals.some((s) => s.kind === "cache-write");
  const firstResultOk = first.status === "ok";

  // Second call — same cache + same key. Adapters must NOT be called again.
  const { signals: secondSignals, onSignal: secondOnSignal } = collectSignals();
  const second = await fetchStructuralImpact({
    // Replace adapters with broken ones to prove they are never consulted.
    graphAdapter: makeErrorGraphAdapter("should not be called on cache hit"),
    corpusAdapter: makeErrorCorpusAdapter("should not be called on cache hit"),
    graphInput: BASE_GRAPH_INPUT,
    corpusInput: BASE_CORPUS_INPUT,
    cache,
    cacheKey,
    onSignal: secondOnSignal,
  });

  const secondCallCount = graphCallCount + corpusCallCount;
  const secondCacheHit = secondSignals.some((s) => s.kind === "cache-hit");
  const noNewAdapterCalls = secondCallCount === firstCallCount;
  const secondStatusMatches = second.status === first.status;
  const secondPayloadStable = second.changedFiles.join(",") === first.changedFiles.join(",");

  const passed = Boolean(
    firstResultOk
    && firstCacheMiss
    && firstCacheWrite
    && firstCallCount === 2
    && secondCacheHit
    && noNewAdapterCalls
    && secondStatusMatches
    && secondPayloadStable,
  );

  return {
    id: "M038-S03-CACHE-REUSE",
    passed,
    skipped: false,
    status_code: passed ? "cache_reuse_verified" : "cache_reuse_failed",
    detail: `firstStatus=${first.status}; firstCacheMiss=${firstCacheMiss}; firstCacheWrite=${firstCacheWrite}; firstAdapterCalls=${firstCallCount}; secondCacheHit=${secondCacheHit}; noNewAdapterCalls=${noNewAdapterCalls}; secondStatusMatches=${secondStatusMatches}`,
  };
}

// ── Check 2: Timeout fail-open ─────────────────────────────────────────────────

export async function checkTimeoutFailOpen(): Promise<M038S03Check> {
  const TIMEOUT_MS = 40;

  // Both adapters are slow — they exceed the timeout.
  const graphSlowAdapter: GraphAdapter = {
    queryBlastRadius: () => new Promise((resolve) => setTimeout(() => resolve(makeGraphResult()), 500)),
  };
  const corpusSlowAdapter: CorpusAdapter = {
    searchCanonicalCode: () => new Promise((resolve) => setTimeout(() => resolve(makeCorpusMatches()), 500)),
  };

  const { signals, onSignal } = collectSignals();
  const start = Date.now();

  const result = await fetchStructuralImpact({
    graphAdapter: graphSlowAdapter,
    corpusAdapter: corpusSlowAdapter,
    graphInput: BASE_GRAPH_INPUT,
    corpusInput: BASE_CORPUS_INPUT,
    timeoutMs: TIMEOUT_MS,
    onSignal,
  });

  const elapsed = Date.now() - start;

  const statusUnavailable = result.status === "unavailable";
  const twoDegs = result.degradations.length === 2;
  const graphDeg = result.degradations.find((d) => d.source === "graph");
  const corpusDeg = result.degradations.find((d) => d.source === "corpus");
  const degsContainTimeout = graphDeg?.reason.includes("timed out") && corpusDeg?.reason.includes("timed out");
  const resultUnavailableSignal = signals.some((s) => s.kind === "result-unavailable");
  const graphTimeoutSignal = signals.some((s) => s.kind === "graph-timeout");
  const corpusTimeoutSignal = signals.some((s) => s.kind === "corpus-timeout");
  // Must complete well under the adapter delay (500 ms) — not block for full duration.
  const completedBeforeAdapters = elapsed < 400;
  // changedFiles is preserved even on unavailable (traceability requirement)
  const changedFilesPreserved = result.changedFiles.length > 0;
  // No invented evidence
  const noInventedEvidence = result.probableCallers.length === 0 && result.canonicalEvidence.length === 0;

  const degradSummary = summarizeStructuralImpactDegradation(result);
  const fallbackUsed = degradSummary.fallbackUsed;
  const hasNoRenderableEvidence = !degradSummary.hasRenderableEvidence;

  const passed = Boolean(
    statusUnavailable
    && twoDegs
    && degsContainTimeout
    && resultUnavailableSignal
    && graphTimeoutSignal
    && corpusTimeoutSignal
    && completedBeforeAdapters
    && changedFilesPreserved
    && noInventedEvidence
    && fallbackUsed
    && hasNoRenderableEvidence,
  );

  return {
    id: "M038-S03-TIMEOUT-FAIL-OPEN",
    passed,
    skipped: false,
    status_code: passed ? "timeout_fail_open_verified" : "timeout_fail_open_failed",
    detail: `status=${result.status}; degs=${result.degradations.length}; timeoutSignals=[graph=${graphTimeoutSignal},corpus=${corpusTimeoutSignal}]; resultUnavailableSignal=${resultUnavailableSignal}; elapsedMs=${elapsed}; completedBeforeAdapters=${completedBeforeAdapters}; changedFilesPreserved=${changedFilesPreserved}; noInventedEvidence=${noInventedEvidence}; fallbackUsed=${fallbackUsed}; hasNoRenderableEvidence=${hasNoRenderableEvidence}`,
  };
}

// ── Check 3: Substrate failure — truthful degradation ─────────────────────────

export async function checkSubstrateFailureTruthful(): Promise<M038S03Check> {
  const { signals, onSignal } = collectSignals();

  const result = await fetchStructuralImpact({
    graphAdapter: makeErrorGraphAdapter("graph substrate down"),
    corpusAdapter: makeErrorCorpusAdapter("corpus substrate down"),
    graphInput: BASE_GRAPH_INPUT,
    corpusInput: BASE_CORPUS_INPUT,
    onSignal,
  });

  const statusUnavailable = result.status === "unavailable";
  const twoDegs = result.degradations.length === 2;
  const graphDeg = result.degradations.find((d) => d.source === "graph");
  const corpusDeg = result.degradations.find((d) => d.source === "corpus");
  const graphErrMsgPreserved = graphDeg?.reason.includes("graph substrate down");
  const corpusErrMsgPreserved = corpusDeg?.reason.includes("corpus substrate down");
  const noCallers = result.probableCallers.length === 0;
  const noEvidence = result.canonicalEvidence.length === 0;
  const noImpactedFiles = result.impactedFiles.length === 0;
  const noTests = result.likelyTests.length === 0;
  const graphStatsNull = result.graphStats === null;

  // Observability signals
  const graphErrorSignal = signals.some((s) => s.kind === "graph-error" && s.detail?.includes("graph substrate down"));
  const corpusErrorSignal = signals.some((s) => s.kind === "corpus-error" && s.detail?.includes("corpus substrate down"));
  const resultUnavailableSignal = signals.some((s) => s.kind === "result-unavailable");

  // Degradation summary must confirm no renderable evidence and fallback used.
  const degradSummary = summarizeStructuralImpactDegradation(result);
  const summaryStatusUnavailable = degradSummary.status === "unavailable";
  const summaryFallbackUsed = degradSummary.fallbackUsed;
  const summaryNoRenderableEvidence = !degradSummary.hasRenderableEvidence;
  const graphUnavailableSignal = degradSummary.truthfulnessSignals.includes("graph-unavailable");
  const corpusUnavailableSignal = degradSummary.truthfulnessSignals.includes("corpus-unavailable");
  const noStructuralEvidenceSignal = degradSummary.truthfulnessSignals.includes("no-structural-evidence");

  const passed = Boolean(
    statusUnavailable
    && twoDegs
    && graphErrMsgPreserved
    && corpusErrMsgPreserved
    && noCallers
    && noEvidence
    && noImpactedFiles
    && noTests
    && graphStatsNull
    && graphErrorSignal
    && corpusErrorSignal
    && resultUnavailableSignal
    && summaryStatusUnavailable
    && summaryFallbackUsed
    && summaryNoRenderableEvidence
    && graphUnavailableSignal
    && corpusUnavailableSignal
    && noStructuralEvidenceSignal,
  );

  return {
    id: "M038-S03-SUBSTRATE-FAILURE-TRUTHFUL",
    passed,
    skipped: false,
    status_code: passed ? "substrate_failure_truthful_verified" : "substrate_failure_truthful_failed",
    detail: `status=${result.status}; degs=${result.degradations.length}; noCallers=${noCallers}; noEvidence=${noEvidence}; noImpactedFiles=${noImpactedFiles}; noTests=${noTests}; graphStatsNull=${graphStatsNull}; summaryStatus=${degradSummary.status}; fallbackUsed=${summaryFallbackUsed}; noRenderableEvidence=${summaryNoRenderableEvidence}; truthfulnessSignals=[${degradSummary.truthfulnessSignals.join(",")}]`,
  };
}

// ── Check 4: Partial degradation — only claims available evidence ─────────────

export async function checkPartialDegradationTruthful(): Promise<M038S03Check> {
  // Graph OK, corpus fails — result should have graph evidence, no corpus evidence.
  const { signals: signals1, onSignal: onSignal1 } = collectSignals();
  const graphOkCorpusFail = await fetchStructuralImpact({
    graphAdapter: makeSuccessGraphAdapter(),
    corpusAdapter: makeErrorCorpusAdapter("corpus down for maintenance"),
    graphInput: BASE_GRAPH_INPUT,
    corpusInput: BASE_CORPUS_INPUT,
    onSignal: onSignal1,
  });

  const case1StatusPartial = graphOkCorpusFail.status === "partial";
  const case1HasGraphEvidence = graphOkCorpusFail.impactedFiles.length > 0 && graphOkCorpusFail.probableCallers.length > 0;
  const case1NoCorpusEvidence = graphOkCorpusFail.canonicalEvidence.length === 0;
  const case1OnlyCorpusDeg = graphOkCorpusFail.degradations.length === 1 && graphOkCorpusFail.degradations[0]?.source === "corpus";
  const case1ResultPartialSignal = signals1.some((s) => s.kind === "result-partial");

  const degradSummary1 = summarizeStructuralImpactDegradation(graphOkCorpusFail);
  const case1GraphAvailable = degradSummary1.availability.graphAvailable;
  const case1CorpusUnavailable = !degradSummary1.availability.corpusAvailable;
  const case1HasRenderableEvidence = degradSummary1.hasRenderableEvidence;
  const case1FallbackUsed = degradSummary1.fallbackUsed;

  // Graph fails, corpus OK — result should have corpus evidence, no graph evidence.
  const { signals: signals2, onSignal: onSignal2 } = collectSignals();
  const graphFailCorpusOk = await fetchStructuralImpact({
    graphAdapter: makeErrorGraphAdapter("graph unavailable for maintenance"),
    corpusAdapter: makeSuccessCorpusAdapter(),
    graphInput: BASE_GRAPH_INPUT,
    corpusInput: BASE_CORPUS_INPUT,
    onSignal: onSignal2,
  });

  const case2StatusPartial = graphFailCorpusOk.status === "partial";
  const case2HasCorpusEvidence = graphFailCorpusOk.canonicalEvidence.length > 0;
  const case2NoGraphEvidence = graphFailCorpusOk.probableCallers.length === 0 && graphFailCorpusOk.impactedFiles.length === 0;
  const case2OnlyGraphDeg = graphFailCorpusOk.degradations.length === 1 && graphFailCorpusOk.degradations[0]?.source === "graph";
  const case2ResultPartialSignal = signals2.some((s) => s.kind === "result-partial");

  const degradSummary2 = summarizeStructuralImpactDegradation(graphFailCorpusOk);
  const case2GraphUnavailable = !degradSummary2.availability.graphAvailable;
  const case2CorpusAvailable = degradSummary2.availability.corpusAvailable;
  const case2HasRenderableEvidence = degradSummary2.hasRenderableEvidence;

  const passed = Boolean(
    case1StatusPartial
    && case1HasGraphEvidence
    && case1NoCorpusEvidence
    && case1OnlyCorpusDeg
    && case1ResultPartialSignal
    && case1GraphAvailable
    && case1CorpusUnavailable
    && case1HasRenderableEvidence
    && case1FallbackUsed
    && case2StatusPartial
    && case2HasCorpusEvidence
    && case2NoGraphEvidence
    && case2OnlyGraphDeg
    && case2ResultPartialSignal
    && case2GraphUnavailable
    && case2CorpusAvailable
    && case2HasRenderableEvidence,
  );

  return {
    id: "M038-S03-PARTIAL-DEGRADATION-TRUTHFUL",
    passed,
    skipped: false,
    status_code: passed ? "partial_degradation_truthful_verified" : "partial_degradation_truthful_failed",
    detail: [
      `case1[graphOk+corpusFail]: status=${graphOkCorpusFail.status}; hasGraphEvidence=${case1HasGraphEvidence}; noCorpusEvidence=${case1NoCorpusEvidence}; onlyCorpusDeg=${case1OnlyCorpusDeg}; graphAvail=${case1GraphAvailable}; corpusUnavail=${case1CorpusUnavailable}; hasRenderableEvidence=${case1HasRenderableEvidence}`,
      `case2[graphFail+corpusOk]: status=${graphFailCorpusOk.status}; hasCorpusEvidence=${case2HasCorpusEvidence}; noGraphEvidence=${case2NoGraphEvidence}; onlyGraphDeg=${case2OnlyGraphDeg}; graphUnavail=${case2GraphUnavailable}; corpusAvail=${case2CorpusAvailable}; hasRenderableEvidence=${case2HasRenderableEvidence}`,
    ].join(" | "),
  };
}

// ── Harness ────────────────────────────────────────────────────────────────────

export async function evaluateM038S03Checks(): Promise<M038S03EvaluationReport> {
  const checks = await Promise.all([
    checkCacheReuse(),
    checkTimeoutFailOpen(),
    checkSubstrateFailureTruthful(),
    checkPartialDegradationTruthful(),
  ]);

  return {
    check_ids: M038_S03_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed),
    checks,
  };
}

export function renderM038S03Report(report: M038S03EvaluationReport): {
  human: string;
  json: string;
} {
  const humanLines = [
    "M038 S03 fail-open and cache-reuse verifier",
    `overallPassed=${report.overallPassed}`,
    "",
    "Checks:",
    ...report.checks.map(
      (check) =>
        `- ${check.id}: ${check.passed ? "PASS" : "FAIL"} (${check.status_code})${check.detail ? ` — ${check.detail}` : ""}`,
    ),
  ];

  return {
    human: `${humanLines.join("\n")}\n`,
    json: `${JSON.stringify(report, null, 2)}\n`,
  };
}

export async function buildM038S03ProofHarness(opts?: {
  json?: boolean;
  stdout?: Pick<typeof process.stdout, "write">;
  stderr?: Pick<typeof process.stderr, "write">;
}): Promise<{ exitCode: number; report: M038S03EvaluationReport }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;

  const report = await evaluateM038S03Checks();
  const rendered = renderM038S03Report(report);

  stdout.write(opts?.json ? rendered.json : rendered.human);

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed)
      .map((check) => check.status_code)
      .join(",");
    stderr.write(`verify:m038:s03 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

const silentLogger = pino({ level: "silent" });

export async function main(
  argv = process.argv.slice(2),
  io?: {
    stdout?: Pick<typeof process.stdout, "write">;
    stderr?: Pick<typeof process.stderr, "write">;
  },
): Promise<number> {
  const useJson = argv.includes("--json");
  const { exitCode } = await buildM038S03ProofHarness({
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
