# M046 Research — S02 Calibration Evaluator for Live vs Intended Model Paths

## Summary

S02 owns **R047** in practice: this slice is where the project turns the checked-in xbmc fixture pack from S01 into an explicit calibration verdict for the contributor-tier mechanism.

The main implementation risk is **not** building another scorer wrapper. It is making sure the evaluator distinguishes three different realities cleanly:

1. **The current live runtime path** — `src/handlers/review.ts` only fire-and-forgets `updateExpertiseIncremental({ type: "pr_authored" })` after Kodiai reviews a PR.
2. **The current batch implementation path** — `computeExpertiseScores()` exists, but nothing calls it, and it still under-implements the intended full-signal model.
3. **The M045 contract impact** — what stored profile state actually means once `projectContributorExperienceContract()` maps it into profile-backed / coarse-fallback / generic behavior.

The most important new research finding for planning is that **S01’s checked-in snapshot is enough to anchor contributor truth, but not enough to replay the live file-sensitive scorer literally**. `updateExpertiseIncremental()` requires `filesChanged: string[]`, and the snapshot stores commit/PR/review provenance URLs plus aggregate commit counts — **not** changed-file arrays, languages, or file-area buckets. So S02 needs either:

- a **pure evaluator abstraction** that models live-vs-intended behavior from the snapshot’s coarse evidence, or
- optional **live hydration** of file lists from the recorded PR/commit evidence, with explicit degraded status when that enrichment is unavailable.

Recommendation for the planner: keep S02 as **proof-surface work**, not runtime plumbing. Build a reusable evaluator core plus a `verify:m046:s02` harness. Do **not** start by wiring background jobs or tuning percentile thresholds; that belongs in M047 only after this slice emits the verdict.

Per the loaded `using-superpowers` skill, this is a **process-first** task: establish the evaluator contract and proof harness shape before any optional live enrichment or future runtime changes.

## Skill Discovery

Directly relevant installed skills are limited.

- Existing installed skills like `github-bot` and `gh` are aimed at GitHub operations, not contributor calibration math.
- Generic installed skills like `test` and `lint` remain useful later, but they do not change the design approach for this slice.

I checked the external skill registry for the only core runtime technology that is plausibly relevant here:

### Bun

Results from `npx skills find "bun"`:

- `sickn33/antigravity-awesome-skills@bun-development` — 1.7K installs  
  Install: `npx skills add sickn33/antigravity-awesome-skills@bun-development`
- `affaan-m/everything-claude-code@bun-runtime` — 924 installs  
  Install: `npx skills add affaan-m/everything-claude-code@bun-runtime`
- `bun.sh@bun` — 683 installs  
  Install: `npx skills add bun.sh@bun`

### Octokit / GitHub API

`npx skills find "octokit"` returned no useful results.

**Recommendation:** no new skill is necessary for S02. The current codebase patterns are already stronger than anything skill installation would add here.

## Current xbmc Fixture Truth Available to S02

S01 already provides a deterministic calibration truth surface under `fixtures/contributor-calibration/`.

### Retained contributors

- `fuzzard` — clear **senior** anchor
  - `observedCommitCounts`: `allTime=2705`, `since2025=522`
  - GitHub provenance includes recent commit, authored PR, and review evidence
- `KOPRajs` / `koprajs` — **ambiguous-middle** anchor
  - `observedCommitCounts`: `allTime=27`, `since2025=15`
  - GitHub provenance includes recent commit, authored PR, and review evidence
- `fkoemep` — clear **newcomer** anchor
  - `observedCommitCounts`: `allTime=1`, `since2025=1`
  - GitHub provenance includes recent commit + authored PR, but no review evidence

### Excluded controls

The snapshot also carries six explicit exclusions:

- bots: `hosted-weblate`, `jenkins4kodi`
- alias collisions: `kai-sommerfeld`, `ksooo`
- ambiguous identities: `keith`, `keith-herrington`

These rows matter to S02 because they let the evaluator prove that calibration is being run on the **retained** truth set rather than silently reintroducing excluded identities.

### Important data-shape constraint

The retained rows are strong enough for:

- senior / ambiguous-middle / newcomer cohort ordering
- freshness and availability diagnostics
- explicit excluded-identity controls
- provenance-backed explanation in the final report

They are **not** strong enough for literal offline scorer replay, because the snapshot does **not** persist:

- per-PR changed file lists
- per-commit changed file lists
- aggregated authored PR counts
- aggregated review counts
- pre-bucketed language or file-area signals

That means S02 cannot simply load `xbmc-snapshot.json` and call `updateExpertiseIncremental()` faithfully.

## Relevant Code Reality

### 1. S01 gives typed fixture truth, but not a reusable snapshot loader

Relevant files:

- `src/contributor/fixture-set.ts`
- `src/contributor/xbmc-fixture-refresh.ts`
- `scripts/verify-m046-s01.ts`

What exists now:

- `src/contributor/fixture-set.ts` validates and summarizes the **manifest** shape.
- `src/contributor/xbmc-fixture-refresh.ts` exports the **snapshot types** and the refresh function.
- `scripts/verify-m046-s01.ts` contains the only full Zod validation for the checked-in **snapshot JSON**, plus drift/provenance inspection logic.

What is missing:

- there is **no exported `loadXbmcFixtureSnapshot()` / `assertValidXbmcFixtureSnapshot()` helper** in `src/`.

Why this matters:

S02 needs typed access to the full retained/excluded snapshot rows. If the slice stays script-only, it can duplicate S01’s schema again — but that would create a second copy of the same snapshot contract. The cleaner seam is to extract snapshot parsing/validation into a reusable `src/contributor/*` helper and let both S01/S02 verifiers consume it.

### 2. The live runtime path is narrower than “incremental scoring” sounds

Relevant file:

- `src/handlers/review.ts`

Current reality:

- the only non-test call site for contributor scoring is the fire-and-forget call in `review.ts`
- it always calls `updateExpertiseIncremental({ type: "pr_authored" })`
- the `filesChanged` input is just the current PR’s `reviewFiles`
- the update happens only when Kodiai actually processes a review

So the real live path is not “all repo activity incrementally updates profiles.” It is closer to:

> **Kodiai-reviewed PR authored-only updates on whatever linked profiles happen to exist**.

That distinction matters for S02 because xbmc fixture truth is based on repo-backed contributor evidence, while the live system only sees a much narrower slice of that activity.

### 3. Linked-but-unscored profiles are already treated as profile-backed

Relevant files:

- `src/slack/slash-command-handler.ts`
- `src/contributor/profile-store.ts`
- `src/contributor/experience-contract.ts`
- `src/handlers/review.ts`
- `src/db/migrations/011-contributor-profiles.sql`

Current behavior chain:

- `/kodiai link <github-username>` creates or updates a profile immediately.
- `contributor_profiles.overall_tier` defaults to `'newcomer'`.
- the slash handler only logs `"Expertise seeding deferred to background job"`; there is no actual seeding call.
- `review.ts` accepts any normalized stored tier from the linked profile and maps it through `projectContributorExperienceContract()`.
- `lastScoredAt` exists in the schema and types, but it is **not consulted** in the review or Slack projection path.

This is one of the highest-value S02 findings to surface explicitly:

> A newly linked contributor with **no actual scoring pass** is still treated as **profile-backed newcomer**.

That is exactly the kind of freshness/unscored-profile diagnostic the roadmap asked S02 to report.

### 4. The exported scorer helpers are useful, but the current evaluator seam is impure

Relevant file:

- `src/contributor/expertise-scorer.ts`

Useful existing pieces:

- `normalizeScore(raw)`
- `deriveUpdatedOverallScore(...)`
- `extractFileArea(...)`
- `computeDecayedScore(signals)`

But there are two evaluator constraints:

1. `computeDecayedScore()` depends on `Date.now()`, so deterministic evaluation wants a reference-time wrapper or clock control.
2. `updateExpertiseIncremental()` stamps `new Date()` internally and requires real `filesChanged` input.

Fresh direct probe during research:

```bash
bun -e 'import { normalizeScore } from "./src/contributor/expertise-scorer.ts"; import { calculateTierAssignments } from "./src/contributor/tier-calculator.ts"; const repeated=(n)=>{let s=0; for(let i=0;i<n;i++) s=s*0.9+normalizeScore(3)*0.1; return s;}; ...'
```

Observed current values:

- `normalizeScore(1) = 0.0794`
- `normalizeScore(2) = 0.0832`
- `normalizeScore(3) = 0.0871`
- one `pr_authored` incremental update from zero only reaches about **0.0087**
- ten repeated same-topic `pr_authored` updates only reach about **0.0567**

That is even more conservative than the milestone research already noted. S02 should capture this in its report because it explains why the live incremental path is structurally compressed before percentile tiering even starts.

### 5. The “intended full-signal path” in code is still incomplete

Relevant file:

- `src/contributor/expertise-scorer.ts`

What the current batch scorer actually does:

- fetches authored commits through `repos.listCommits(...)`
- fetches closed PRs through `pulls.list(...)`
- hydrates authored PR file lists with `pulls.listFiles(...)`
- never fetches review activity, even though `pr_review` exists in `SIGNAL_WEIGHTS`

Other fidelity gaps still present:

- the commit path expects `commit.files?`, but `listCommits()` is not a file-details API
- PR collection is capped at the first 3 pages of closed PRs repo-wide, then filtered in memory by author

So S02 should **not** present the current batch scorer as a perfect “intended model” oracle. The report needs an explicit distinction between:

- **conceptual intended full-signal behavior**
- **what `computeExpertiseScores()` can currently approximate**

Otherwise the slice risks validating a model implementation that still omits review ingestion.

### 6. Percentile tiering remains small-N and tie unstable

Relevant files:

- `src/contributor/tier-calculator.ts`
- `src/contributor/profile-store.ts`
- `src/contributor/tier-calculator.test.ts`

Current mechanics:

- tiers are assigned by percentile bands over cohort ranking
- sorting is only by `overallScore`
- `profileStore.getAllScores()` has no SQL `ORDER BY`

Fresh direct probe during research showed:

- 2 contributors collapse to `newcomer` / `senior`
- 3 contributors collapse to `newcomer` / `established` / `senior`
- equal scores flip tier assignment based on input order

Current tests only cover:

- all-zero newcomers
- a 10-profile happy-path percentile ladder
- no tie case
- no deterministic-order guard
- no small-N policy guard

S02 should therefore include explicit **tie instability** and **small cohort instability** output, not bury them in notes.

### 7. The M045 contract mapping seam is already usable and should be reused directly

Relevant files:

- `src/contributor/experience-contract.ts`
- `src/handlers/review.ts`
- `src/slack/slash-command-handler.ts`
- `scripts/verify-m045-s03.ts`

Good seams already in repo:

- `projectContributorExperienceContract()` maps stored tier + source into M045 contract state
- `resolveContributorExperienceSlackProfileProjection()` maps linked-profile state into user-visible Slack copy
- `scripts/verify-m045-s03.ts` already ships:
  - scenario-oriented proof style
  - stable check IDs / status codes
  - an in-memory `ContributorProfileStore` helper suitable as a template

That means S02 should **not** hand-roll “what newcomer means” in prose. It should project evaluator outcomes through these helpers and report the actual contract consequence:

- `profile-backed`
- `coarse-fallback`
- `generic-*`

## Existing Patterns to Reuse

### `scripts/verify-m046-s01.ts`

Best pattern for:

- stable `check_ids`
- human + JSON output parity
- prerequisite fixture validation
- explicit degraded status codes instead of silent failure

S02 should mirror this proof-harness shape closely.

### `scripts/verify-m045-s03.ts`

Best pattern for:

- scenario fixtures
- contract-state projection
- in-memory contributor profile store for deterministic tests
- explicit surface drift reporting instead of vague assertions

S02 can likely reuse the same style for per-contributor report rows and final recommendation checks.

### `src/contributor/expertise-scorer.test.ts`

Best pattern for:

- pure math assertions around score derivation
- targeted tests around incremental updates

But S02 will need **new** coverage for:

- tie ordering
- small-N percentiles
- linked-but-unscored profile behavior
- live-path vs intended-path divergence

## What to Build or Prove First

### 1. Reusable snapshot access

Build or extract a typed snapshot loader first.

Natural target files:

- `src/contributor/xbmc-fixture-refresh.ts` (extend), or
- new `src/contributor/xbmc-fixture-snapshot.ts`

Why first:

Without this seam, S02 either duplicates S01’s snapshot Zod schema again or pushes too much logic into the proof script.

### 2. Pure calibration evaluator core

Recommended new file:

- `src/contributor/calibration-evaluator.ts`

The core should stay pure and accept:

- validated S01 snapshot data
- optional reference time
- optional live-hydration bundle if the planner wants file-list enrichment later

The output should include, per retained contributor:

- fixture evidence summary
- live-path modeled outcome
- intended-path modeled outcome
- contract projection for both
- freshness/unscored findings
- percentile/tie instability findings
- row-level explanatory diagnostics

The evaluator should also produce a report-level recommendation:

- `keep`
- `retune`
- `replace`

with an explicit rationale block.

### 3. Proof harness script

Recommended new files:

- `scripts/verify-m046-s02.ts`
- `scripts/verify-m046-s02.test.ts`
- `package.json` (`verify:m046:s02`)

The proof harness should:

- reuse S01 readiness as a prerequisite
- emit stable `check_ids` / `status_code`
- support `--json`
- render per-contributor outcomes clearly in human output
- exit non-zero when the evaluation cannot produce an explicit recommendation

## Recommended Slice Boundaries

### Candidate Task 1 — Snapshot contract reuse + evaluator input model

Files likely touched:

- `src/contributor/xbmc-fixture-refresh.ts` or new `src/contributor/xbmc-fixture-snapshot.ts`
- `src/contributor/fixture-set.ts` only if a shared type needs small extension
- tests for new loader/parser module

Goal:

- eliminate duplicate snapshot-contract parsing
- give S02 a reusable typed input model

### Candidate Task 2 — Calibration evaluator core

Files likely touched:

- new `src/contributor/calibration-evaluator.ts`
- new `src/contributor/calibration-evaluator.test.ts`
- possibly `src/contributor/index.ts` if the project re-exports contributor helpers centrally

Goal:

- compute live-path vs intended-path outputs from the fixture pack
- expose contract projections and recommendation logic
- keep it deterministic and testable

### Candidate Task 3 — CLI verifier / proof surface

Files likely touched:

- new `scripts/verify-m046-s02.ts`
- new `scripts/verify-m046-s02.test.ts`
- `package.json`

Goal:

- turn evaluator output into the milestone proof artifact the roadmap calls for
- keep human and JSON modes aligned
- make the recommendation explicit and machine-readable

## Risks That Should Shape Planning

### Highest-risk implementation trap: pretending the snapshot can replay file-level scoring

It cannot, at least not offline. The snapshot lacks the `filesChanged` arrays that the current incremental updater needs.

So the planner should choose one of these approaches intentionally:

1. **Pure coarse evaluator** using snapshot counts + provenance presence and reporting structural gaps explicitly.
2. **Optional live hydration** of changed-file details from recorded PR / commit evidence, with degraded status when unavailable.
3. **New checked-in evaluator fixture artifact** if the planner decides exact file-level replay is required offline.

What should be avoided is an implicit hybrid that quietly makes up missing file-area signals.

### Second trap: conflating “linked profile exists” with “calibrated profile exists”\

Because `overall_tier` defaults to `newcomer` and `lastScoredAt` is ignored, S02 must explicitly report this state as a freshness / confidence hole. Otherwise the evaluator will accidentally bless a false profile-backed path.

### Third trap: validating the wrong comparison target

The slice should compare against the **actual live path** and the **intended model contract**, while also acknowledging that the current batch implementation is incomplete. If the report compares only live path vs current `computeExpertiseScores()` implementation, it may understate how much of the original intended signal model is still missing.

## Verification Strategy for the Future Implementation

Fresh baseline verification during research:

```bash
bun run verify:m046:s01 -- --json
```

Passed during research with:

- `overallPassed: true`
- `counts.retained: 3`
- `counts.excluded: 6`
- `diagnostics.statusCode: "snapshot-refreshed"`

Fresh targeted contributor/contract tests during research:

```bash
bun test src/contributor/expertise-scorer.test.ts src/contributor/tier-calculator.test.ts src/contributor/experience-contract.test.ts scripts/verify-m046-s01.test.ts
```

Observed result during research:

- `33 pass`
- `0 fail`

Recommended done-checks for S02 implementation:

1. `bun run verify:m046:s01 -- --json`  
   Confirms the upstream fixture dependency is still valid.
2. `bun test src/contributor/calibration-evaluator.test.ts scripts/verify-m046-s02.test.ts`  
   Confirms evaluator math, contract projection, tie handling, and proof harness behavior.
3. `bun run verify:m046:s02 -- --json`  
   Confirms the shipped proof surface emits per-contributor live/intended outcomes and an explicit keep/retune/replace verdict.
4. `bun run tsc --noEmit`  
   Needed if snapshot-contract types are extracted into `src/` or shared across script + source modules.

## Bottom Line for the Planner

This slice is **not** a threshold-tuning task.

It is a proof task with one key design decision up front:

> **Will S02 model live vs intended behavior from the checked-in snapshot alone, or will it optionally hydrate missing file-level details from the recorded evidence URLs?**

Everything else flows from that choice.

The safest, smallest path is:

1. extract reusable snapshot loading/validation,
2. build a pure evaluator that reports live-path compression, unscored-profile drift, and percentile instability,
3. ship `verify:m046:s02` with stable checks and an explicit verdict.

That path satisfies R047 without prematurely changing runtime behavior.
