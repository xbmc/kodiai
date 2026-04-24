---
estimated_steps: 55
estimated_files: 5
skills_used: []
---

# T03: Reuse review prompt artifacts safely across identical review state

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

## Inputs

- ``src/handlers/review.ts``
- ``src/execution/review-prompt.ts``
- ``src/lib/search-cache.ts``
- ``src/handlers/review.test.ts``
- ``src/execution/review-prompt.test.ts``

## Expected Output

- ``src/handlers/review.ts``
- ``src/execution/review-prompt.ts``
- ``src/handlers/review.test.ts``
- ``src/execution/review-prompt.test.ts``
- ``src/lib/search-cache.ts``

## Verification

bun test src/execution/review-prompt.test.ts src/handlers/review.test.ts

## Observability Impact

Review reuse must remain inspectable through prompt-section parity and explicit hit/miss/degraded proof signals.
