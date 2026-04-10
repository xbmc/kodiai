# M045 / S02 Research — Unified Slack, Opt-Out, and Retrieval Semantics

## Executive summary
- **R046 ownership:** S02 carries Slack profile semantics, opt-out truthfulness outside the GitHub review surface, and retrieval hint policy alignment with the contributor-experience contract already shipped in S01.
- S01 successfully centralized GitHub review prompt/details behavior via `ContributorExperienceContract`, but Slack and retrieval still consume raw tiers or raw tier-derived strings.
- The most important concrete bug is in `src/handlers/review.ts`: review-time retrieval still passes `authorClassification.tier` into query construction. Because `resolveAuthorTier()` returns a raw tier even for `generic-opt-out`, `generic-unknown`, and `generic-degraded`, retrieval currently leaks contributor-specific signals on states that S01 intentionally made generic.
- Slack `/kodiai profile` still renders `Tier: <overallTier>` plus opt-out copy. Opted-out users can therefore see a raw tier and “generic reviews” in the same card — the exact conflicting semantics S02 needs to remove.
- `src/handlers/identity-suggest.ts` still promises “personalized code reviews”, and there is no direct test coverage for that copy or its opt-out interaction.
- The smallest safe architecture is to keep the S01 contract seam and add two more projections: a Slack-facing projection and a retrieval-hint projection. Do not redesign resolver return types; only downstream consumers still leak raw tiers.

## Relevant requirements
- **R046** — explicit contributor-experience contract across in-scope surfaces. S02 owns Slack/profile semantics, opt-in/out truthfulness, and retrieval shaping alignment with the contract already shipped on the GitHub review surface.

## Skill discovery
- Per the `using-superpowers` skill rule to check relevant skills before acting, I checked installed and external skills before further exploration.
- Installed skills directly adjacent:
  - `chat-sdk` — adjacent to chat/slack integration, but this code is raw Hono route + custom slash-command handling rather than Chat SDK adapters.
- No installed Hono-specific or Slack slash-command-specific skill is present.
- External skills worth considering later (not installed):
  - `npx skills add yusukebe/hono-skill@hono` — strongest Hono match (3K installs).
  - `npx skills add stablyai/agent-slack@agent-slack` — strongest Slack match (936 installs).
  - `npx skills add mike-coulbourn/claude-vibes@slash-command-builder` — smaller Slack slash-command helper (22 installs).
- No external documentation lookup was necessary; the relevant APIs are already in-repo and straightforward.

## Current implementation map
- `src/contributor/experience-contract.ts`
  - Owns the S01 seam: `profile-backed`, `coarse-fallback`, `generic-unknown`, `generic-opt-out`, `generic-degraded`.
  - Still projects only review-surface concerns (`promptPolicy`, `reviewDetails`, `reviewBehavior`); there is no Slack or retrieval projection yet.
- `src/handlers/review.ts`
  - `resolveAuthorTier()` now resolves the contract without `knowledgeStore` gating and correctly collapses opted-out profiles to `generic-opt-out`.
  - Remaining raw-tier runtime consumer: retrieval construction at the `buildRetrievalVariants(...)` call still passes `authorClassification.tier`.
  - Logs still include raw `authorTier`, but prompt/review-details now use `authorClassification.contract`.
- `src/knowledge/multi-query-retrieval.ts`
  - Accepts `authorTier?: string` and appends `author: <tier>` only to the intent variant.
  - `src/handlers/mention.ts` reuses this builder without author input, so changing the optional review-only input is low blast radius.
- `src/knowledge/retrieval-query.ts`
  - Legacy single-query helper, currently test-only / unused by the live review flow.
  - Still codifies `Author: <tier>` semantics and will drift unless aligned or retired.
- `src/slack/slash-command-handler.ts`
  - `formatProfileCard()` renders raw persisted `overallTier`, score, and expertise.
  - `profile opt-out` returns “generic (non-adapted) reviews”.
  - `profile opt-in` exists, but the unknown-command help text still only advertises `profile opt-out`.
- `src/handlers/identity-suggest.ts`
  - DM copy says linking gives “personalized code reviews”.
  - No direct tests cover this copy or its opt-out interaction.
- `src/contributor/profile-store.ts` / `src/contributor/types.ts`
  - Support both `getByGithubUsername(..., { includeOptedOut: true })` and Slack-side lookups.
  - No schema change appears necessary for S02; the missing piece is surface projection, not storage.

## Key findings and surprises
1. **Retrieval still leaks contributor tiers on generic states.**
   - `resolveAuthorTier()` returns a raw `tier` even when `contract.state` is `generic-opt-out`, `generic-unknown`, or `generic-degraded`.
   - `review.ts` passes that raw `tier` into `buildRetrievalVariants()`.
   - Result: prompt/details are truthful, but retrieval may still encode `author: established`, `author: first-time`, etc. on states that are supposed to be generic.
2. **The remaining runtime blast radius is smaller than it looks.**
   - After S01, prompt and Review Details no longer consume raw tiers.
   - In the live review path, raw `authorClassification.tier` now appears to drive only:
     - logging/telemetry context, and
     - retrieval query construction.
   - That makes S02 retrieval work a narrow downstream fix, not another resolver rewrite.
3. **Slack profile is still raw-model-first, not contract-first.**
   - `formatProfileCard()` leads with `Tier: <overallTier>`.
   - For opted-out users, the same card can show a raw tier and “generic reviews” at once.
   - This is the clearest contributor-visible contradiction remaining after S01.
4. **Slack copy drift exists in more than one place.**
   - `/kodiai profile opt-out` says generic reviews.
   - Identity suggestion DMs still promise personalized reviews.
   - Unknown-command help omits `profile opt-in`, so even the command surface is slightly out of sync with actual behavior.
5. **There is no test coverage for contract-driven Slack or retrieval semantics.**
   - Existing tests verify:
     - Slack handler mechanics,
     - retrieval builder formatting,
     - S01 review prompt/details contract.
   - Missing:
     - no test asserting opted-out / generic states suppress retrieval author hints,
     - no test asserting Slack profile output leads with contract semantics instead of raw tier,
     - no test asserting identity suggestion copy/skip logic stays truthful.
6. **The knowledge-layer API should stay generic.**
   - `multi-query-retrieval.ts` is shared with mention handling.
   - Passing the full contributor contract into knowledge code would couple unrelated layers.
   - Safer seam: compute a contract-approved retrieval hint upstream, then pass a generic optional string (`authorHint`, `contributorHint`, or null) into retrieval builders.
7. **`buildRetrievalQuery()` is a cleanup decision point.**
   - Because it is test-only today, S02 can either:
     - align it to the same contract-approved hint behavior, or
     - retire it to avoid preserving dead pre-S01 semantics.
   - Leaving it untouched will keep old tier semantics alive in tests even if runtime is fixed.

## Natural seams / recommended task boundaries
### Seam 1 — Retrieval hint projection
Best files:
- `src/contributor/experience-contract.ts`
- `src/handlers/review.ts`
- `src/knowledge/multi-query-retrieval.ts`
- `src/knowledge/retrieval-query.ts` (align or delete)
- `src/knowledge/*.test.ts`
- `src/handlers/review.test.ts`

Recommendation:
- Add a pure helper near the contract seam that decides whether a retrieval hint is allowed and, if so, what string it should emit.
- Keep `knowledge/*` generic: it should accept an optional hint string, not know contract internals.
- First prove the policy on the three generic states (`generic-opt-out`, `generic-unknown`, `generic-degraded`). If the chosen product answer is “no retrieval contributor hint at all,” this seam still supports it with one helper returning null.

### Seam 2 — Slack profile / opt-in-out copy projection
Best files:
- `src/slack/slash-command-handler.ts`
- possibly `src/contributor/experience-contract.ts` (or a small sibling projection helper)
- `src/slack/slash-command-handler.test.ts`
- `src/routes/slack-commands.test.ts` if response text expectations tighten

Recommendation:
- Build a contract-first Slack projection rather than formatting raw `overallTier` directly.
- Decide whether raw stored tier remains visible as secondary diagnostic data or disappears from the user-facing profile card.
- Update opt-out / opt-in / help text in the same task so the Slack command surface cannot drift phrase-by-phrase.

### Seam 3 — Identity suggestion truthfulness
Best files:
- `src/handlers/identity-suggest.ts`
- add or expand tests near that handler (there is currently no direct test file)

Recommendation:
- Align the DM promise to the same contract language as Slack/review.
- Add explicit coverage for opted-out / already-linked cases, because this file currently has no dedicated regression harness.

## Constraints and boundary contracts
- S01 already established the canonical five-state contract and `verify:m045:s01`. Preserve that seam; do not reopen the GitHub review wording architecture.
- No DB migration looks necessary. `contributor_profiles.overall_tier` and `opted_out` already hold the necessary state.
- Review retrieval uses the multi-query path; the single-query helper is legacy/test-only.
- `buildRetrievalVariants()` is also used by `mention.ts`, so S02 should keep the API generic and optional rather than making knowledge code depend on contributor types.
- `slash-command-handler.ts` is small and isolated; this is a good place to tighten wording without broad Slack architecture work.
- `profile-store.test.ts` is currently environment-sensitive here because `DATABASE_URL` pointed to `kodiai-pg.postgres.database.azure.com:5432` and timed out. Planner should prefer pure unit coverage for S02 unless a local DB-backed run is known-good in the execution environment.

## What should be proven first
1. **Retrieval does not emit contributor hints on generic states.**
   - This is the most important hidden semantic bug because it survives after S01 even when prompt/details are truthful.
2. **Slack `/kodiai profile` no longer presents contradictory tier semantics for opted-out users.**
   - This is the clearest user-visible acceptance point for the slice.
3. **Copy alignment across `/kodiai profile`, opt-in/out responses, and identity-suggestion DMs.**
   - These are the remaining plain-language product promises outside the review prompt/details surface.
4. **Then keep S01 green.**
   - `bun run verify:m045:s01 -- --json` should remain passing throughout S02.

## Verification baseline
Verified during research:
- `bun run verify:m045:s01 -- --json` — PASS
- `bun test ./src/handlers/review.test.ts --filter "opted-out contributor profiles stay generic|missing contributor signals remain generic|logs contributor-experience state|multi-query retrieval orchestration"` — PASS (88 tests matched; includes the S01 contract tests plus RET-07 review retrieval orchestration coverage)
- `bun test ./src/slack/slash-command-handler.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts` — PASS
- `bun test ./src/contributor/profile-store.test.ts` — FAIL in this environment due `CONNECT_TIMEOUT` to `kodiai-pg.postgres.database.azure.com:5432`, not due to an S02 logic assertion

Current verification gaps:
- no assertion that generic review states suppress retrieval author hints
- no assertion that Slack profile output is contract-first
- no direct tests for `src/handlers/identity-suggest.ts`

## Recommended direction
Keep S02 as a downstream extension of the S01 seam, not a second architecture rewrite.

The most leverage comes from one small rule:
- **surface behavior must consume contract projections, not raw tier strings.**

Applied to this slice, that means:
- review retrieval gets a contract-approved optional hint string (or none),
- Slack profile output renders contract semantics first,
- opt-in/out and identity-suggestion copy describe the contract truthfully,
- stale single-query retrieval behavior is either aligned or deleted.

That path preserves S01’s architecture, fixes the remaining user-visible contradictions, and leaves S03 to build the operator verifier instead of redoing S02’s implementation work.
