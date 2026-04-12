# M046 Research — Contributor Tier Calibration and Fixture Audit

## Summary

M046 should **not** start by tweaking percentile cutoffs. The first thing to prove is whether Kodiai’s current contributor data path is even collecting the signals the model claims to use. The codebase is modular enough for a clean calibration harness, but the current live path is materially narrower than the design intent:

- `src/handlers/review.ts` only triggers `updateExpertiseIncremental()` with `type: "pr_authored"`.
- `src/contributor/expertise-scorer.ts::computeExpertiseScores()` exists as the batch seeding / refresh path, but it is **not called anywhere**.
- `src/contributor/tier-calculator.ts::recalculateTiers()` also exists, but is **not called anywhere**.
- `src/slack/slash-command-handler.ts` says expertise seeding is “deferred to background job,” but no actual background-job wiring exists.

That means the system Kodiai is actually running today is much closer to **"incremental PR-authored hints + percentile ranking over whatever profiles happen to exist"** than to the intended four-signal calibration model described in earlier contributor work.

Because M045 already locked the product contract, M046 should be framed as: **does the current profile-backed scoring/tiering machinery produce plausible inputs to the M045 contract, or is the machinery itself structurally unsound?**

My current recommendation for slice ordering:

1. **S01 fixture set first** — build reusable xbmc contributor fixtures with normalized identity, bot exclusion, and raw evidence snapshotting.
2. **S02 evaluation second** — run the current model against those fixtures in at least two modes: the actual live incremental path and the intended full-signal path.
3. **S03 verdict last** — explicitly decide keep / retune / replace, and write a concrete M047 change contract instead of doing opportunistic tuning.

## Skill Discovery

Directly relevant installed skills are limited for this milestone. The repo already has adjacent installed skills like `github-bot`, but that skill is aimed at GitHub API operations as the bot identity, not contributor-calibration analysis.

I checked the open skill ecosystem for the only clearly relevant core technology here: **Bun**.

Promising external skills:

- `sickn33/antigravity-awesome-skills@bun-development` — 1.7K installs  
  Install: `npx skills add sickn33/antigravity-awesome-skills@bun-development`
- `affaan-m/everything-claude-code@bun-runtime` — 924 installs  
  Install: `npx skills add affaan-m/everything-claude-code@bun-runtime`
- `bun.sh@bun` — 683 installs  
  Install: `npx skills add bun.sh@bun`

I also checked for GitHub/Octokit-oriented skills, but the results were weak and not clearly better than the project’s existing in-repo Octokit patterns. I would **not** install anything GitHub-specific for M046 unless later implementation work shows a real gap.

## Relevant Code Reality

### 1. Current source-of-truth seam is stable and reusable

The good news is the contributor subsystem is already split cleanly:

- `src/contributor/expertise-scorer.ts`
- `src/contributor/tier-calculator.ts`
- `src/contributor/profile-store.ts`
- `src/contributor/experience-contract.ts`
- `src/handlers/review.ts`

That means M046 can evaluate the model without redesigning the whole review path. The critical boundary is:

- stored contributor profile tier = `newcomer | developing | established | senior`
- `src/handlers/review.ts` treats contributor profile as the highest-fidelity signal
- `src/contributor/experience-contract.ts` turns that stored state into the M045 contract (`profile-backed`, `coarse-fallback`, generic states)

So calibration should stay centered on the **profile-backed path**. Fallback taxonomy (`first-time | regular | core`) is separate and should not be mixed into fixture truth except as a control comparison.

### 2. The live runtime is effectively PR-authored-only

The current live hook is in `src/handlers/review.ts`, which fire-and-forgets:

- `updateExpertiseIncremental({ ..., type: "pr_authored" })`

There are **no live calls** to:

- `computeExpertiseScores()`
- `recalculateTiers()`
- `updateExpertiseIncremental(... type: "commit")`
- `updateExpertiseIncremental(... type: "pr_review")`

So the current production-ish behavior is **not** exercising commit-weight or PR-review-weight calibration at runtime.

This matters for M046: if we evaluate only the intended model and ignore the actual wired path, we can end up validating a model Kodiai is not actually using.

### 3. Incremental scoring is heavily compressed

The scoring math in `src/contributor/expertise-scorer.ts` has two important layers:

- raw decayed signal weights: `commit=1`, `pr_review=2`, `pr_authored=3`
- sigmoid normalization: `k=0.05`, midpoint `50`

Using the current code directly:

- `normalizeScore(1)` → `0.0794`
- `normalizeScore(2)` → `0.0832`
- `normalizeScore(3)` → `0.0871`

And the incremental path uses a 90/10 blend:

- `new = existing * 0.9 + normalized(single_signal) * 0.1`

From a zero baseline, even **10** repeated `pr_authored` updates on the same topic only reach about **0.0567**.

That means the incremental path asymptotically approaches the normalized value of a **single** signal per topic. In plain English: the live incremental updater is extremely conservative and cannot by itself create broad score separation from empty profiles.

This is the strongest research finding in the milestone. It pushes M046 away from “threshold tuning” and toward “is this refresh architecture even valid?”

### 4. Percentile tiering is unstable on small or tied cohorts

`src/contributor/tier-calculator.ts` uses percentile bands:

- `< 0.2` → `newcomer`
- `< 0.5` → `developing`
- `< 0.8` → `established`
- otherwise `senior`

That produces surprising behavior on small populations:

- 2 contributors → `["newcomer", "senior"]`
- 3 contributors → `["newcomer", "established", "senior"]`
- 4 contributors → all four tiers appear exactly once

More importantly, tied scores are order-sensitive. With two contributors both at `0.5`, whichever record appears first becomes `newcomer` and the second becomes `senior`.

That is not just theoretical:

- `calculateTierAssignments()` sorts by score only
- `profileStore.getAllScores()` runs `SELECT id, overall_score FROM contributor_profiles WHERE opted_out = false` with **no `ORDER BY`**

So equal or near-equal score cohorts can drift based on input order. M046 should treat this as a likely architectural problem, not a mere cutoff problem.

### 5. The batch scorer is not trustworthy yet even if wired in

`computeExpertiseScores()` is the intended full-signal batch path, but it has several fidelity gaps:

#### Commit-file extraction gap

The function expects `repos.listCommits()` results to contain `files`, but GitHub’s REST API exposes changed-file details on **Get a commit**, not on **List commits**. So the current batch scorer is very likely over-trusting commit payload shape for language/file-area extraction.

Research source used during this milestone: GitHub REST docs / current search results confirm that the per-file `files[]` array is on **Get a commit** (`GET /repos/{owner}/{repo}/commits/{sha}`), not the summary **List commits** response.

#### PR authorship sampling gap

The function pages through only the first **3 pages** of `pulls.list({ state: "closed" })` and then filters in memory by `pr.user.login`.

That means authored PR discovery is capped at the first **300 closed PRs repo-wide**, not 300 authored PRs for the contributor. On an active repo, this silently misses older qualifying PRs.

#### Review-signal gap

The file comments say the scorer fetches commits, PRs, and reviews, and `SIGNAL_WEIGHTS` includes `pr_review=2`, but the current implementation does **not** fetch review activity at all.

So the “four-signal” model described in earlier contributor work is not actually implemented end-to-end in code.

### 6. Linked-but-unscored profiles are treated as profile-backed newcomers

This is another high-risk seam.

- Migration default: `contributor_profiles.overall_tier = 'newcomer'`
- `src/handlers/review.ts` will accept any normalized stored contributor tier as profile-backed guidance
- `lastScoredAt` exists in the schema and types, but is **not used** to gate contributor-profile confidence

Combined with the missing seeding job, this means a newly linked contributor can immediately get **profile-backed newcomer** treatment even if Kodiai has never actually scored them.

That is a strong candidate for M047 follow-up, but M046 should explicitly evaluate how often this condition would poison calibration conclusions.

### 7. There is no existing M046 proof surface yet

Current reusable proof surfaces nearby:

- `scripts/verify-m042-s01.ts` — focused contributor-tier bugfix continuity checks
- `scripts/verify-m044-s01.ts` — xbmc live audit command with human + JSON report and env-gated preflight
- `scripts/verify-m045-s03.ts` — deterministic fixture matrix with named checks and structured drift diagnostics

What is missing:

- no contributor calibration fixture files in-repo
- no `verify:m046` script or equivalent package entry
- no checked-in xbmc contributor truth set
- no report that separates **signal extraction fidelity** from **tier mapping validity**

That missing proof surface is exactly what M046 should add.

## xbmc/xbmc Evidence and Constraints

A useful local asset already exists: `tmp/xbmc` is a local xbmc checkout inside the repo workspace.

I sampled recent commit history from that clone:

- `git -C tmp/xbmc shortlog -sne --since='2025-01-01' --all`
- result shape: **115 author identities** in that window
- rough commit distribution: `p50=3`, `p80=1`, `p90=1`, top band `147–373+`

This is good news for calibration because xbmc has both a clear head and a long tail. But the same sample also shows why fixture generation cannot be naïve:

- identity fragmentation is obvious (`Kai Sommerfeld` / `ksooo`, multiple emails; `Keith` duplicated across emails)
- bots and automation appear (`Hosted Weblate`, `jenkins4kodi`)
- git history alone gives commits, but not reliable PR-review counts or normalized GitHub usernames

So the right calibration corpus is likely:

1. **GitHub API / App-derived contributor activity** for authored PRs and review events
2. optionally enriched by local `tmp/xbmc` git inspection for file-area sanity checks
3. persisted as checked-in fixture JSON so reruns are offline and deterministic

Do **not** make raw `git shortlog` the truth source for M046. It is useful as a scouting input, not as the canonical fixture source.

## Existing Patterns to Reuse

### `scripts/verify-m044-s01.ts` — live/audited data collection pattern

Reuse this for:

- GitHub App bootstrap via existing auth code
- env-gated preflight and graceful degraded statuses
- human + JSON report modes
- explicit repo targeting (`xbmc/xbmc` default)

This is the best precedent for “collect live xbmc evidence, but don’t hide missing access behind false pass/fail semantics.”

### `scripts/verify-m045-s03.ts` — fixture matrix and report discipline

Reuse this for:

- named check IDs
- independent expectations instead of reusing helper logic under test
- machine-readable status codes
- scenario-oriented reporting

This is the best precedent for the deterministic half of M046 once fixture JSON exists.

### `scripts/verify-m042-s01.ts` — distribution-shaped contributor tests

Reuse this for:

- explicit score distributions rather than vague absolute-threshold tests
- direct scorer/tier seam testing without DB integration
- fail-open reasoning around contributor tier persistence

## What Should Be Proven First

1. **Signal fidelity, not tier labels.**  
   Prove whether Kodiai can build a truthful xbmc contributor signal snapshot at all: normalized identity, authored PR count, review count, commit evidence, file-area evidence.

2. **Current live path vs intended full-signal path.**  
   The milestone should evaluate both. If the actual wired path and the intended model disagree materially, the verdict is already leaning toward replace/redesign rather than simple retune.

3. **Tie/small-cohort behavior under realistic fixture sizes.**  
   If percentile ordering is unstable on the realistic number of linked/scored profiles, M046 needs to say that explicitly.

4. **Whether ambiguous middle-band contributors stay plausible under the M045 contract.**  
   Clear seniors and clear newcomers are easy. The milestone should stress the middle, because that is where “parameter retune” versus “wrong mechanism” becomes visible.

## Natural Slice Boundaries

### Slice S01 — Contributor Fixture Set

Goal: produce a reusable xbmc truth set before touching score math.

Likely work:

- define fixture schema: normalized contributor id, provenance, bot/human flag, raw activity counts, sample notes
- collect a curated xbmc-first sample spanning:
  - clear senior / maintainer
  - clear newcomer / one-off
  - ambiguous middle / returning contributor
  - suspicious / edge cases (bots, aliased identities)
- persist fixtures in repo as JSON/JSONL
- build a small collector script that can refresh fixtures from GitHub App access but writes deterministic checked-in snapshots

Why first: without this, every later calibration conclusion is hand-wavy.

### Slice S02 — Scoring and Tiering Evaluation

Goal: evaluate the current model against fixture evidence.

Likely work:

- replay current scorer math against fixture signals
- evaluate both:
  - actual live incremental path
  - intended full-signal batch path
- surface per-contributor:
  - raw signal coverage
  - normalized topic scores
  - overall score
  - assigned tier
  - contract impact on M045 profile-backed behavior
- add sensitivity checks for:
  - small-N percentile instability
  - ties / near-ties
  - no-seeding / stale-profile behavior

Why second: it converts fixtures into evidence instead of opinions.

### Slice S03 — Calibration Verdict and Change Contract

Goal: turn the evidence into an explicit recommendation for M047.

Likely work:

- write named keep / retune / replace verdict
- if retune: specify exactly what parameters change and why
- if replace: specify exactly which mechanism is invalid (percentiles, refresh path, signal extraction, or all three)
- add a top-level `verify:m046` report or equivalent conclusion surface

Why last: the milestone should not drift into implementation before the verdict is explicit.

## Risks and Failure Modes That Should Shape Ordering

### Highest-risk failure modes

1. **False calibration on bad inputs**  
   If fixtures are built from fragmented or bot-contaminated identities, the model can look “wrong” for the wrong reason.

2. **Evaluating a model Kodiai does not actually run**  
   The intended batch scorer and the live incremental path are currently different realities.

3. **Mistaking percentile instability for contributor truth**  
   Order-sensitive ties and tiny cohorts can manufacture misleading tier movement.

4. **Papering over architectural gaps with parameter tweaks**  
   The current issues are not limited to cutoffs. They include missing seeding, missing review signal ingestion, and possibly incorrect GitHub API assumptions.

5. **Overfitting to obvious extremes**  
   xbmc has a clear head and long tail. The middle band needs deliberate sampling, not random leftovers.

## Requirement Fit and Candidate Requirements

### R047 table stakes already implied

R047 is correctly scoped around:

- reusable xbmc fixture set
- repeatable evaluation surface
- explicit sound / retune / replace verdict

### What feels missing but should stay advisory unless the planner agrees

#### Candidate requirement A — Fixture provenance and exclusions must be explicit

Potential requirement text:

> Calibration fixtures record normalized contributor identity, source provenance, and explicit exclusion reasons for bots/automation/ambiguous aliases.

Why: without provenance and exclusion visibility, reruns are not trustworthy.

#### Candidate requirement B — Calibration must distinguish data-collection failure from model failure

Potential requirement text:

> The M046 evaluation surface reports named statuses for access/provenance gaps separately from score/tier verdict failures.

Why: this follows the project’s existing proof-harness discipline and avoids false conclusions when GitHub access or fixture refresh breaks.

#### Candidate requirement C — Unscored linked profiles must not silently count as calibrated profile-backed evidence

Potential requirement text:

> Calibration and rollout logic distinguish unscored linked profiles from truly scored contributor profiles, using `lastScoredAt` or an equivalent freshness gate.

Why: this is currently a real semantic hole in the model. It may belong to M047 implementation, but M046 should at least decide whether it is mandatory.

### What should remain advisory only

- broad cross-repo generalization
- UI/copy changes beyond the already-shipped M045 contract
- introducing external analytics infrastructure just for calibration

## Bottom Line for the Roadmap Planner

The natural interpretation of the current evidence is:

- **Do not** plan M046 as “tune thresholds.”
- Plan it as **fixture truth-set + model reality check + explicit verdict**.
- The most likely outcome is that M046 will uncover at least one **structural** problem:
  - missing or incorrect signal extraction,
  - refresh/seeding gap,
  - or percentile instability under realistic cohorts.

If S01 proves the fixture pipeline and S02 still shows believable results, M047 may only need a retune. If S02 confirms the current live incremental path is too compressed and order-sensitive to map contributors plausibly, M047 should be prepared for a **mechanism replacement**, not just percentile edits.

## Evidence Collected During Research

- Targeted contributor/test suites currently pass:
  - `bun test src/contributor/expertise-scorer.test.ts src/contributor/tier-calculator.test.ts src/contributor/experience-contract.test.ts src/slack/slash-command-handler.test.ts`
- Direct code probes from current scorer/tier logic showed:
  - `normalizeScore(1)=0.0794`
  - `normalizeScore(2)=0.0832`
  - `normalizeScore(3)=0.0871`
  - 10 repeated `pr_authored` incremental updates from zero on one topic ≈ `0.0567`
  - 2-profile percentile assignment = `["newcomer","senior"]`
  - equal-score assignments flip when input order flips
- xbmc local git sample from `tmp/xbmc` showed a strong head + long-tail distribution plus clear alias/bot cleanup needs.
