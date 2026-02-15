# Phase 58: Intelligence Layer - Research

**Researched:** 2026-02-15
**Domain:** Adaptive distance thresholds for vector retrieval using max-gap detection
**Confidence:** HIGH

## Summary

Phase 58 replaces the fixed `distanceThreshold` (currently 0.3, configurable) in the retrieval isolation layer with a per-query adaptive threshold computed from the statistical distribution of candidate distances. The core idea: when enough candidates exist (8+), their distance values naturally cluster into "relevant" (low distance) and "irrelevant" (high distance) groups with a gap between them. Max-gap detection finds this natural cutoff.

The implementation touches three layers: (1) a new pure-function module `src/learning/adaptive-threshold.ts` that computes the threshold from a sorted distance array, (2) modifications to `src/learning/isolation.ts` to call the adaptive threshold instead of using the fixed config value, and (3) telemetry extensions to record which threshold method was used (adaptive/percentile/configured) so the improvement can be validated against the Phase 56 baseline.

The critical design constraint is ordering: the adaptive threshold must be computed on distances AFTER language reranking and recency weighting have been applied (Phases 52/57). Currently, the fixed threshold is applied in the isolation layer BEFORE reranking, which creates a problem -- candidates filtered out by the fixed threshold never get reranked. Phase 58 needs to restructure the pipeline so filtering happens after the full reranking chain, or alternatively, request more candidates from the isolation layer (higher topK) and apply the adaptive threshold as a post-rerank filter.

**Primary recommendation:** Implement a pure-function `computeAdaptiveThreshold()` module, increase the isolation layer's internal `topK` to provide enough candidates for gap detection, and apply the adaptive threshold as a post-rerank filter in the review handler. Log threshold method in the existing `retrieval_quality` telemetry table.

## Standard Stack

### Core
| Library/Tech | Version | Purpose | Why Standard (in this repo) |
|---|---:|---|---|
| TypeScript (ESM) | peer `^5` | Implementation language | Repo standard |
| Bun (`bun:sqlite`) | (runtime) | Telemetry store for threshold logging | Already used |

### Supporting
| Library | Version | Purpose | When to Use |
|---|---:|---|---|
| `pino` | `^10.3.0` | Logging | Threshold selection debug logging |

### No New Dependencies

Max-gap detection and percentile-based thresholds are ~80 lines of pure math (sort, diff, argmax). No external library needed. The Kneedle algorithm (referenced in prior research) is overkill for result sets of 5-20 candidates; a simplified max-gap approach is both simpler and more stable at small N.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| Max-gap (largest distance jump) | Full Kneedle algorithm | Kneedle adds normalization + difference curve computation -- more robust for N>50 but unstable for N<15 which is our typical case |
| Percentile fallback for N<8 | Fixed threshold fallback | Percentile adapts to the actual result distribution even at small N; fixed threshold ignores the data entirely |
| Post-rerank adaptive filter | Pre-rerank adaptive filter (in isolation.ts) | Post-rerank ensures threshold accounts for language and recency adjustments; pre-rerank would compute threshold on unadjusted distances |

## Architecture Patterns

### Current Pipeline (Pre-Phase 58)
```
isolation.ts (query vec, filter by fixed distanceThreshold, topK)
  -> rerankByLanguage() (adjust distances by language match)
    -> applyRecencyWeighting() (adjust distances by memory age)
      -> build retrieval context for prompt
```

**Problem:** The fixed threshold in `isolation.ts` (line 52) filters candidates BEFORE reranking. Candidates that would become relevant after language boost are lost. More importantly, the adaptive threshold needs to see the full candidate distribution to detect the gap.

### Recommended Pipeline (Phase 58)
```
isolation.ts (query vec, topK=20, NO distance filtering)
  -> rerankByLanguage() (adjust distances by language match)
    -> applyRecencyWeighting() (adjust distances by memory age)
      -> computeAdaptiveThreshold() (find natural cutoff in reranked distances)
        -> filter results by adaptive threshold
          -> take final topK (from config, typically 5)
            -> build retrieval context for prompt
```

### Recommended Project Structure (extensions)
```
src/
├── learning/
│   ├── adaptive-threshold.ts          # NEW: max-gap + percentile threshold
│   ├── adaptive-threshold.test.ts     # NEW
│   ├── isolation.ts                   # MODIFIED: remove distance filtering, increase internal topK
│   ├── retrieval-rerank.ts            # unchanged
│   └── retrieval-recency.ts           # unchanged
├── handlers/
│   └── review.ts                      # MODIFIED: apply adaptive threshold post-rerank
├── telemetry/
│   ├── types.ts                       # MODIFIED: add threshold_method to RetrievalQualityRecord
│   └── store.ts                       # MODIFIED: persist threshold_method column
└── execution/
    └── config.ts                      # MODIFIED: add adaptive threshold config knobs
```

### Pattern 1: Pure Function Threshold Computation
**What:** `computeAdaptiveThreshold()` takes a sorted array of distances and returns a threshold value + method label. No side effects, no store access.
**When to use:** Always -- this is the core of Phase 58.
**Why:** Matches `rerankByLanguage()`, `applyRecencyWeighting()`, `classifyDepBump()` -- all pure functions tested in isolation.

### Pattern 2: Pipeline Chaining (Post-Rerank Filter)
**What:** The adaptive threshold is applied AFTER the full reranking chain, as a filter step before building the prompt context.
**When to use:** When the threshold depends on adjusted distances, not raw distances.
**Why:** The PITFALLS.md research (interaction pitfall: "adaptive thresholds + recency weighting") explicitly recommends: "Apply recency weighting BEFORE adaptive threshold computation. The adaptive threshold should be computed on recency-adjusted distances, not raw distances."

### Pattern 3: Fail-Open with Configured Fallback
**What:** If adaptive threshold computation fails or produces a pathological result, fall back to the configured `distanceThreshold` (default 0.3).
**When to use:** Any error in threshold computation.
**Why:** Matches existing fail-open pattern throughout the retrieval pipeline.

### Anti-Patterns to Avoid
- **Computing adaptive threshold on raw (pre-rerank) distances:** The gap in raw distances does not account for language/recency adjustments, leading to incorrect cutoffs.
- **Removing the configured distanceThreshold entirely:** It remains as the ultimate fallback and for users who prefer a fixed threshold.
- **Making the isolation layer aware of reranking logic:** Keep the isolation layer simple (query + merge + dedup). Adaptive filtering belongs in the handler or a dedicated pipeline step.
- **Applying adaptive threshold inside `rerankByLanguage` or `applyRecencyWeighting`:** These are independent concerns. The threshold is a separate pipeline step.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Distance-based sorting | Custom sort | `Array.sort((a, b) => a.adjustedDistance - b.adjustedDistance)` | Already done by reranking steps |
| Telemetry recording | New telemetry path | `telemetryStore.recordRetrievalQuality()` | Existing prepared statement + table |
| Config schema validation | Manual checks | `zod` schema extension in `execution/config.ts` | Repo pattern |

**Key insight:** This phase is algorithmically simple (sort, diff, argmax) but architecturally important (pipeline restructuring). The risk is in the plumbing, not the math.

## Common Pitfalls

### Pitfall 1: Max-Gap Instability with Small Candidate Sets (CRITICAL)
**What goes wrong:** With fewer than 8 candidates, the max-gap approach becomes unstable -- a single outlier can dominate the gap, producing a threshold that either includes everything or excludes everything.
**Why it happens:** Max-gap needs enough data points to distinguish signal from noise. At N=3 or N=5, there's not enough distribution to detect a meaningful gap.
**How to avoid:** The 8-candidate minimum guard is a hard requirement. Below 8, use percentile-based threshold (e.g., 75th percentile of distances). The percentile approach is less sophisticated but stable at any N >= 1.
**Warning signs:** Threshold variance > 0.15 across consecutive reviews on the same repo.

### Pitfall 2: All Candidates at Similar Distance (Numerical Edge Case)
**What goes wrong:** If all candidates cluster at similar distances (e.g., 0.28, 0.29, 0.30, 0.31), the max gap is tiny and meaningless. The algorithm picks an arbitrary cutoff.
**Why it happens:** This happens when the query is either very generic (everything is moderately similar) or very specific (everything in the store is about the same topic).
**How to avoid:** Add a minimum gap threshold. If the largest gap is below a minimum (e.g., 0.05), fall back to the configured threshold. This means "there's no natural cutoff, use the default."
**Warning signs:** Adaptive threshold produces values very close to the configured default; the gap detection added no value.

### Pitfall 3: Pipeline Ordering Mistake (Threshold Before Rerank)
**What goes wrong:** Computing the adaptive threshold on pre-rerank distances, then applying language boost/recency, causes the threshold to not account for distance adjustments. A result at raw distance 0.35 (above threshold 0.32) gets filtered, even though after language boost it would be 0.30 (below threshold).
**Why it happens:** The current architecture applies the fixed threshold in `isolation.ts` before reranking. It's tempting to slot the adaptive threshold in the same place.
**How to avoid:** Move filtering to post-rerank. The isolation layer should return more candidates (internal topK of ~20) without distance filtering. The adaptive threshold is computed on reranked distances and applied as a post-rerank filter.
**Warning signs:** Adaptive threshold produces different results than expected; language-matched results missing from context.

### Pitfall 4: Breaking Existing Behavior When Adaptive is Disabled
**What goes wrong:** Repos with `distanceThreshold` explicitly configured in `.kodiai.yml` should NOT get adaptive thresholds unless they opt in. Changing the default behavior breaks existing setups.
**Why it happens:** Phase 58 changes the pipeline to remove pre-rerank filtering, which changes behavior even when adaptive thresholds are "off."
**How to avoid:** Add an `adaptive` boolean (default: true) to the retrieval config. When false, use the legacy pipeline (filter in isolation layer by configured threshold). When true, use the new pipeline (fetch more, rerank, adaptive filter). Ensure backward compatibility.
**Warning signs:** Existing tests that assert `distanceThreshold: 0.3` behavior start failing.

### Pitfall 5: Telemetry Schema Change Not Additive-Only
**What goes wrong:** Adding a `threshold_method` column to `retrieval_quality` without making it nullable causes existing databases to fail on startup.
**Why it happens:** `ALTER TABLE ADD COLUMN` in SQLite requires nullable or a default value.
**How to avoid:** Use nullable column: `ALTER TABLE retrieval_quality ADD COLUMN threshold_method TEXT`. Use the existing `ensureTableColumn` pattern from the knowledge store, or the `CREATE TABLE IF NOT EXISTS` pattern (since the table was created in Phase 56, it may need ALTER).
**Warning signs:** Startup errors on existing telemetry databases.

## Code Examples

### Max-Gap Threshold Detection
```typescript
// src/learning/adaptive-threshold.ts

export type ThresholdMethod = "adaptive" | "percentile" | "configured";

export type AdaptiveThresholdResult = {
  threshold: number;
  method: ThresholdMethod;
  candidateCount: number;
  gapSize?: number;       // only for adaptive method
  gapIndex?: number;      // index where gap was found
};

export type AdaptiveThresholdConfig = {
  /** Minimum candidates required for max-gap detection (default: 8) */
  minCandidatesForGap: number;
  /** Percentile to use when below minCandidatesForGap (default: 0.75) */
  fallbackPercentile: number;
  /** Minimum gap size to consider meaningful (default: 0.05) */
  minGapSize: number;
  /** Absolute floor for any computed threshold (default: 0.15) */
  floor: number;
  /** Absolute ceiling for any computed threshold (default: 0.65) */
  ceiling: number;
};

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveThresholdConfig = {
  minCandidatesForGap: 8,
  fallbackPercentile: 0.75,
  minGapSize: 0.05,
  floor: 0.15,
  ceiling: 0.65,
};

/**
 * Compute an adaptive distance threshold from a sorted array of distances.
 *
 * - If distances.length >= minCandidatesForGap: use max-gap detection.
 *   Find the largest jump between consecutive distances. The threshold
 *   is the distance value at the lower side of the gap (include results
 *   before the gap, exclude results after).
 *
 * - If distances.length < minCandidatesForGap but > 0: use percentile.
 *   Take the distance at the given percentile rank.
 *
 * - If distances.length === 0: return the configured fallback threshold.
 *
 * All results are clamped to [floor, ceiling].
 */
export function computeAdaptiveThreshold(params: {
  distances: number[];
  configuredThreshold: number;
  config?: AdaptiveThresholdConfig;
}): AdaptiveThresholdResult {
  const { distances, configuredThreshold, config = DEFAULT_ADAPTIVE_CONFIG } = params;

  if (distances.length === 0) {
    return {
      threshold: clamp(configuredThreshold, config.floor, config.ceiling),
      method: "configured",
      candidateCount: 0,
    };
  }

  // Ensure sorted ascending
  const sorted = [...distances].sort((a, b) => a - b);

  if (sorted.length < config.minCandidatesForGap) {
    // Percentile fallback
    const idx = Math.min(
      Math.floor(sorted.length * config.fallbackPercentile),
      sorted.length - 1,
    );
    return {
      threshold: clamp(sorted[idx]!, config.floor, config.ceiling),
      method: "percentile",
      candidateCount: sorted.length,
    };
  }

  // Max-gap detection
  let maxGap = 0;
  let maxGapIndex = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]! - sorted[i - 1]!;
    if (gap > maxGap) {
      maxGap = gap;
      maxGapIndex = i;
    }
  }

  // If the largest gap is below minimum, no natural cutoff exists
  if (maxGap < config.minGapSize) {
    return {
      threshold: clamp(configuredThreshold, config.floor, config.ceiling),
      method: "configured",
      candidateCount: sorted.length,
      gapSize: maxGap,
    };
  }

  // Threshold is the last distance before the gap
  // (include all results up to and including sorted[maxGapIndex - 1])
  const threshold = sorted[maxGapIndex - 1]!;
  return {
    threshold: clamp(threshold, config.floor, config.ceiling),
    method: "adaptive",
    candidateCount: sorted.length,
    gapSize: maxGap,
    gapIndex: maxGapIndex,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
```

### Isolation Layer Change: Remove Pre-Filter, Increase Internal TopK
```typescript
// In isolation.ts -- the key change is removing the distance filter
// and fetching more candidates for the adaptive threshold to work with.

// BEFORE (current):
const filteredRepo = repoResults.filter((r) => r.distance <= distanceThreshold);

// AFTER (Phase 58):
// No distance filtering here. Return all candidates up to internalTopK.
// The adaptive threshold will be applied post-rerank in the handler.
const filteredRepo = repoResults; // all candidates, no pre-filter
```

### Review Handler: Post-Rerank Adaptive Filtering
```typescript
// In src/handlers/review.ts, after reranking chain:

import { computeAdaptiveThreshold } from "../learning/adaptive-threshold.ts";

// After language rerank + recency weighting:
const distances = reranked.map(r => r.adjustedDistance);
const adaptiveResult = computeAdaptiveThreshold({
  distances,
  configuredThreshold: config.knowledge.retrieval.distanceThreshold,
});

// Filter by adaptive threshold
const filtered = reranked.filter(r => r.adjustedDistance <= adaptiveResult.threshold);
const finalResults = filtered.slice(0, config.knowledge.retrieval.topK);

// Log threshold method in telemetry
telemetryStore.recordRetrievalQuality({
  // ...existing fields...
  distanceThreshold: adaptiveResult.threshold,
  thresholdMethod: adaptiveResult.method,
});
```

### Telemetry Schema Extension
```typescript
// In telemetry/types.ts -- extend RetrievalQualityRecord:
export type RetrievalQualityRecord = {
  // ...existing fields...
  /** How the distance threshold was selected: 'adaptive', 'percentile', or 'configured' */
  thresholdMethod?: string;
};

// In telemetry/store.ts -- additive column migration:
// Use the same pattern as knowledge store for column addition.
// Since retrieval_quality was created in Phase 56, add column via ALTER:
const tableInfo = db.prepare("PRAGMA table_info(retrieval_quality)").all() as { name: string }[];
if (!tableInfo.some(c => c.name === "threshold_method")) {
  db.run("ALTER TABLE retrieval_quality ADD COLUMN threshold_method TEXT");
}
```

### Edge Case Tests (Critical)
```typescript
// src/learning/adaptive-threshold.test.ts

// K=0: empty array returns configured threshold
// K=1: single result uses percentile (below minCandidatesForGap)
// K=2: two results use percentile
// K=7: just below min, uses percentile
// K=8: exactly at min, uses max-gap
// All-same-distance: gap=0, falls back to configured
// Monotonically increasing with clear gap: finds the gap
// Two clusters with gap: threshold between clusters
// Threshold below floor (0.15): clamped to floor
// Threshold above ceiling (0.65): clamped to ceiling
// NaN/Infinity in input: handled gracefully
```

## State of the Art

| Old Approach | Current Approach (Phase 58) | When Changed | Impact |
|---|---|---|---|
| Fixed `distanceThreshold: 0.3` in config | Adaptive per-query threshold via max-gap detection | Phase 58 | Self-tuning retrieval; no more manual threshold calibration |
| Pre-rerank distance filtering (isolation.ts) | Post-rerank filtering (handler) | Phase 58 | Better candidates survive to threshold computation |
| No threshold method logging | `threshold_method` in retrieval_quality telemetry | Phase 58 | Enables A/B comparison vs Phase 56 baseline |

## Open Questions

1. **Should the isolation layer's internal topK be configurable or hard-coded?**
   - What we know: Currently `topK` is user-configurable (default 5). For adaptive thresholds, the isolation layer needs to fetch MORE candidates (e.g., 20) to detect the gap, then the final topK (5) is applied post-filter.
   - What's unclear: Whether to expose `internalTopK` as a config knob or hard-code it as `max(20, topK * 4)`.
   - Recommendation: Hard-code as `max(20, topK * 4)`. Users shouldn't need to think about the internal fetch size. The config `topK` controls "how many results appear in prompt context." This is a private implementation detail.

2. **How does the pipeline restructuring affect the isolation layer's `distanceThreshold` parameter?**
   - What we know: `isolation.ts` currently takes `distanceThreshold` and uses it to filter. Phase 58 needs to either: (a) remove the parameter and always return unfiltered results, or (b) keep the parameter but use it only when adaptive is disabled.
   - What's unclear: Whether to keep backward compatibility in the isolation layer API.
   - Recommendation: Keep the parameter but make it optional. When provided AND adaptive is disabled, use it as before. When adaptive is enabled, ignore it in the isolation layer (filter happens post-rerank). This preserves backward compatibility for any direct callers.

3. **Should adaptive threshold be the default or opt-in?**
   - What we know: The success criteria state "Kodiai applies max-gap detection" -- this implies it should be the default behavior.
   - What's unclear: Whether users with explicit `distanceThreshold` configs expect their value to be respected.
   - Recommendation: Default to adaptive=true. When a user explicitly sets `distanceThreshold` in `.kodiai.yml`, the configured value becomes the fallback but adaptive still applies. To force the old behavior, users would set `adaptive: false`. This matches the success criteria while preserving the configured value as a safety net.

## Sources

### Primary (HIGH confidence)
- `src/learning/isolation.ts` -- Current distance filtering at line 52, `distanceThreshold` parameter
- `src/learning/retrieval-rerank.ts` -- Language reranking pipeline, `RerankedResult` type
- `src/learning/retrieval-recency.ts` -- Recency weighting pipeline (Phase 57)
- `src/handlers/review.ts` -- Full retrieval pipeline wiring (lines 1679-1775)
- `src/execution/config.ts` -- `distanceThreshold` schema (line 259), default 0.3
- `src/telemetry/store.ts` -- `retrieval_quality` table schema, `recordRetrievalQuality()`
- `src/telemetry/types.ts` -- `RetrievalQualityRecord` type
- `.planning/research/PITFALLS.md` -- Pitfall 5: Adaptive threshold instability (line 471)
- `.planning/research/PITFALLS.md` -- Integration pitfall: adaptive thresholds + recency weighting ordering (line 458)
- `.planning/research/FEATURES.md` -- Adaptive thresholds priority and max-gap recommendation (line 245)
- `.planning/research/STACK.md` -- Kneedle algorithm as ~60-line pure TypeScript (line 17)
- `.planning/REQUIREMENTS.md` -- RET-03 requirement definition (line 23)

### Secondary (MEDIUM confidence)
- [Kneedle Algorithm Paper](https://www.researchgate.net/publication/224249192_Finding_a_Kneedle_in_a_Haystack_Detecting_Knee_Points_in_System_Behavior) -- Standard knee-point detection, validates max-gap as a simplification for small N
- [kneed Python Library](https://github.com/arvkevi/kneed) -- Reference implementation with sensitivity parameter

### Tertiary (LOW confidence)
- The specific `minGapSize: 0.05` value is a reasonable starting point but may need tuning based on production distance distributions from Phase 56 telemetry data.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing libraries
- Architecture: HIGH -- pipeline restructuring is well-understood from code review; ordering constraint from PITFALLS.md research
- Algorithm: HIGH -- max-gap is a trivial argmax over consecutive differences; percentile is index lookup
- Pitfalls: HIGH -- extensively documented in prior research (PITFALLS.md P5)
- Config/telemetry: HIGH -- follows existing additive-only patterns

**Research date:** 2026-02-15
**Valid until:** 2026-03-17
