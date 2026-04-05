/**
 * Structural-impact orchestration layer.
 *
 * Coordinates concurrent queries to the graph blast-radius substrate (M040)
 * and the canonical current-code corpus (M041), applies a shared timeout,
 * folds the results into a bounded StructuralImpactPayload via
 * `boundStructuralImpactPayload`, and emits observability signals.
 *
 * Design rules:
 *   - Neither adapter is allowed to block review dispatch past the timeout.
 *   - Partial results (one adapter responded, one timed out or errored)
 *     are surfaced with `status: "partial"` and a degradation record.
 *   - Cache is keyed by `(repo, baseSha, headSha)` and is write-through:
 *     the first successful full or partial result is stored; cache hits
 *     skip adapter calls entirely.
 *   - Observability signals (timing, cache-hit, timeout, partial-result)
 *     are emitted via the `onSignal` callback so the caller can wire them
 *     into whatever logging or telemetry layer is active.
 *   - This file wires the adapters together but does NOT import substrate
 *     modules directly — substrate coupling lives in the injection point at
 *     src/handlers/review.ts (or wherever adapters are constructed).
 */

import type {
  GraphAdapter,
  CorpusAdapter,
  GraphQueryInput,
  CorpusQueryInput,
  GraphBlastRadiusResult,
  CorpusCodeMatch,
} from "./adapters.ts";
import { boundStructuralImpactPayload } from "./adapters.ts";
import type {
  StructuralImpactPayload,
  StructuralImpactDegradation,
} from "./types.ts";

// ── Observability signals ─────────────────────────────────────────────────────

export type StructuralImpactSignalKind =
  | "cache-hit"
  | "cache-miss"
  | "cache-write"
  | "graph-ok"
  | "graph-timeout"
  | "graph-error"
  | "corpus-ok"
  | "corpus-timeout"
  | "corpus-error"
  | "result-ok"
  | "result-partial"
  | "result-unavailable";

export type StructuralImpactSignal = {
  kind: StructuralImpactSignalKind;
  /** Elapsed ms for the source that produced this signal, if applicable. */
  elapsedMs?: number;
  /** Short human-readable annotation (error message, cache key, etc.). */
  detail?: string;
};

// ── Cache contract ────────────────────────────────────────────────────────────

export type StructuralImpactCache = {
  get(key: string): StructuralImpactPayload | undefined;
  set(key: string, value: StructuralImpactPayload): void;
};

// ── Orchestration input ───────────────────────────────────────────────────────

export type FetchStructuralImpactInput = {
  // Adapter instances — injected by the caller; not constructed here.
  graphAdapter: GraphAdapter;
  corpusAdapter: CorpusAdapter;

  // Graph query params.
  graphInput: GraphQueryInput;

  // Corpus query params.
  corpusInput: CorpusQueryInput;

  /**
   * Maximum ms to wait for each adapter before treating it as timed out.
   * Defaults to 30_000 (30 s) per M038 spec.
   */
  timeoutMs?: number;

  /**
   * Optional cache for result reuse keyed by `(repo, baseSha, headSha)`.
   * When provided, a cache hit skips both adapter calls.
   */
  cache?: StructuralImpactCache;

  /**
   * Cache key to use for get/set. Build it at call-site from
   * (repo, baseSha, headSha). Required when `cache` is provided.
   */
  cacheKey?: string;

  /**
   * Observability callback. Called for each signal event synchronously
   * before the result is returned. Errors thrown by this callback are
   * silently swallowed so they cannot affect the review pipeline.
   */
  onSignal?: (signal: StructuralImpactSignal) => void;
};

// ── Timeout helper ────────────────────────────────────────────────────────────

const TIMEOUT_SENTINEL = Symbol("structural-impact-timeout");

/**
 * Race `promise` against a `timeoutMs` deadline.
 * Returns `TIMEOUT_SENTINEL` if the deadline fires first.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof TIMEOUT_SENTINEL> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ── Orchestration ─────────────────────────────────────────────────────────────

function emit(
  onSignal: ((signal: StructuralImpactSignal) => void) | undefined,
  signal: StructuralImpactSignal,
): void {
  if (!onSignal) return;
  try {
    onSignal(signal);
  } catch {
    // Swallow — observability must never affect the review pipeline.
  }
}

/**
 * Fetch structural-impact data from both substrates concurrently, apply a
 * shared timeout, fold results into a bounded StructuralImpactPayload, and
 * emit observability signals.
 *
 * This is the single entry point for structural-impact data in the review
 * pipeline. The review handler should call this once per review, inject the
 * result into the prompt builder, and never touch graph or corpus APIs directly.
 *
 * Fail-open contract:
 *   - Any adapter error → degradation record, empty results for that source.
 *   - Timeout before any response → degradation record, empty results.
 *   - Both fail → `status: "unavailable"`, review continues without section.
 */
export async function fetchStructuralImpact(
  opts: FetchStructuralImpactInput,
): Promise<StructuralImpactPayload> {
  const {
    graphAdapter,
    corpusAdapter,
    graphInput,
    corpusInput,
    timeoutMs = 30_000,
    cache,
    cacheKey,
    onSignal,
  } = opts;

  // ── Cache read ──────────────────────────────────────────────────────────────

  if (cache && cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      emit(onSignal, { kind: "cache-hit", detail: cacheKey });
      return cached;
    }
    emit(onSignal, { kind: "cache-miss", detail: cacheKey });
  }

  // ── Concurrent adapter calls with individual timeouts ───────────────────────

  const graphStart = Date.now();
  const corpusStart = Date.now();

  // Wrap each adapter call so a rejection becomes a resolved Error value.
  // This ensures withTimeout sees a resolved promise (either a real result, a
  // timeout sentinel, or an Error) and never receives an unhandled rejection.
  const graphPromise = graphAdapter.queryBlastRadius(graphInput).catch((e: unknown) => {
    return e instanceof Error ? e : new Error(String(e));
  });
  const corpusPromise = corpusAdapter.searchCanonicalCode(corpusInput).catch((e: unknown) => {
    return e instanceof Error ? e : new Error(String(e));
  });

  const [graphOutcome, corpusOutcome] = await Promise.all([
    withTimeout(graphPromise, timeoutMs).then((r) => ({ result: r, elapsedMs: Date.now() - graphStart })),
    withTimeout(corpusPromise, timeoutMs).then((r) => ({ result: r, elapsedMs: Date.now() - corpusStart })),
  ]);

  // ── Interpret graph outcome ─────────────────────────────────────────────────

  const degradations: StructuralImpactDegradation[] = [];
  let graphResult: GraphBlastRadiusResult | null = null;
  let corpusMatches: CorpusCodeMatch[] = [];

  if (graphOutcome.result === TIMEOUT_SENTINEL) {
    emit(onSignal, { kind: "graph-timeout", elapsedMs: graphOutcome.elapsedMs });
    degradations.push({ source: "graph", reason: `timed out after ${graphOutcome.elapsedMs}ms` });
  } else if (graphOutcome.result instanceof Error) {
    // Safety: should not happen since adapter contract is fail-open, but guard anyway.
    emit(onSignal, {
      kind: "graph-error",
      elapsedMs: graphOutcome.elapsedMs,
      detail: String(graphOutcome.result),
    });
    degradations.push({ source: "graph", reason: String(graphOutcome.result) });
  } else {
    emit(onSignal, { kind: "graph-ok", elapsedMs: graphOutcome.elapsedMs });
    graphResult = graphOutcome.result as GraphBlastRadiusResult;
  }

  // ── Interpret corpus outcome ────────────────────────────────────────────────

  if (corpusOutcome.result === TIMEOUT_SENTINEL) {
    emit(onSignal, { kind: "corpus-timeout", elapsedMs: corpusOutcome.elapsedMs });
    degradations.push({ source: "corpus", reason: `timed out after ${corpusOutcome.elapsedMs}ms` });
  } else if (corpusOutcome.result instanceof Error) {
    emit(onSignal, {
      kind: "corpus-error",
      elapsedMs: corpusOutcome.elapsedMs,
      detail: String(corpusOutcome.result),
    });
    degradations.push({ source: "corpus", reason: String(corpusOutcome.result) });
  } else {
    emit(onSignal, { kind: "corpus-ok", elapsedMs: corpusOutcome.elapsedMs });
    corpusMatches = corpusOutcome.result as CorpusCodeMatch[];
  }

  // ── Assemble bounded payload ────────────────────────────────────────────────

  const payload = boundStructuralImpactPayload({
    graphResult,
    corpusMatches,
    changedPaths: graphInput.changedPaths,
    degradations,
  });

  // ── Result signal ───────────────────────────────────────────────────────────

  const resultKind =
    payload.status === "ok"
      ? "result-ok"
      : payload.status === "partial"
        ? "result-partial"
        : "result-unavailable";

  emit(onSignal, { kind: resultKind as StructuralImpactSignalKind });

  // ── Cache write ─────────────────────────────────────────────────────────────

  if (cache && cacheKey) {
    cache.set(cacheKey, payload);
    emit(onSignal, { kind: "cache-write", detail: cacheKey });
  }

  return payload;
}

// ── Cache key builder ─────────────────────────────────────────────────────────

/**
 * Build the canonical structural-impact cache key from (repo, baseSha, headSha).
 * Stable across call-sites; callers should not build ad-hoc keys.
 */
export function buildStructuralImpactCacheKey(params: {
  repo: string;
  baseSha: string;
  headSha: string;
}): string {
  return `structural-impact:${params.repo.toLowerCase()}:${params.baseSha}:${params.headSha}`;
}
