# S01: Repro and Tier-State Correction — UAT

**Milestone:** M042
**Written:** 2026-04-06T22:36:46.831Z

# S01: Repro and Tier-State Correction — UAT

**Milestone:** M042
**Written:** 2026-04-06T22:34:00Z

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: This slice changed scorer logic, tier persistence behavior, and review-tier source resolution through deterministic code paths with a named slice verifier. The contract is best proven by repeatable tests and the slice proof harness rather than a live GitHub review run.

## Preconditions

- Repository is at the M042/S01 slice-complete state.
- Bun dependencies are installed.
- No live GitHub, Slack, or database access is required for this UAT.

## Smoke Test

Run:

```bash
bun run verify:m042:s01
```

**Expected:** The command exits 0 and prints four PASS lines for:
- `M042-S01-STUCK-TIER-REPRO-FIXED`
- `M042-S01-RECALCULATED-TIER-PERSISTS`
- `M042-S01-PROFILE-PRECEDENCE`
- `M042-S01-FAIL-OPEN-NONBLOCKING`

## Test Cases

### 1. CrystalP-shaped stale-tier repro now advances out of the low tier

1. Run:
   ```bash
   bun test ./src/contributor/expertise-scorer.test.ts
   ```
2. Inspect the passing test output for `updateExpertiseIncremental > recalculates and persists an advanced tier when the updated score outranks the lowest cohort`.
3. **Expected:** The scorer suite passes, proving a contributor with a stale low stored tier can advance when their updated score outranks the lowest cohort.

### 2. Shared percentile helper recalculates a target profile tier from the live score distribution

1. Run:
   ```bash
   bun test ./src/contributor/tier-calculator.test.ts
   ```
2. Inspect the passing output for `calculateTierForProfile > replaces the target profile score before deriving its percentile tier`.
3. **Expected:** The tier-calculator suite passes, proving the updated profile score is inserted into the full score distribution before assigning the new tier.

### 3. Review resolution trusts contributor-profile state before cache and fallback

1. Run:
   ```bash
   bun test ./src/handlers/review.test.ts
   ```
2. Inspect the passing output for `resolveAuthorTierFromSources > prefers contributor profile tier ahead of cache and fallback`.
3. **Expected:** The review test suite passes, showing contributor-profile state is the first review-time source of truth when present.

### 4. Slice-level proof surface reports the full truthfulness contract

1. Run:
   ```bash
   bun run verify:m042:s01
   ```
2. Confirm the JSON payload ends with `"overallPassed": true`.
3. Confirm the details report:
   - corrected tier is not `newcomer` for the stuck-tier repro
   - recalculated and persisted tiers match
   - precedence source is `contributor-profile`
   - degraded fallback preserves the existing tier
4. **Expected:** The verifier exits 0 with all four checks passing and emits machine-readable JSON suitable for downstream slices and milestone closure.

### 5. Repo-wide type safety remains intact after the scorer and review changes

1. Run:
   ```bash
   bun run tsc --noEmit
   ```
2. **Expected:** The command exits 0 with no type errors.

## Edge Cases

### Recalculation dependency failure does not block score updates

1. Run:
   ```bash
   bun run verify:m042:s01
   ```
2. Inspect the `M042-S01-FAIL-OPEN-NONBLOCKING` detail.
3. **Expected:** The check passes with `fallback tier preserved=newcomer`, proving recalculation failure degrades to the stored tier instead of throwing or blocking the path.

### Review resolution still falls back when no contributor profile is available

1. Run:
   ```bash
   bun test ./src/handlers/review.test.ts
   ```
2. Inspect the passing output for:
   - `falls back to cached tier when contributor profile is absent`
   - `uses fallback tier when neither profile nor cache is available`
3. **Expected:** Both tests pass, proving the precedence chain still behaves predictably when higher-fidelity sources are absent.

## Failure Signals

- `bun run verify:m042:s01` prints any `FAIL M042-S01-*` line or exits non-zero.
- `bun test ./src/contributor/expertise-scorer.test.ts` fails on the tier-advancement or fail-open fallback cases.
- `bun test ./src/handlers/review.test.ts` fails on contributor-profile precedence and starts preferring cache or fallback over corrected stored state.
- `bun run tsc --noEmit` reports new type errors in contributor scoring or review-tier resolution.

## Requirements Proved By This UAT

- R037 — proves the contributor-experience source of truth now advances correctly and the review path consumes the corrected contributor-profile tier ahead of lower-fidelity sources.

## Not Proven By This UAT

- S02 review-surface wording and prompt-copy truthfulness for all rendered newcomer/experienced guidance paths.
- S03 cache reuse and degraded runtime fallback behavior across repeated real review executions.
- Live GitHub review output for the original CrystalP PR; this slice proves the underlying state and precedence contract, not the full outward rendering path.

## Notes for Tester

This slice is intentionally proven through deterministic tests and the slice verifier rather than a live PR review run. If the verifier passes but a later live review still uses newcomer-style wording, the likely gap is in S02 review-surface wiring rather than in the persisted contributor-tier state repaired here.
