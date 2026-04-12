# M047 Research — Contributor Experience Redesign and Calibration Rollout

## Executive read

M047 does **not** need a new surface vocabulary. The durable seam already exists in `src/contributor/experience-contract.ts`, and both `verify:m045:s03` and `verify:m046` confirm the intended direction:

- **Keep** the M045 contributor-experience contract vocabulary.
- **Change** review and Slack consumers so they stop trusting raw stored tier fields as truth.
- **Replace** the live incremental `pr_authored`-only scoring path.

The highest-risk problem is not prompt copy. It is **source resolution**.

Today a linked profile can be treated as a trustworthy `profile-backed` newcomer **before any real scoring has happened** because:

- `src/db/migrations/011-contributor-profiles.sql` gives new profiles `overall_tier='newcomer'` by default.
- `src/contributor/profile-store.ts` preserves that default on `linkIdentity()` / `getOrCreateByGithubUsername()`.
- `src/handlers/review.ts::resolveAuthorTier()` treats any normalized stored tier as trustworthy `contributor-profile` input.
- `src/slack/slash-command-handler.ts::formatProfileCard()` renders linked-profile status directly from `profile.overallTier`.

That means M047 must first retire the **"linked-but-unscored profile-backed newcomer"** failure mode. If that is not fixed, every downstream surface can look coherent while still being wrong.

## Commands run

- `bun run verify:m045:s03 -- --json`
- `bun run verify:m046 -- --json`

Both currently pass. `verify:m046` truthfully reports `verdict=replace` and emits the current M047 change contract.

## Skill discovery

### Already installed and directly relevant enough

- `azure-container-apps` — useful if M047 ends with ACA deployment or ingress/runtime verification.
- `github-bot` / `github-workflows` — useful for PR/CI automation around rollout proof, but not central to the code change itself.

### Promising external skills found

- **Hono**: `yusukebe/hono-skill@hono` — 3K installs  
  Install: `npx skills add yusukebe/hono-skill@hono`
- **Slack**: `stablyai/agent-slack@agent-slack` — 937 installs  
  Install: `npx skills add stablyai/agent-slack@agent-slack`

I did not install anything.

## What exists now

### 1) The contract seam is already the right public interface

`src/contributor/experience-contract.ts` already centralizes the durable public vocabulary:

- `profile-backed`
- `coarse-fallback`
- `generic-unknown`
- `generic-opt-out`
- `generic-degraded`

It already projects:

- review prompt behavior (`buildContributorExperiencePromptSection`)
- Review Details copy (`reviewDetails.text`)
- retrieval hints (`resolveContributorExperienceRetrievalHint`)
- Slack profile status copy (`resolveContributorExperienceSlackProfileProjection`)

This is the strongest existing seam in the milestone. Reuse it.

### 2) Review runtime already threads one contract object through most surfaces

`src/handlers/review.ts` already does the right architectural thing after resolution:

- resolves author state in `resolveAuthorTier()`
- passes `authorClassification.contract` into `buildReviewPrompt(...)`
- uses the same contract for retrieval hint shaping
- emits the same contract into Review Details
- preserves coarse fallback cache behavior through `author_cache`

So the main review-side work is **not** rewriting the prompt or Review Details builders. It is fixing what produces the contract.

### 3) Retrieval is already contract-first and likely the cheapest downstream surface

`src/knowledge/retrieval-query.ts` and `src/knowledge/multi-query-retrieval.ts` take only an optional normalized `authorHint` string.

That hint already comes from `resolveContributorExperienceRetrievalHint(contract)`.

Implication: if review/runtime resolution produces the right contract, retrieval probably comes along with minimal new logic.

### 4) Slack is still a raw stored-tier consumer

`src/slack/slash-command-handler.ts::formatProfileCard()` feeds:

- `source: "contributor-profile"`
- `tier: profile.overallTier`
- `optedOut: profile.optedOut`

into `resolveContributorExperienceSlackProfileProjection(...)`.

That means Slack status is still sourced from raw persisted tier data, not from a richer calibrated contract or trust/freshness model. This is exactly what the M046 change contract called out.

### 5) Persistence exists, but it does not encode trust/version/provenance

`contributor_profiles` currently stores:

- `overall_tier`
- `overall_score`
- `opted_out`
- `last_scored_at`

It does **not** store:

- which scoring model produced the row
- whether the stored tier is legacy pre-M047 or calibrated post-M047
- whether the profile is linked-but-unscored
- whether the contract should be treated as degraded/stale
- provenance/source beyond the derived tier itself

`last_scored_at` is useful, but by itself it is not enough to distinguish **legacy score** vs **new M047-calibrated score**.

### 6) The current live scoring producer is exactly the wrong one

`src/handlers/review.ts` only calls:

- `updateExpertiseIncremental({ type: "pr_authored" })`

and does it **fire-and-forget after review completes**.

That has two consequences:

1. It matches the M046 `replace` verdict.
2. It cannot improve the very review that triggered it, because resolution already happened earlier in the request.

### 7) There is a reusable scorer seam, but it is not the final answer yet

`src/contributor/expertise-scorer.ts::computeExpertiseScores()` is the natural reuse seam for a fuller recompute path.

But it is currently:

- unused in runtime
- batch-shaped, not wired into the current flow
- not actually full-signal despite its comment; it fetches commits and authored PRs, but no PR review history

That matters because `src/contributor/calibration-evaluator.ts` models the intended path using:

- commit counts
- authored PR provenance
- review provenance

So M047 should assume **some scorer work still needs to happen** before the existing batch scorer truly matches the replacement contract.

## Key findings and surprises

### A) The real root cause is “unscored looks like scored newcomer”

This is the most important finding.

The current system conflates three very different states:

- truly scored newcomer
- newly linked but never scored
- legacy incremental score that should no longer be trusted after M047

As long as all three collapse into `overallTier="newcomer"`, review and Slack will keep overclaiming certainty.

### B) `verify:m045:s03` proves surfaces, not producer truth

`verify:m045:s03` is excellent for wording and drift detection, but it mostly proves **contract rendering**.

It does not prove the runtime source-resolution bug is gone, because it builds or seeds already-resolved contract states.

M047 needs an end-to-end verifier that exercises **real stored-profile / cache / fallback inputs**, not just direct contract projections.

### C) Retrieval work is likely smaller than it looks

Because retrieval already consumes `authorHint` from the contract seam, there is a good chance M047 retrieval changes are mostly:

- continuity verification
- scenario expansion
- maybe light fixture changes

The big risk is elsewhere: profile trust semantics and source resolution.

### D) Slack link/profile continuity is more in-scope than the milestone text makes obvious

M045 S03 proved more than `/kodiai profile`:

- profile output
- `profile opt-in` / `profile opt-out`
- identity-link DM copy

M047 context foregrounds review/retrieval/Slack profile, but the project context also says tier-related surfaces remain in scope unless explicitly removed.

If M047 changes when a profile is considered “active” or “reliable,” the following copy may need continuity checks too:

- `/kodiai link <github-username>` success text
- identity suggestion DM text
- opt-in/opt-out messaging

That is a likely continuity expectation gap.

## Boundary contracts that matter

### Keep stable

1. **M045 vocabulary and state machine**  
   Keep `profile-backed`, `coarse-fallback`, `generic-*` as the public contract.

2. **Coarse fallback isolation**  
   `author_cache` remains a low-confidence fallback surface using the old 3-tier taxonomy (`first-time|regular|core`). It should not be mistaken for calibrated profile truth.

3. **Fail-open degradation semantics**  
   Existing `generic-degraded` / `generic-unknown` behavior is valuable. Do not replace it with silent fallback.

4. **Verifier composition pattern**  
   M045/M046 already established the right proof pattern: compose nested reports, keep stable check IDs, and keep human/JSON output aligned.

### Do not keep as truth sources

1. **`profile.overallTier` by itself**  
   Not sufficient after M046’s replace verdict.

2. **Legacy `pr_authored` incremental updates**  
   Explicitly marked for replacement.

3. **Direct raw-tier consumer logic in Slack**  
   Must move behind a richer producer/trust decision.

## Constraints imposed by the current codebase

### Review-time constraint

`resolveAuthorTier()` runs **before** prompt build and before review publication. Any calibrated data that should affect the current review must already exist before this function runs.

That makes purely post-review fire-and-forget updates insufficient as the primary truth source.

### Slack route dependency constraint

`src/routes/slack-commands.ts` only injects:

- `config`
- `logger`
- `profileStore`

It does **not** inject GitHub App / Octokit / job orchestration for a full recompute.

So if link-time or profile-time recalculation is desired, the route dependencies or orchestration path must expand.

### Persistence/versioning constraint

There is currently no persisted marker for “legacy incremental tier” vs “M047-calibrated tier”.

Without that, rollout risks mixing old and new semantics in the same column and calling them coherent.

### Existing verifier constraint

The current verifiers already give strong building blocks:

- `scripts/verify-m045-s03.ts` for cross-surface contract drift
- `scripts/verify-m046.ts` for fixture-backed calibration verdict and the M047 change contract

M047 should extend these patterns, not invent a new proof style.

## What should be proven first

1. **A linked-but-unscored profile no longer resolves to `profile-backed` newcomer.**  
   This is the current lie. Retire it first.

2. **Legacy pre-M047 stored tiers can be distinguished from new calibrated tiers during rollout.**  
   Otherwise the rollout cannot truthfully claim coherence.

3. **Fixture contributors land where M046 says they should under the new producer path.**  
   At minimum:
   - `fuzzard` != newcomer default
   - `koprajs` != newcomer default
   - `fkoemep` remains newcomer, but freshness/degradation stays visible

4. **When no trustworthy calibrated profile exists, review still degrades truthfully to coarse fallback or generic states.**

5. **Slack and retrieval consume that same resolved contract, not a separate interpretation.**

## Recommended slice boundaries and order

### Slice 1 — Producer truth and review resolution

Focus here first.

Natural work boundary:

- add a trustworthy distinction between unscored / legacy / calibrated profiles
- replace or front-load the current scoring producer enough that `resolveAuthorTier()` can make a truthful decision
- update `resolveAuthorTier()` so stored profiles are only `profile-backed` when genuinely trustworthy
- keep `experience-contract.ts` vocabulary stable
- prove review prompt + Review Details behavior from real profile states, not just direct contract fixtures

Primary hotspots:

- `src/handlers/review.ts`
- `src/contributor/profile-store.ts`
- `src/db/migrations/011-contributor-profiles.sql` successor migration(s)
- `src/contributor/expertise-scorer.ts`
- possibly `src/contributor/types.ts`

### Slice 2 — Slack, retrieval, and persistence/update continuity

After producer truth is fixed:

- move Slack profile rendering behind the new trusted contract inputs
- decide whether `/kodiai link`, opt-in/out, and identity-link copy need continuity updates
- confirm retrieval stays aligned via the same contract resolution
- decide whether any cache invalidation / backfill / migration step is required for existing rows

Primary hotspots:

- `src/slack/slash-command-handler.ts`
- `src/routes/slack-commands.ts`
- `src/contributor/experience-contract.ts`
- `src/knowledge/retrieval-query.ts`
- `src/knowledge/multi-query-retrieval.ts`

### Slice 3 — End-to-end coherence verifier

Build this last, but design it early.

It should combine:

- M045-style cross-surface drift checks
- M046 fixture-backed calibration expectations
- runtime source-resolution scenarios that M045 never covered

Likely proof cases:

- linked-but-unscored profile stays generic
- calibrated retained contributor becomes profile-backed with non-newcomer guidance
- stale/missing evidence contributor degrades truthfully
- coarse fallback cache still stays coarse, not profile-backed

## Known failure modes that should shape ordering

- **Silent overclaim**: newly linked profile shows `profile-backed` newcomer before any scoring.
- **Mixed rollout**: old legacy `overall_tier` rows coexist with new calibrated semantics and surfaces treat both as equivalent.
- **Slack drift**: review fixes land, but `/kodiai profile` still reads raw stored tier.
- **Asynchronous blind spot**: post-review scoring runs too late to affect the review that just shipped.
- **Fallback contamination**: `author_cache` 3-tier fallback gets mistaken for calibrated profile truth.
- **Verifier blind spot**: contract renderer tests stay green while runtime source resolution is still wrong.

## Requirement read: R048

### Table stakes already implied by R048

- one shipped contributor model across review, retrieval, Slack, and persistence paths
- end-to-end proof, not isolated unit changes
- no mixed taxonomy / mixed semantics across surfaces

### What R048 does not make explicit enough

These are **candidate requirements**, not automatic scope expansions.

1. **Legacy-profile trust boundary**  
   M047 likely needs an explicit rule that pre-M047 stored tiers are not treated as trustworthy calibrated profile guidance until revalidated, versioned, or backfilled.

2. **Linked-but-unscored behavior**  
   M047 likely needs an explicit rule that linked-but-unscored profiles resolve to generic/degraded behavior, not `profile-backed` newcomer.

3. **Continuity scope for Slack opt/link surfaces**  
   If M045 S03 surfaces remain in scope, R048 should say whether `/kodiai link`, `profile opt-in/out`, and identity-link DM copy must remain contract-aligned during rollout.

### Overbuilt risks

- Rewriting prompt/review-details copy unnecessarily. The contract seam already works.
- Replacing retrieval builders when they already consume a normalized contract hint.
- Building a brand-new framework for scoring/projections when the existing seams can be extended.

## Candidate requirements (advisory only)

### Candidate requirement A — Trust boundary for persisted contributor state

Before any surface may claim `profile-backed` guidance from persisted contributor data, the profile must be distinguishable as M047-calibrated/trustworthy rather than merely linked or legacy-scored.

Why this matters: this is the current failure mode that makes the rollout look coherent while remaining wrong.

### Candidate requirement B — Source-resolution end-to-end proof

M047 verification should include runtime source-resolution scenarios, not only direct contract-rendering scenarios, to prove that linked-unscored, stale, calibrated, and fallback states resolve to the correct contract before reaching review/retrieval/Slack surfaces.

Why this matters: M045 proved copy drift well, but M047 needs to prove source truth.

## Bottom line for the roadmap planner

The safest plan is:

1. **Fix producer truth first** — especially the linked-but-unscored / legacy-tier trust problem.
2. **Reuse the existing contract seam** instead of redesigning surface vocabulary.
3. **Treat Slack as the main downstream raw-tier consumer** that still needs real wiring work.
4. **Assume retrieval is mostly continuity work** once contract resolution is correct.
5. **Build `verify:m047` around runtime source resolution + M045/M046 composition**, not around copy-only fixtures.

If M047 proves only that prompts and Slack copy changed, it will miss the real issue. If it proves that untrusted stored profile data can no longer masquerade as calibrated contributor truth, the rest of the milestone becomes much more mechanical.
