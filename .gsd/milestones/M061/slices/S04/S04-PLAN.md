# S04: Retrieval Reuse and Safe Derived-Context Caching

**Goal:** Eliminate duplicate same-query embedding work inside a single retrieval run and safely reuse bounded mention/review derived-context artifacts only when explicit state fingerprints prove the source state is unchanged.
**Demo:** retrieval avoids same-query duplicate embedding work and repeated identical thread/review state can reuse bounded derived artifacts through truthful cache keys.

## Must-Haves

- `src/knowledge/retrieval.ts` reuses one query embedding per unique normalized query/provider/input-type pair within a retrieval call, preserving existing result ordering and fail-open behavior.
- Mention handling reuses cached bounded derived context or prompt artifacts only when the cache key fingerprints the admitted GitHub state that actually feeds the builder; changed thread/comment/PR state must miss and rebuild.
- Review handling reuses cached bounded prompt-build artifacts only when PR head/base/file-set/profile/retrieval-derived state fingerprints match exactly; reduced-scope retry and changed state must miss.
- Cache hits, misses, and degraded fail-open paths remain truthful and inspectable through existing telemetry/proof seams rather than hidden in ad hoc logs.
- Fresh regression coverage proves identical-state hits, changed-state misses, and cache-failure fallbacks in `src/knowledge/retrieval.test.ts`, `src/knowledge/retrieval.e2e.test.ts`, `src/handlers/mention.test.ts`, `src/handlers/review.test.ts`, and `scripts/verify-m061-s04.test.ts`.
- ### Threat Surface
- **Abuse**: replayed webhook deliveries or repeated explicit-review mentions must not reuse stale prompt state when thread, PR head, or admitted inputs changed; weak keys would misground outputs.
- **Data exposure**: caches may hold only bounded derived text/metrics already destined for the model prompt path; raw mutable GitHub API payloads, secrets, and unbounded thread state must not be cached.
- **Input trust**: GitHub comment bodies, PR metadata, changed-file lists, retrieval outputs, and finding metadata are untrusted and must be normalized/fingerprinted before cache use.
- ### Requirement Impact
- **Requirements touched**: roadmap-owned R057, R060; strengthens operator-evidence expectations from R068 and normal-path regression expectations from R069.
- **Re-verify**: mention conversational responses, explicit `@kodiai review` mention flow, normal review path, reduced-scope retry path, and canonical usage-report/verifier behavior under fail-open DB access.
- **Decisions revisited**: D175, D176, D177, D178.

## Proof Level

- This slice proves: - This slice proves: contract + integration.
- Contract: retrieval embedding reuse keys are deterministic, derived-cache fingerprints miss on state drift, and fail-open fallback preserves truthful behavior.
- Integration: mention/review handlers reuse cached bounded derived artifacts without changing prompt-section truth, and the canonical verifier/report surfaces can distinguish reuse from degraded fallback.
- Real runtime required: no.
- Human/UAT required: no.

## Integration Closure

- Upstream surfaces consumed: `src/knowledge/retrieval.ts`, `src/knowledge/multi-query-retrieval.ts`, `src/lib/search-cache.ts`, `src/execution/mention-context.ts`, `src/execution/mention-prompt.ts`, `src/execution/review-prompt.ts`, `src/handlers/mention.ts`, `src/handlers/review.ts`, `src/telemetry/store.ts`, and `scripts/usage-report.ts`.
- New wiring introduced in this slice: retriever-local embedding memoization, mention/review handler cache wrappers with truthful fingerprints, and S04 proof/report checks that surface reuse/fail-open behavior through canonical inspection paths.
- What remains before the milestone is truly usable end-to-end: S05 still needs representative integrated token-reduction proof and final regression gating across mention/review flows.

## Verification

- Slice verification: `bun test src/knowledge/retrieval.test.ts src/knowledge/retrieval.e2e.test.ts src/knowledge/multi-query-retrieval.test.ts`
- Slice verification: `bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/handlers/mention.test.ts`
- Slice verification: `bun test src/execution/review-prompt.test.ts src/handlers/review.test.ts scripts/usage-report.test.ts scripts/verify-m061-s04.test.ts && bun scripts/verify-m061-s04.ts --json`
- Slice verification: `bun run lint`
- ### Observability / Diagnostics
- Runtime signals: retrieval reuse counters/provenance plus truthful cache hit/miss/degraded markers for mention/review derived-context reuse.
- Inspection surfaces: canonical telemetry writes consumed by `scripts/usage-report.ts`, the S04 verifier, and focused handler/retrieval regression tests.
- Failure visibility: tests and verifier must distinguish cache miss vs cache unavailable vs recompute-after-fingerprint-drift, rather than collapsing everything into a silent miss.
- Redaction constraints: preserve the text-free telemetry pattern and never persist raw secret-bearing GitHub payloads or prompt bodies.

## Tasks

- [x] **T01: Add request-scoped query-embedding reuse in the retriever** `est:4h`
  ---
estimated_steps: 4
estimated_files: 4
skills_used:
  - test-driven-development
  - verify-before-complete
---

# T01: Add request-scoped query-embedding reuse in the retriever

**Slice:** S04 — Retrieval Reuse and Safe Derived-Context Caching
**Milestone:** M061

## Description

Remove duplicate embedding generation inside one `createRetriever().retrieve()` call. Reuse the existing normalized retrieval-variant shape instead of inventing a second normalization path, and keep all corpus searches fail-open.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `EmbeddingProvider.generate()` | log fail-open and continue with empty/partial retrieval results rather than crashing the whole review/mention flow | preserve existing retrieval timeout/failure behavior; no retry loop in this slice | treat `null` or unusable embeddings as a miss and skip that variant/corpus |
| `IsolationLayer.retrieveWithIsolation()` and corpus search helpers | preserve per-search fail-open warnings and continue with other corpora | keep request-scoped memoization in-memory only so hung downstream work does not poison later requests | do not cache malformed embeddings/results; recompute or skip |

## Load Profile

- **Shared resources**: embedding provider rate budget and per-request memory for the short-lived embedding map.
- **Per-operation cost**: one embedding per unique normalized query/provider pair instead of one embedding per repeated corpus/query path.
- **10x breakpoint**: duplicate embedding calls and provider latency should shrink first; memory growth stays bounded by the small variant/corpus fan-out in one request.

## Negative Tests

- **Malformed inputs**: duplicate queries with whitespace/casing variation, repeated identical single-query calls, and empty query arrays.
- **Error paths**: embedding provider throws/nulls for one or all queries while retrieval still returns partial or empty fail-open results.
- **Boundary conditions**: repeated normalized variant strings across intent/file-path/code-shape paths should reuse exactly once per request.

## Steps

1. Add a request-scoped embedding helper in `src/knowledge/retrieval.ts` keyed by normalized query text, input type, and provider/model identity; route learning-memory and corpus vector searches through it.
2. Reuse existing multi-query normalization outputs where possible and dedupe repeated normalized query strings without changing caller-visible ordering.
3. Extend provenance or helper-return metadata so tests can prove reuse happened without inventing a separate reporting subsystem.
4. Add focused regression tests for call counts, duplicate normalized variants, and fail-open cache-bookkeeping faults.

## Must-Haves

- [ ] One retrieval run performs at most one embedding request per unique normalized query/provider/input-type pair.
- [ ] Existing retrieval ordering, fail-open semantics, and unified-results behavior remain unchanged apart from reduced duplicate embedding work.

## Verification

- `bun test src/knowledge/retrieval.test.ts src/knowledge/retrieval.e2e.test.ts src/knowledge/multi-query-retrieval.test.ts`
- Assert embedding-provider invocation counts directly in regression tests.

## Observability Impact

- Signals added/changed: retriever provenance or internal helper state can prove embedding reuse vs recompute.
- How a future agent inspects this: focused retrieval tests and any provenance fields returned by `retrieve()`.
- Failure state exposed: duplicate-embedding regressions show up as call-count failures rather than silent prompt-cost drift.

## Inputs

- `src/knowledge/retrieval.ts` — primary retrieval seam where duplicate embeddings are currently generated
- `src/knowledge/multi-query-retrieval.ts` — canonical normalized variant builder to reuse instead of re-deriving keys
- `src/knowledge/retrieval.test.ts` — focused unit coverage for retriever behavior
- `src/knowledge/retrieval.e2e.test.ts` — broader regression coverage for multi-corpus retrieval behavior

## Expected Output

- `src/knowledge/retrieval.ts` — request-scoped embedding memoization and truthful provenance
- `src/knowledge/retrieval.test.ts` — embedding reuse and fail-open regression tests
- `src/knowledge/retrieval.e2e.test.ts` — integration-level reuse coverage where needed
- `src/knowledge/multi-query-retrieval.test.ts` — normalization/dedup expectations if helper reuse changes the boundary
  - Files: `src/knowledge/retrieval.ts`, `src/knowledge/multi-query-retrieval.ts`, `src/knowledge/retrieval.test.ts`, `src/knowledge/retrieval.e2e.test.ts`, `src/knowledge/multi-query-retrieval.test.ts`
  - Verify: bun test src/knowledge/retrieval.test.ts src/knowledge/retrieval.e2e.test.ts src/knowledge/multi-query-retrieval.test.ts

- [ ] **T02: Cache bounded mention derived context behind truthful state fingerprints** `est:4h`
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
  - Files: `src/handlers/mention.ts`, `src/execution/mention-context.ts`, `src/execution/mention-prompt.ts`, `src/lib/search-cache.ts`, `src/handlers/mention.test.ts`, `src/execution/mention-context.test.ts`, `src/execution/mention-prompt.test.ts`
  - Verify: bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/handlers/mention.test.ts

- [ ] **T03: Reuse review prompt artifacts safely across identical review state** `est:4h`
  ---
estimated_steps: 5
estimated_files: 5
skills_used:
  - test-driven-development
  - verify-before-complete
  - observability
---

# T03: Reuse review prompt artifacts safely across identical review state

**Slice:** S04 — Retrieval Reuse and Safe Derived-Context Caching
**Milestone:** M061

## Description

Cache the pure, bounded review prompt-build artifact behind a truthful fingerprint that includes PR state, changed-file scope, review profile knobs, and retrieval-derived inputs. Preserve normal review publication semantics and ensure reduced-scope retry naturally misses when its scope differs.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| PR metadata / diff context / retrieval-derived inputs feeding `buildReviewPromptDetails()` | bypass cache and rebuild directly; never publish from a weak or partial key | timeout should preserve existing review fail-open/retry behavior and skip cache reuse | malformed changed-file or retrieval fingerprints must invalidate the key and force direct build |
| cache bookkeeping / in-flight coalescing | degrade to direct prompt build and preserve truthful diagnostics | no indefinite wait on in-flight entry; direct rebuild is acceptable | discard invalid cached prompt artifact shapes and rebuild |
| retry-path wiring in `src/handlers/review.ts` | reduced-scope retry must miss naturally when file scope or boundedness contract changes | direct build remains the fallback for degraded paths | preserve section metrics and prompt parity between cache hit and recompute |

## Load Profile

- **Shared resources**: repeated PR metadata/diff/prompt assembly work for identical review state and the in-memory per-process derived cache.
- **Per-operation cost**: identical review requests should skip rebuilding the bounded review prompt artifact while still reusing existing handler flow/publish behavior.
- **10x breakpoint**: replayed deliveries and repeated explicit-review requests on the same unchanged PR should benefit; hit rate should not compromise state truthfulness.

## Negative Tests

- **Malformed inputs**: missing head/base sha, empty changed-file list, missing retrieval fingerprint data, or malformed profile knobs.
- **Error paths**: cache read/write throws, retrieval-derived fingerprint generation fails, or retry-path data is unavailable.
- **Boundary conditions**: identical state hits, changed changed-files or head sha misses, reduced-scope retry misses, and cached hit preserves section/truncation metrics.

## Steps

1. Build a stable review prompt fingerprint at the handler seam that covers repo/PR identity, base/head refs or SHAs, changed file list, review profile knobs, custom instructions, boundedness/retry scope, and retrieval-derived inputs that alter prompt meaning.
2. Wrap `buildReviewPromptDetails()` with a fail-open derived cache using the existing search-cache keying pattern.
3. Ensure initial and reduced-scope retry flows consume the cached artifact safely, with retry naturally missing when its narrowed file set or state differs.
4. Preserve the `review.user-prompt` prompt-section contract so hit vs miss records remain truthful and equivalent for identical state.
5. Add review handler/prompt tests for cache hit, cache miss on state drift, retry miss, and degraded cache fallback.

## Must-Haves

- [ ] Identical review state reuses the bounded prompt artifact without changing publication semantics or prompt-section telemetry.
- [ ] Retry scope changes, head/file drift, or fingerprint gaps miss cleanly and rebuild.

## Verification

- `bun test src/execution/review-prompt.test.ts src/handlers/review.test.ts`
- Assert prompt-builder invocation counts plus identical section/truncation metrics on hit vs miss.

## Observability Impact

- Signals added/changed: truthful review derived-cache hit/miss/degraded markers and equivalent prompt-section metrics on reuse.
- How a future agent inspects this: review handler/prompt tests and the canonical S04 verifier/report additions.
- Failure state exposed: retry miss, fingerprint drift, and cache-unavailable fallback remain distinguishable in tests/proof output.

## Inputs

- `src/handlers/review.ts` — main review orchestration seam and retry path
- `src/execution/review-prompt.ts` — pure bounded prompt builder suitable for derived caching
- `src/lib/search-cache.ts` — canonical fail-open cache/key pattern
- `src/handlers/review.test.ts` — integration regression harness for initial and retry review flows
- `src/execution/review-prompt.test.ts` — prompt artifact contract coverage

## Expected Output

- `src/handlers/review.ts` — review derived-cache wrapper, truthful fingerprinting, and reuse signals
- `src/execution/review-prompt.ts` — helper exports if fingerprint/build seams need sharing
- `src/handlers/review.test.ts` — hit/miss/retry/degraded cache regression tests
- `src/execution/review-prompt.test.ts` — prompt-build parity coverage for cached reuse
- `src/lib/search-cache.ts` — only if a small generic helper is extracted for safe derived-cache usage
  - Files: `src/handlers/review.ts`, `src/execution/review-prompt.ts`, `src/lib/search-cache.ts`, `src/handlers/review.test.ts`, `src/execution/review-prompt.test.ts`
  - Verify: bun test src/execution/review-prompt.test.ts src/handlers/review.test.ts

- [ ] **T04: Prove reuse and degraded fallback through canonical reporting surfaces** `est:3h`
  ---
estimated_steps: 4
estimated_files: 4
skills_used:
  - verify-before-complete
  - observability
---

# T04: Prove reuse and degraded fallback through canonical reporting surfaces

**Slice:** S04 — Retrieval Reuse and Safe Derived-Context Caching
**Milestone:** M061

## Description

Close the loop by making reuse evidence inspectable through the same operator-facing proof/report surfaces established in S01-S03. Add an S04 verifier and any minimal reporting/test updates needed so cache hits, misses, and degraded fallback are observable without inventing a parallel debug path.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/usage-report.ts` Postgres query layer | verifier must fail open with explicit access-state output | preserve the bounded timeout/shutdown behavior from S03 | treat missing rows as proof failure only when DB access is available |
| cache/reuse telemetry emitted by handlers | verifier should report missing evidence explicitly instead of inferring success | do not block on unavailable DB access; return fail-open preflight | malformed reuse evidence should fail the verifier test suite |
| new S04 proof script | surface why proof failed (missing rows, degraded-only evidence, unavailable DB) without hanging | reuse existing timeout behavior | reject ambiguous results rather than silently passing |

## Steps

1. Decide the minimal canonical evidence shape for S04 reuse (for example prompt-section-compatible markers, existing telemetry rows, or usage-report query extensions) without creating a second reporting path.
2. Extend `scripts/usage-report.ts` and tests only as needed so mention/review/retrieval reuse evidence is queryable alongside existing prompt/cache reporting.
3. Add `scripts/verify-m061-s04.ts` and `scripts/verify-m061-s04.test.ts` to prove retrieval reuse and derived-cache truthfulness with fail-open Postgres handling.
4. Keep the verifier aligned with the implementation tests: identical-state reuse evidence should pass, stale/missing/degraded states should be explicit.

## Must-Haves

- [ ] Operators can rerun one canonical S04 proof command and see whether reuse evidence is available, missing, or degraded.
- [ ] The proof surface stays aligned with existing usage-report/query layers instead of duplicating telemetry logic.

## Verification

- `bun test scripts/usage-report.test.ts scripts/verify-m061-s04.test.ts`
- `bun scripts/verify-m061-s04.ts --json`

## Observability Impact

- Signals added/changed: operator-visible reuse/fallback evidence on canonical report/verifier paths.
- How a future agent inspects this: `scripts/usage-report.ts` and `scripts/verify-m061-s04.ts --json`.
- Failure state exposed: unavailable Postgres, missing reuse evidence, and degraded cache fallback become explicit verdict inputs.

## Inputs

- `scripts/usage-report.ts` — canonical telemetry report/query layer
- `scripts/usage-report.test.ts` — report contract coverage
- `src/handlers/mention.ts` — source of mention reuse evidence
- `src/handlers/review.ts` — source of review reuse evidence
- `src/knowledge/retrieval.ts` — source of retrieval reuse evidence

## Expected Output

- `scripts/verify-m061-s04.ts` — slice verifier for reuse/fail-open evidence
- `scripts/verify-m061-s04.test.ts` — verifier regression coverage
- `scripts/usage-report.ts` — minimal canonical reporting updates if needed
- `scripts/usage-report.test.ts` — updated report coverage for any new reuse evidence rows
  - Files: `scripts/usage-report.ts`, `scripts/usage-report.test.ts`, `scripts/verify-m061-s04.ts`, `scripts/verify-m061-s04.test.ts`, `src/handlers/mention.ts`, `src/handlers/review.ts`, `src/knowledge/retrieval.ts`
  - Verify: bun test scripts/usage-report.test.ts scripts/verify-m061-s04.test.ts && bun scripts/verify-m061-s04.ts --json

## Files Likely Touched

- src/knowledge/retrieval.ts
- src/knowledge/multi-query-retrieval.ts
- src/knowledge/retrieval.test.ts
- src/knowledge/retrieval.e2e.test.ts
- src/knowledge/multi-query-retrieval.test.ts
- src/handlers/mention.ts
- src/execution/mention-context.ts
- src/execution/mention-prompt.ts
- src/lib/search-cache.ts
- src/handlers/mention.test.ts
- src/execution/mention-context.test.ts
- src/execution/mention-prompt.test.ts
- src/handlers/review.ts
- src/execution/review-prompt.ts
- src/handlers/review.test.ts
- src/execution/review-prompt.test.ts
- scripts/usage-report.ts
- scripts/usage-report.test.ts
- scripts/verify-m061-s04.ts
- scripts/verify-m061-s04.test.ts
