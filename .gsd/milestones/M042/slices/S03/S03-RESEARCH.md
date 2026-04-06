# S03 Research — Cache, Fallback, and Regression Hardening

## Summary
S03 is targeted work. The core behavior already exists in three places: `resolveAuthorTierFromSources()` in `src/handlers/review.ts`, surface rendering in `src/execution/review-prompt.ts` and `src/lib/review-utils.ts`, and low-fidelity fallback classification in `src/lib/author-classifier.ts`. The main risk is taxonomy drift across persistence layers: contributor profiles are truthful 4-tier (`newcomer|developing|established|senior`), while `author_cache` stores an untyped string currently populated from the fallback 3-tier classifier (`first-time|regular|core`). That means cache reuse can preserve a lower-fidelity label for up to 24h when profile lookup is absent, even though the render surfaces already understand both taxonomies.

The handler already prefers contributor profile over cache over fallback, and the retry path reuses `authorClassification.tier` when rebuilding `buildReviewPrompt()`. So the likely S03 work is not broad architecture change. It is hardening the cache/fallback contract and expanding proof coverage so stale cache or degraded fallback cannot silently reintroduce newcomer/developing wording in CrystalP-shaped or adjacent cases.

## Requirement Focus
Relevant M042 requirements from context:
- `R039` — truthful stored tier advancement was handled in S01, but S03 still depends on it because cache/fallback must not mask corrected persisted state.
- `R040` — S02 covered render surfaces; S03 must keep those truthful under cache reuse and degraded fallback execution.
- `R041` — primary S03 ownership. Cache and fallback must not preserve contradictory labels.
- `R042` — regression coverage must include the real repro plus adjacent contributor-history cases.

## Recommendation
Treat S03 as three small seams:
1. **Author-tier source/cache hardening in `src/handlers/review.ts`**
   - Inspect and likely adjust `resolveAuthorClassification()` around lines ~445–611.
   - Today it returns contributor-profile immediately when available, otherwise returns cached `author_cache.tier`, otherwise runs fallback search/classification and writes that 3-tier result back to cache.
   - Natural hardening seam: make cache reuse explicit about fidelity/provenance, or normalize cache behavior so a stale fallback tier cannot outrank a higher-fidelity source later in the same run.
2. **Focused regression coverage in `src/handlers/review.test.ts`**
   - Existing tests already cover search-cache reuse, concurrent coalescing, rate-limit degradation, and direct cache fallback.
   - Missing from current proof surface: user-visible truthfulness assertions when the source is `author-cache` or `fallback`, especially for cases that should stay out of newcomer wording.
3. **A new slice verifier `scripts/verify-m042-s03.ts` + test + package script**
   - S01 verifier proves persisted-tier truth and precedence.
   - S02 verifier proves established-tier render truth when contributor-profile wins.
   - S03 should compose production seams for cache-hit and degraded-fallback cases, plus at least one handler-level retry/orchestration path if feasible.

## Implementation Landscape

### 1. `src/handlers/review.ts`
Relevant seam: `resolveAuthorClassification()`.

What it does now:
- Reads contributor profile first via `contributorProfileStore.getByGithubUsername()` and, if found, returns `profile.overallTier` immediately before any cache or fallback use.
- Reads `knowledgeStore.getAuthorCache()` and feeds `contributorTier`, `cachedTier`, and fallback default into `resolveAuthorTierFromSources()`.
- If neither profile nor cache yields a tier, performs ambiguous-association GitHub Search enrichment, then calls `classifyAuthor()` from `src/lib/author-classifier.ts`.
- Writes that fallback result into `author_cache` via `knowledgeStore.upsertAuthorCache()`.

Constraint worth keeping in mind:
- `author_cache.tier` is just `string` in `src/knowledge/types.ts` / `src/knowledge/store.ts`. It is read if `cached_at >= now() - interval '24 hours'`; stale rows are purged after 7 days.
- Because the cache stores fallback taxonomy values (`first-time|regular|core`), the render layers must keep dual-taxonomy mapping forever unless the cache contract is narrowed.

Natural task boundary:
- Any cache/fallback logic change should stay local to `resolveAuthorClassification()` and `resolveAuthorTierFromSources()` plus tests. No need to spread changes into scorer/profile code.

### 2. `src/lib/author-classifier.ts`
This is still the low-fidelity fallback source.

Current mapping:
- `MEMBER|OWNER -> core`
- `FIRST_TIMER|FIRST_TIME_CONTRIBUTOR -> first-time`
- PR count `<=1 -> first-time`, `<=9 -> regular`, else `core`
- collaborator/contributor without PR count -> `regular`
- default -> `first-time`

Implication for S03:
- If a contributor lacks profile data, fallback truthfulness is limited to this heuristic. S03 should preserve truthful behavior without pretending this classifier knows `established`.
- That argues for explicit regression wording around “avoid contradictory newcomer labeling when higher-fidelity state exists or cache is reused”, not “invent established tier from fallback alone”.

### 3. `src/execution/review-prompt.ts`
Relevant seam: `buildAuthorExperienceSection()`.

Current taxonomy mapping:
- `first-time|newcomer` => newcomer copy
- `regular|developing` => developing copy
- `established` => established copy
- `core|senior` => senior copy

This already implements the dual-taxonomy bridge correctly. Existing tests in `src/execution/review-prompt.test.ts` assert full-body required/banned phrases for established/senior output. That matches the project rule from M028/S03/T02: assert against the full rendered body, not proxy fields.

S03 use:
- Probably no product logic change needed here unless cache normalization changes author-tier inputs.
- More likely this file participates in verifier coverage only.

### 4. `src/lib/review-utils.ts`
Relevant seam: `formatReviewDetailsSummary()`.

Current author-tier line:
- `first-time|newcomer => newcomer guidance`
- `regular|developing|undefined => developing guidance`
- `established => established contributor guidance`
- `core|senior => senior contributor guidance`

Tests in `src/lib/review-utils.test.ts` already lock the truthful label mapping for default/established/senior. Same conclusion as prompt code: likely no heavy logic change needed, but this surface should be included in S03 regression proof for cache/fallback scenarios.

### 5. `src/lib/search-cache.ts`
The search cache is already isolated and fail-open.

Established pattern:
- `createSearchCache()` supports TTL, in-flight coalescing, and `onError` fail-open callback.
- `getOrLoad()` dedupes concurrent equivalent lookups.
- Handler tests already prove cache reuse and concurrent coalescing.

Implication for S03:
- Do not rewrite this module unless the slice specifically needs provenance or invalidation semantics that cannot be handled in `review.ts`.
- Existing tests around it are a good foundation for task verification.

### 6. `src/handlers/review.test.ts`
This file already contains the best scaffolding for S03.

Relevant existing coverage:
- `resolveAuthorTierFromSources` precedence tests near the top.
- `createReviewHandler author-tier search cache integration` block around line ~6407.
- Tests for:
  - equivalent-event cache reuse
  - concurrent lookup coalescing
  - broken cache fallback to direct lookup
  - one retry on Search API rate limit
  - degraded prompt disclaimer insertion
  - degraded published-summary disclosure insertion
  - degraded path continuing when telemetry fails
  - a direct `getAuthorCache()` scenario around line ~7220 using tier `regular`

What appears missing for S03:
- Truthfulness assertions on the actual rendered prompt/details body when the source is `author-cache` rather than contributor profile.
- Adjacent contributor-history cases that exercise the dual taxonomy intentionally, e.g. cached `core` => senior wording, cached `regular` => developing wording, and degraded fallback path with no contradictory contributor-profile state.
- Potentially one handler retry-path assertion that a timed-out rerun still threads the same `authorClassification.tier` into `buildReviewPrompt()`.

### 7. Verifier pattern from S01/S02
- `scripts/verify-m042-s01.ts` = source-of-truth/persistence/precedence proof.
- `scripts/verify-m042-s02.ts` = render-surface truthfulness proof using production seams.

Best S03 shape is another deterministic harness that composes production seams rather than duplicating handler logic. The project has an established verifier pattern: stable check IDs, required-phrase and banned-phrase assertions, JSON/text output, and test overrides when needed.

## Suggested Tasks

### Task 1 — Cache/fallback contract audit and minimal hardening
Files:
- `src/handlers/review.ts`
- possibly `src/knowledge/types.ts` / `src/knowledge/store.ts` only if provenance or normalization must be persisted

Goal:
- Ensure cache reuse and fallback cannot silently override higher-fidelity profile truth in-run.
- If needed, make the cache contract more explicit rather than relying on generic `string` tier storage.

What to inspect/build first:
- The exact read/write contract in `resolveAuthorClassification()`.
- Whether a contributor-profile miss followed by cached low-fidelity tier should remain accepted as-is, or whether some normalization/provenance field is needed.

Risk:
- Over-fixing this into a schema change may be unnecessary. Start with the smallest local change in `review.ts` that strengthens truthfulness and observability.

### Task 2 — Handler-level regression expansion
Files:
- `src/handlers/review.test.ts`

Goal:
- Add tests that prove user-visible prompt truthfulness and/or prompt capture under cache-hit and degraded-fallback scenarios.

Most valuable additions:
- Cached `core` renders senior-style prompt copy, not newcomer/developing copy.
- Cached `regular` renders developing copy and never claims established/senior.
- Contributor-profile tier still wins over contradictory cached fallback tier in a real handler scenario, not just the pure helper.
- Retry path continues to use the same resolved tier when rebuilding `retryPrompt`.

### Task 3 — Slice proof harness
Files:
- `scripts/verify-m042-s03.ts`
- `scripts/verify-m042-s03.test.ts`
- `package.json`

Recommended checks:
1. `CACHE-HIT-SURFACE-TRUTHFUL` — cached `core` or `regular` maps to the correct surface wording with banned-phrase guards.
2. `PROFILE-OVERRIDES-CONTRADICTORY-CACHE` — contributor-profile `established` beats cached `first-time` in both prompt and details.
3. `DEGRADED-FALLBACK-NONCONTRADICTORY` — rate-limited fallback adds the API-limit disclosure but does not invent higher-fidelity tiers or regress a known higher-fidelity one.
4. `RETRY-PATH-PRESERVES-RESOLVED-TIER` — if feasible via existing handler seam; otherwise keep this as a focused handler test rather than verifier check.

## Verification
Expected command set for S03 planning:
- `bun test ./src/handlers/review.test.ts`
- `bun test ./scripts/verify-m042-s03.test.ts`
- `bun run verify:m042:s01`
- `bun run verify:m042:s02`
- `bun run verify:m042:s03`
- `bun run tsc --noEmit`

Why rerun S01/S02:
- S03 touches the same precedence and render seams. Per project knowledge, milestone/slice closure should rerun existing proof harnesses when later slices modify shared contracts.

## Skill Discovery
Installed skills directly relevant to this slice:
- None required beyond normal code/test work. This is Bun + TypeScript + existing codebase patterns.

No additional external skill search is warranted. The slice does not depend on a new framework or service; it is internal logic and regression hardening.

## Notes for Planner
- This is not a broad subsystem refactor. Keep tasks narrow and verification-heavy.
- Follow the established pattern from S02 and M028: assert on full rendered bodies with required/banned phrases, not on intermediate metadata only.
- Prefer production-seam composition in the verifier (`resolveAuthorTierFromSources`, `buildReviewPrompt`, `formatReviewDetailsSummary`) and use handler tests for orchestration-only behavior like cache hits, degradation, and retry prompt rebuilds.
- If you need to change persistence, do it only with a clear contract win. Right now the highest-leverage work looks test-first with minimal handler hardening, not a migration.