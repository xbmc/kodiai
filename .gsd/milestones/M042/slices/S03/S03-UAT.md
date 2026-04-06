# S03: Cache, Fallback, and Regression Hardening — UAT

**Milestone:** M042
**Written:** 2026-04-06T23:11:55.392Z

# S03: Cache, Fallback, and Regression Hardening — UAT

**Milestone:** M042
**Written:** 2026-04-06

## UAT Type

- UAT mode: artifact-driven plus deterministic handler/proof-harness reruns
- Why this mode is sufficient: This slice changed author-tier cache normalization, degraded/retry-path rendering behavior, and regression proof surfaces. The acceptance contract is best proven through stable handler tests and the named slice verifiers rather than a live GitHub review mutation.

## Preconditions

- Repository is at the M042/S03 slice-complete state.
- Bun dependencies are installed.
- No live GitHub, Slack, or database access is required for this UAT.

## Smoke Test

Run:

```bash
bun run verify:m042:s03
```

**Expected:** The command exits 0 and prints three PASS lines for:
- `M042-S03-CACHE-HIT-SURFACE-TRUTHFUL`
- `M042-S03-PROFILE-OVERRIDES-CONTRADICTORY-CACHE`
- `M042-S03-DEGRADED-FALLBACK-NONCONTRADICTORY`

## Test Cases

### 1. Unsupported cached tiers are ignored instead of overclaiming contributor seniority

1. Run:
   ```bash
   bun test ./src/handlers/review.test.ts
   ```
2. Inspect the passing output for `resolveAuthorTierFromSources > cached author tiers are limited to fallback taxonomy values` and `createReviewHandler author-tier search cache integration > ignores unsupported cached contributor tiers and falls back to live classification`.
3. **Expected:** The suite passes, proving cached values outside `first-time`, `regular`, and `core` are not trusted and do not produce established/senior contributor wording.

### 2. Cache-hit path keeps truthful senior-style wording for cached `core`

1. Run:
   ```bash
   bun test ./src/handlers/review.test.ts
   ```
2. Inspect the passing output for `createReviewHandler author-tier search cache integration > cached core tier keeps senior-style handler wording on cache hits`.
3. **Expected:** The rendered handler output contains senior-style wording appropriate for fallback-taxonomy `core`, and does not contain newcomer, developing, or established-only contradictory phrases.

### 3. Cached `regular` stays developing without overclaiming

1. Run:
   ```bash
   bun test ./src/handlers/review.test.ts
   ```
2. Inspect the passing output for `createReviewHandler auto profile selection > cached regular tier keeps developing wording without overclaiming`.
3. **Expected:** The rendered handler output keeps developing guidance for `regular` and does not drift upward into established or senior wording.

### 4. Contributor-profile state beats contradictory cached low-tier data in a real handler execution

1. Run:
   ```bash
   bun test ./src/handlers/review.test.ts
   ```
2. Inspect the passing output for `createReviewHandler author-tier search cache integration > contributor profile established tier beats contradictory cached low-tier data in handler output`.
3. **Expected:** The real handler path resolves author tier from contributor-profile state and the rendered output stays established, not newcomer/developing, even when cache data disagrees.

### 5. Degraded retry path preserves the same resolved author tier and disclosure

1. Run:
   ```bash
   bun test ./src/handlers/review.test.ts
   ```
2. Inspect the passing output for `createReviewHandler author-tier search cache integration > degraded retry path keeps resolved established tier in rebuilt prompt output` and `injects exactly one degraded disclosure sentence into published summary output`.
3. **Expected:** The retry/degraded path rebuilds prompt output with the same established contributor tier and includes exactly one Search API degradation disclosure sentence.

### 6. Slice proof harness locks the remaining cache/fallback truthfulness contract

1. Run:
   ```bash
   bun run verify:m042:s03
   ```
2. Confirm the printed checks and final verdict.
3. **Expected:**
   - Exit code 0
   - Final verdict `PASS`
   - `M042-S03-CACHE-HIT-SURFACE-TRUTHFUL` reports `resolvedSource=author-cache resolvedTier=core`
   - `M042-S03-PROFILE-OVERRIDES-CONTRADICTORY-CACHE` reports `resolvedSource=contributor-profile resolvedTier=established`
   - `M042-S03-DEGRADED-FALLBACK-NONCONTRADICTORY` reports `resolvedSource=fallback resolvedTier=regular disclosurePresent=true`

### 7. Harness tests prove failures are real, not just happy-path fixtures

1. Run:
   ```bash
   bun test ./scripts/verify-m042-s03.test.ts
   ```
2. Inspect the negative tests for each proof check.
3. **Expected:**
   - Exit code 0
   - The suite includes targeted failing-fixture tests showing the harness goes red when cache-hit output regresses to developing guidance, contradictory cache beats contributor-profile state, or degraded fallback drops disclosure / becomes self-contradictory.

### 8. Earlier M042 proof surfaces still pass after S03 hardening

1. Run:
   ```bash
   bun run verify:m042:s01
   bun run verify:m042:s02
   ```
2. **Expected:** Both commands exit 0 and retain their previously passing checks, proving S03 did not break persistence truthfulness or review-surface truthfulness while hardening cache/degradation behavior.

### 9. Repo-wide type safety remains intact after the cache-contract tightening

1. Run:
   ```bash
   bun run tsc --noEmit
   ```
2. **Expected:** Exit code 0 with no type errors.

## Edge Cases

### Edge Case 1: Cache may reuse only lower-fidelity taxonomy values

1. Run:
   ```bash
   bun test ./src/handlers/review.test.ts
   ```
2. Inspect the `resolveAuthorTierFromSources` cache-taxonomy test.
3. **Expected:** `core` remains the highest valid cached fallback taxonomy value; cache cannot directly claim `established` or `senior`.

### Edge Case 2: Degraded fallback must disclose degradation without changing the tier story

1. Run:
   ```bash
   bun run verify:m042:s03
   ```
2. Inspect the `M042-S03-DEGRADED-FALLBACK-NONCONTRADICTORY` line.
3. **Expected:** The check passes only when the fallback tier stays `regular`/developing and the exact Search API disclosure sentence is present.

### Edge Case 3: Proof harness JSON output is machine-readable for milestone closure

1. Run:
   ```bash
   bun run verify:m042:s03 --json
   ```
2. **Expected:** JSON includes `overallPassed: true`, the three S03 `check_ids`, and per-check `status_code`/`passed` fields suitable for downstream automation.

## Failure Signals

- `cache_hit_surface_truthfulness_failed` — cached `core` no longer renders the expected senior-style wording or includes contradictory lower-tier phrases.
- `profile_override_cache_truthfulness_failed` — contradictory cache data is outranking contributor-profile state somewhere in the composed review surfaces.
- `degraded_fallback_truthfulness_failed` — degraded fallback changed the contributor story, dropped the disclosure sentence, or mixed incompatible guidance labels.
- `bun test ./src/handlers/review.test.ts` failure in the author-tier cache integration block — regression in the real handler path, not just the proof harness.
- `bun run tsc --noEmit` failure — cache contract or test scaffolding drift introduced a repo-level type regression.

## Requirements Proved By This UAT

- R037 — proves the contributor-tier truthfulness contract is now complete across persistence, render surfaces, cache reuse, and degraded fallback handling.

## Not Proven By This UAT

- Live GitHub review publication on an external PR. This slice proves the deterministic contributor-tier decision and rendering contract, not a live external mutation path.

## Notes for Tester

S03 is the final hardening slice for M042. If `verify:m042:s01`, `verify:m042:s02`, and `verify:m042:s03` all pass together, the CrystalP-shaped contributor-tier regression is covered at source-of-truth, render, cache, and degraded fallback layers. A future regression would have to bypass multiple independent proof surfaces rather than slipping through one unguarded path.
