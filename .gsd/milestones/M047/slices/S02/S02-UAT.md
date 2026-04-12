# S02: Contract-first Slack, retrieval, and profile continuity rollout — UAT

**Milestone:** M047
**Written:** 2026-04-11T02:28:08.576Z

# S02 UAT — Contract-first Slack, retrieval, and profile continuity rollout

## Preconditions

- Repository is at the completed M047/S02 state.
- Dependencies are installed and `bun` is available.
- No live Slack or GitHub credentials are required; all verification is deterministic and fixture-backed.
- The S01 runtime proof surface (`verify:m047:s01`) is available because S02 embeds it as a prerequisite.

## Test Case 1 — Full slice regression bundle stays green

1. Run:
   - `bun test ./src/contributor/profile-surface-resolution.test.ts ./src/slack/slash-command-handler.test.ts ./src/routes/slack-commands.test.ts ./src/handlers/identity-suggest.test.ts ./src/knowledge/retrieval-query.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./scripts/verify-m045-s03.test.ts ./scripts/verify-m047-s02.test.ts`
2. Confirm the command exits 0.
3. Confirm the output reports passing coverage for all eight named files.
4. Confirm the bundle finishes with no failures.

**Expected outcome:**
- Slack/profile resolution, signed slash-command continuity, identity suppression, retrieval hint shaping, and both verifier suites all pass together.
- No test in the bundle reports false active linked guidance for untrusted stored rows.

## Test Case 2 — The nested verifier chain stays coherent

1. Run:
   - `bun run verify:m047:s01 && bun run verify:m045:s03 && bun run verify:m047:s02`
2. Inspect the output from each verifier.
3. Confirm all three commands report `PASS`.

**Expected outcome:**
- `verify:m047:s01` preserves truthful stored-profile runtime resolution.
- `verify:m045:s03` remains green after the Slack/retrieval rollout.
- `verify:m047:s02` reports the downstream stored-profile matrix without contradiction.

## Test Case 3 — JSON proof surfaces expose the correct downstream state matrix

1. Run:
   - `bun run verify:m047:s01 -- --json`
   - `bun run verify:m045:s03 -- --json`
   - `bun run verify:m047:s02 -- --json`
2. In the `verify:m047:s02` JSON output, confirm the top-level checks all pass:
   - `M047-S02-SLACK-PROFILE-CONTRACT`
   - `M047-S02-CONTINUITY-CONTRACT`
   - `M047-S02-RETRIEVAL-MULTI-QUERY-CONTRACT`
   - `M047-S02-RETRIEVAL-LEGACY-QUERY-CONTRACT`
   - `M047-S02-IDENTITY-SUPPRESSION-CONTRACT`
3. Confirm these scenario-specific expectations:
   - `linked-unscored`, `legacy`, and `malformed` stay generic on Slack/profile surfaces and use only `returning contributor` retrieval hints.
   - `stale` stays generic on Slack/profile surfaces and omits retrieval author hints under degraded fallback behavior.
   - `calibrated` stays `profile-backed` across Slack/profile, continuity, and retrieval surfaces.
   - `opt-out` stays generic, suppresses retrieval author hints, and reports identity suppression with no DM sent.
4. In the `verify:m045:s03` JSON output, confirm Slack and identity sections still pass after the S02 changes.

**Expected outcome:**
- The downstream proof surface is machine-consumable and nested verifier composition remains intact.
- Status codes and scenario diagnostics make drift obvious without manual log spelunking.

## Test Case 4 — Slack/profile continuity stays truthful on the real route and handler surfaces

1. Run:
   - `bun test ./src/slack/slash-command-handler.test.ts ./src/routes/slack-commands.test.ts`
2. Inspect the passing test names.
3. Confirm the suite covers:
   - generic continuity for `link` when a newly linked profile is still untrusted
   - generic continuity for `profile opt-in` when current contributor signals are still unavailable
   - active linked continuity only when the stored profile is trusted
   - generic `/kodiai profile` output for opted-out, legacy, stale, and malformed rows
   - expertise lookup fail-open behavior

**Expected outcome:**
- Untrusted stored rows never claim active linked guidance on Slack/profile surfaces.
- Trusted calibrated rows do claim active linked guidance and may show expertise.
- The signed Hono route returns the same truthful continuity copy as the direct handler path.

## Test Case 5 — Opted-out linked contributors suppress identity suggestions without breaking fail-open behavior

1. Run:
   - `bun test ./src/handlers/identity-suggest.test.ts`
2. Inspect the passing test names.
3. Confirm the suite includes passing cases for:
   - existing linked profiles skipping Slack lookup entirely
   - opted-out linked profiles being treated as existing and receiving no DM
   - low-confidence matches staying non-blocking
   - malformed Slack DM responses logging warnings without throwing
   - missing opted-out-lookup support staying fail-open with a warning

**Expected outcome:**
- Opted-out linked contributors are not treated as absent.
- Slack API problems remain warnings, not blockers.
- Only high-confidence, non-opted-out matches send the truthful DM copy.

## Test Case 6 — Retrieval hint shaping stays aligned with downstream truth

1. Run:
   - `bun test ./src/knowledge/retrieval-query.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./scripts/verify-m045-s03.test.ts ./scripts/verify-m047-s02.test.ts`
2. Confirm the command exits 0.
3. Confirm the passing cases cover:
   - `established contributor` hints only for trusted `profile-backed` states
   - `returning contributor` hints only for coarse-fallback states
   - no author hint for generic-unknown, generic-opt-out, or generic-degraded states
   - downstream verifier drift detection when scenario expectations are blank or contradictory

**Expected outcome:**
- Retrieval author hints remain contract-first and do not leak false contributor certainty.
- The verifier fixtures catch regressions instead of certifying legacy optimism.

## Test Case 7 — Type safety stays intact after the rollout wiring

1. Run:
   - `bun run tsc --noEmit`
2. Confirm the command exits 0.

**Expected outcome:**
- The new resolver, handler wiring, retrieval/verifier updates, and route/identity coverage compile cleanly.

## Edge Cases To Explicitly Check

- Linked-unscored, legacy, stale, and malformed stored rows must not show active linked guidance on `/kodiai profile`.
- `link` and `profile opt-in` must keep continuity generic for untrusted stored rows by saying current contributor signals are not yet available.
- Opted-out linked contributors must suppress identity DMs even though user-facing lookups normally hide opted-out rows.
- Degraded fallback retrieval scenarios must omit contributor author hints instead of inventing contributor certainty.
- Signed slash-command responses must match the direct handler copy for the same stored-profile state.
- Slack/profile, verifier, and route output must stay redacted from Slack IDs and contributor profile IDs.

## UAT Exit Criteria

S02 is accepted only if:

- the full slice regression bundle passes,
- `verify:m047:s01`, `verify:m045:s03`, and `verify:m047:s02` all pass together,
- the three `--json` proof surfaces expose the expected stored-profile and downstream scenario diagnostics,
- `tsc` passes,
- and no edge-case check reintroduces false active linked guidance, retrieval-hint leakage, or opted-out identity DMs.
