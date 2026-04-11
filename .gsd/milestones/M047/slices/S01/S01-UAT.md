# S01: Truthful contributor resolution on GitHub review — UAT

**Milestone:** M047
**Written:** 2026-04-11T01:09:04.940Z

# S01 UAT — Truthful contributor resolution on GitHub review

## Preconditions

- Repository is at the completed M047/S01 state.
- Dependencies are installed and `bun` is available.
- For DB-backed profile-store tests, `TEST_DATABASE_URL` points at the test database or the local default database is available.
- No live GitHub or Slack credentials are required; this UAT is deterministic and fixture-backed.

## Test Case 1 — Full slice regression bundle stays green

1. Run:
   - `bun test ./src/contributor/profile-trust.test.ts ./src/contributor/profile-store.test.ts ./src/contributor/review-author-resolution.test.ts ./src/handlers/review.test.ts ./scripts/verify-m047-s01.test.ts`
2. Confirm the command exits 0.
3. Confirm the output includes passing coverage for:
   - `profile-trust.test.ts`
   - `profile-store.test.ts`
   - `review-author-resolution.test.ts`
   - `review.test.ts`
   - `verify-m047-s01.test.ts`

**Expected outcome:**
- All named files run.
- No failures are reported.
- The bundle proves persisted trust classification, review-time fail-open behavior, handler integration, and verifier wiring together.

## Test Case 2 — The existing M045 review contract still holds

1. Run:
   - `bun run verify:m045:s01`
2. Inspect the scenario list.
3. Confirm every M045 scenario reports `PASS`.

**Expected outcome:**
- `profile-backed`, `coarse-fallback`, `generic-unknown`, `generic-opt-out`, and `generic-degraded` all pass.
- This slice does not regress the public contributor-experience contract while changing runtime source resolution underneath it.

## Test Case 3 — Runtime stored-profile truth matrix is correct

1. Run:
   - `bun run verify:m047:s01`
2. Inspect the scenario summary.
3. Confirm the following scenario-level outcomes:
   - `linked-unscored` → `trust=linked-unscored`, `contract=coarse-fallback`, source/fallback show fail-open behavior
   - `legacy` → `trust=legacy`, `contract=coarse-fallback`
   - `stale` → `trust=stale`, `contract=generic-degraded`
   - `calibrated` → `trust=calibrated`, `contract=profile-backed`, `source=contributor-profile`
   - `opt-out` → `trust=calibrated`, `contract=generic-opt-out`
   - `coarse-fallback-cache` → no stored profile, `contract=coarse-fallback`, `source=author-cache`
4. Confirm every scenario check reports `PASS`.

**Expected outcome:**
- Untrusted stored rows never resolve to `profile-backed`.
- A trustworthy calibrated row does resolve to `profile-backed`.
- Opt-out still overrides otherwise trustworthy stored-profile data.
- The verifier emits stable named checks instead of generic pass/fail text.

## Test Case 4 — Review handler keeps prompt, Review Details, and logs coherent

1. Run:
   - `bun test ./src/contributor/review-author-resolution.test.ts ./src/handlers/review.test.ts`
2. Inspect the passing test names.
3. Confirm the suite includes passing cases for:
   - linked-unscored stored profiles failing open to coarse fallback
   - legacy stored profiles failing open
   - stale stored profiles degrading truthfully
   - opted-out contributors staying generic
   - contradictory cached low-tier data not overriding a trustworthy calibrated stored profile
   - handler logging stored-profile trust diagnostics when bypassing an untrusted stored row

**Expected outcome:**
- Prompt shaping and Review Details stay aligned with the resolved contract state.
- Handler log assertions prove trust diagnostics exist for operators.
- Review Details assertions remain redacted from private calibration internals.

## Test Case 5 — Type safety stays intact after the slice wiring changes

1. Run:
   - `bun run tsc --noEmit`
2. Confirm the command exits 0.

**Expected outcome:**
- The new migration/store types, shared resolver, handler wiring, and verifier code all compile cleanly.

## Edge Cases To Explicitly Check

- A newly linked placeholder row that still has the default newcomer tier must not be treated as a trustworthy `profile-backed` newcomer.
- A legacy scored row without `trust_marker` must fail open even if `overall_tier` looks strong.
- A stale current-marker row must not remain trustworthy when freshness is lost.
- A low-confidence cache hit must not override a trustworthy calibrated stored profile.
- An opted-out author must remain `generic-opt-out` even if the stored row is otherwise calibrated and current.
- Review Details and verifier output must not expose Slack IDs, contributor profile IDs, or raw expertise scores.

## UAT Exit Criteria

S01 is accepted only if:

- the slice regression bundle passes,
- `verify:m045:s01` passes,
- `verify:m047:s01` passes with the exact scenario truth matrix above,
- `tsc` passes,
- and no edge-case check reintroduces false `profile-backed` guidance from untrusted stored rows.

