---
estimated_steps: 55
estimated_files: 7
skills_used: []
---

# T02: Cache bounded mention derived context behind truthful state fingerprints

---
estimated_steps: 5
estimated_files: 5
skills_used:
  - test-driven-development
  - verify-before-complete
  - observability
---

# T02: Cache bounded mention derived context behind truthful state fingerprints

**Slice:** S04 — Retrieval Reuse and Safe Derived-Context Caching
**Milestone:** M061

## Description

Add a thin mention-side cache wrapper around the expensive derived-context seam. Cache only bounded derived artifacts already destined for prompt assembly, never raw mutable GitHub API payloads, and make identical-state hits observable and fail-open.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| GitHub issue/PR/review-comment APIs read during mention context assembly | cache wrapper must miss/rebuild and preserve the current fail-open section omission behavior | do not serve stale cached output when fresh fingerprint inputs are incomplete; prefer miss + rebuild | malformed comment/thread metadata should invalidate the cache key and force direct rebuild |
| `createSearchCache()` / in-memory cache bookkeeping | log degraded cache state, bypass cache, and build directly | do not block mention replies on cache lock/coalescing issues | ignore corrupt cached value shapes and rebuild |
| mention prompt builders consuming cached context | preserve section telemetry truth and prompt text parity between hit and miss for identical state | skip cache when timing/state makes fingerprint incomplete | reject mismatched cached artifact shapes |

## Load Profile

- **Shared resources**: GitHub API reads for mention thread/PR context and the per-process in-memory derived-context cache.
- **Per-operation cost**: repeated identical mention-state replies should avoid rebuilding bounded context/prompt artifacts and re-fetching admitted state.
- **10x breakpoint**: repeated webhook retries and conversational mention bursts on the same unchanged thread should benefit first; stale-key safety is more important than hit rate.

## Negative Tests

- **Malformed inputs**: missing comment ids, absent parent-thread metadata, or missing PR body/updated timestamps in fingerprint input.
- **Error paths**: cache read/write bookkeeping throws, GitHub parent lookup 404s, or finding lookup fails.
- **Boundary conditions**: identical state hits once, changed thread/comment/pr metadata misses, and different admission-policy caps or request shape produce separate keys.

## Steps

1. Introduce a stable fingerprint builder for the admitted mention state at the handler seam, including repo/surface/issue or PR identity, trigger comment identity/timestamps, admission-policy knobs, relevant thread comment ids with `updated_at`, and any PR/finding metadata that changes prompt meaning.
2. Wrap `buildMentionContextDetails()` and any safe downstream mention prompt artifact seam with `createSearchCache()`-style fail-open caching keyed by that fingerprint.
3. Surface truthful hit/miss/degraded status through existing telemetry/proof seams or explicit handler-observable metadata so tests and later reporting can inspect reuse.
4. Add mention handler/context/prompt regression tests for identical-state hit, changed-state miss, and cache-failure fallback.
5. Keep cached values bounded and derived; if a raw source object would need caching, stop and recompute instead.

## Must-Haves

- [ ] Identical mention state reuses bounded derived artifacts without changing prompt content or section metrics.
- [ ] Any thread/comment/PR/admission-policy drift produces a miss and rebuild rather than stale reuse.

## Verification

- `bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/handlers/mention.test.ts`
- Assert builder invocation counts and hit/miss/degraded markers in handler-level tests.

## Observability Impact

- Signals added/changed: truthful mention derived-cache hit/miss/degraded markers and stable fingerprint-driven reuse behavior.
- How a future agent inspects this: mention handler tests plus canonical telemetry/verifier additions from T04.
- Failure state exposed: cache unavailable, key drift, and direct rebuild become distinguishable rather than collapsing into silent misses.

## Inputs

- `src/handlers/mention.ts` — orchestration seam where mention context and prompts are built
- `src/execution/mention-context.ts` — bounded derived context builder whose admitted state shapes the fingerprint
- `src/execution/mention-prompt.ts` — prompt builder consuming mention context artifacts
- `src/lib/search-cache.ts` — canonical fail-open in-memory cache/key pattern to reuse
- `src/handlers/mention.test.ts` — main regression harness for mention flow behavior

## Expected Output

- `src/handlers/mention.ts` — mention derived-cache wrapper, fingerprinting, and truthful reuse signals
- `src/execution/mention-context.ts` — helper exports if fingerprint/build seams need to be shared
- `src/execution/mention-prompt.ts` — safe cached artifact consumption if needed
- `src/handlers/mention.test.ts` — identical-state hit, changed-state miss, and cache-failure fallback coverage
- `src/execution/mention-context.test.ts` — fingerprint-sensitive context-builder or helper coverage where needed

## Inputs

- ``src/handlers/mention.ts``
- ``src/execution/mention-context.ts``
- ``src/execution/mention-prompt.ts``
- ``src/lib/search-cache.ts``
- ``src/handlers/mention.test.ts``

## Expected Output

- ``src/handlers/mention.ts``
- ``src/execution/mention-context.ts``
- ``src/execution/mention-prompt.ts``
- ``src/handlers/mention.test.ts``
- ``src/execution/mention-context.test.ts``

## Verification

bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/handlers/mention.test.ts

## Observability Impact

Mention cache reuse should produce explicit hit/miss/degraded evidence that later scripts can inspect through canonical surfaces.
