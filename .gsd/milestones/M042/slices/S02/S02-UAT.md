# S02: Review-Surface Truthfulness Wiring — UAT

**Milestone:** M042
**Written:** 2026-04-06T22:53:44.907Z

# S02: Review-Surface Truthfulness Wiring — UAT

**Milestone:** M042
**Written:** 2026-04-05

## UAT: S02 — Review-Surface Truthfulness Wiring

### Preconditions
- Project checked out at `/home/keith/src/kodiai`
- Bun runtime available
- No special env vars required for this slice’s deterministic verification

---

### Test 1: Prompt established-tier guidance stays truthful

**Purpose:** Verify the prompt author-experience section renders established-tier wording and excludes newcomer/developing phrasing.

**Steps:**
1. Run `bun test ./src/execution/review-prompt.test.ts`
2. Confirm the tests `buildReviewPrompt threads established author tier without newcomer or developing guidance` and `buildReviewPrompt threads senior author tier without newcomer or developing guidance` pass.

**Expected:**
- Exit code 0
- Established-tier prompt section contains `established contributor` and `Keep explanations brief`
- Senior-tier prompt section contains `core/senior contributor` and `Be concise and assume familiarity with the codebase`
- Neither rendered section contains `first-time or new contributor`, `developing contributor`, `Explain WHY each finding matters`, or similar newcomer/developing phrases

---

### Test 2: Review Details author-tier line is explicit for regular, established, and senior contributors

**Purpose:** Verify Review Details output exposes the contributor tier directly instead of generic fallback wording.

**Steps:**
1. Run `bun test ./src/lib/review-utils.test.ts`
2. Inspect the test `renders truthful author-tier wording for default, established, and senior contributors`.

**Expected:**
- Exit code 0
- Default case contains `- Author tier: regular (developing guidance)`
- Established case contains `- Author tier: established (established contributor guidance)`
- Senior case contains `- Author tier: senior (senior contributor guidance)`
- Established/senior outputs do not contain `newcomer guidance` or `developing guidance`

---

### Test 3: Handler suite remains green after author-tier wording changes

**Purpose:** Ensure S02 did not destabilize the review handler while changing render surfaces.

**Steps:**
1. Run `bun test ./src/handlers/review.test.ts`
2. Confirm the review handler test suite completes successfully.

**Expected:**
- Exit code 0
- All handler tests pass
- `resolveAuthorTierFromSources` precedence tests still pass, proving contributor-profile tier is preferred over cache and fallback

**Note:** This suite does not yet prove established/senior wording through a full live review execution path. That limitation is known and should be closed in S03.

---

### Test 4: Slice proof harness passes all contributor-tier truthfulness checks

**Purpose:** Verify the dedicated M042/S02 regression harness locks the review-surface contract.

**Steps:**
1. Run `bun run verify:m042:s02`
2. Observe the printed checks and final verdict.

**Expected:**
- Exit code 0
- Final verdict is `PASS`
- The following checks all report `PASS`:
  - `M042-S02-PROFILE-TIER-DRIVES-SURFACE`
  - `M042-S02-PROMPT-ESTABLISHED-TRUTHFUL`
  - `M042-S02-DETAILS-ESTABLISHED-TRUTHFUL`
  - `M042-S02-CRYSTALP-SURFACES-STAY-ESTABLISHED`

---

### Test 5: JSON proof output is machine-readable and complete

**Purpose:** Confirm the verifier can serve downstream automation and milestone closure.

**Steps:**
1. Run `bun run verify:m042:s02 --json`
2. Inspect the JSON payload.

**Expected:**
- Exit code 0
- JSON includes `overallPassed: true`
- `check_ids` includes exactly the four S02 check IDs
- `checks` array contains a row for each check with `passed: true`, `skipped: false`, and a stable `status_code`

---

### Test 6: Harness regression case — established contributor must not regress to newcomer/developing guidance

**Purpose:** Verify the CrystalP-shaped regression is what the harness is actually locking.

**Steps:**
1. Run `bun test ./scripts/verify-m042-s02.test.ts`
2. Inspect the tests under `M042-S02-CRYSTALP-SURFACES-STAY-ESTABLISHED`.

**Expected:**
- Exit code 0
- The positive test proves the real deterministic fixture renders established wording for CrystalP
- The negative test proves the harness fails if prompt/details regress to `developing contributor` or `developing guidance`

---

### Test 7: TypeScript remains clean after S02 surface and verifier changes

**Purpose:** Ensure the slice leaves the repo in a type-safe state.

**Steps:**
1. Run `bun run tsc --noEmit`

**Expected:**
- Exit code 0
- No output

---

## Edge Cases

### Edge Case 1: Contributor-profile tier outranks stale cache and fallback

**Why it matters:** The original bug was a truthfulness issue caused by trusting bad state. The render path must continue to honor the highest-fidelity source.

**Steps:**
1. Run `bun run verify:m042:s02`
2. Check the `M042-S02-PROFILE-TIER-DRIVES-SURFACE` line

**Expected:**
- Status code `contributor_profile_tier_selected_for_surface_rendering`
- Detail indicates `resolvedSource=contributor-profile resolvedTier=established`

### Edge Case 2: Established prompt wording stays established, not merely non-newcomer

**Why it matters:** Avoiding newcomer copy is not enough; the rendered wording should positively reflect established contributor status.

**Steps:**
1. Run `bun test ./src/execution/review-prompt.test.ts`
2. Inspect the established-tier assertions

**Expected:**
- Prompt section contains affirmative established wording (`established contributor`, `Keep explanations brief`)
- It is not just an absence-only assertion

### Edge Case 3: Review Details must not silently drift to generic wording

**Why it matters:** Review Details is a user-visible surface; vague labels can hide regressions.

**Steps:**
1. Run `bun test ./src/lib/review-utils.test.ts`
2. Inspect the established and senior Review Details assertions

**Expected:**
- Output includes explicit guidance labels, not a generic `Author:` line
- Established and senior wording are distinguishable from each other and from the regular/developing default

---

## Failure Interpretation

- `prompt_established_truthfulness_failed` — prompt author-experience section lost required established wording or reintroduced newcomer/developing phrases; inspect `src/execution/review-prompt.ts` and `src/execution/review-prompt.test.ts`
- `review_details_established_truthfulness_failed` — Review Details wording drifted; inspect `src/lib/review-utils.ts` and its formatter tests
- `profile_tier_surface_selection_failed` — contributor-profile precedence regressed; inspect `resolveAuthorTierFromSources()` in `src/handlers/review.ts`
- `crystalp_established_surface_regression_detected` — the CrystalP-shaped repro has returned in either prompt or Review Details output
- `bun run tsc --noEmit` failure — the slice introduced a type regression that must be fixed before downstream cache/fallback hardening starts

---

## Operational Notes

- This slice is code-complete and machine-verifiable entirely through deterministic tests and the proof harness; no live GitHub mutation or DB access is required for UAT.
- The known orchestration-path proof gap is deliberate and documented: handler tests stay green, but full established/senior wording through the existing `runProfileScenario()` seam still needs stronger coverage in S03.
