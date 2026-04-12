# M045 Research — Contributor Experience Product Contract and Architecture

## Executive summary
- M042 fixed truthfulness but not the product contract. The code now preserves precedence and avoids contradictory cache labels, yet the contributor-experience contract is still implicit and distributed across multiple surfaces.
- The deepest architectural problem is not just “3-tier vs 4-tier”; it is that one `AuthorTier` string union in `src/lib/author-classifier.ts` mixes provenance tiers (`first-time | regular | core`) with persisted profile tiers (`newcomer | developing | established | senior`), and downstream surfaces consume those raw strings directly.
- GitHub review prompt + Review Details already have strong proof harnesses (`scripts/verify-m042-s02.ts`, `scripts/verify-m042-s03.ts`). Slack profile and retrieval shaping do not.
- Two contract gaps surfaced immediately:
  1. Slack `/kodiai profile opt-out` promises “generic (non-adapted) reviews”, but `src/handlers/review.ts` still falls back to author-cache/fallback adaptation when the opted-out profile disappears.
  2. Contributor-profile resolution is currently hidden behind `knowledgeStore` presence; if `knowledgeStore` is unavailable, review handling defaults to `regular` / developing guidance without consulting `contributorProfileStore`.

## Skill discovery
- Installed skills: `chat-sdk` is adjacent but not a direct fit for raw Hono + Slack slash-command plumbing.
- No installed Hono-specific skill is present.
- Promising external skills found during research (not installed):
  - `npx skills add yusukebe/hono-skill@hono` — strongest Hono match (3K installs).
  - `npx skills add stablyai/agent-slack@agent-slack` — strongest Slack-specific match (936 installs).
  - `npx skills add mike-coulbourn/claude-vibes@slash-command-builder` — narrower Slack slash-command helper (22 installs).
- These are optional. M045 is mostly contract/architecture work, not framework discovery.

## Current implementation map
- `src/handlers/review.ts`
  - `resolveAuthorTierFromSources()` precedence is contributor profile -> `author_cache` -> fallback classifier.
  - `resolveAuthorTier()` reads profile store + author cache + GitHub Search PR count, then returns a raw `AuthorTier`.
  - The review handler threads that resolved tier into prompt building, retrieval variants, Review Details, retry prompts, and telemetry.
- `src/lib/author-classifier.ts`
  - `AuthorTier` currently contains all seven labels across both taxonomies.
  - `classifyAuthor()` is the 3-tier fallback classifier (`first-time | regular | core`).
- `src/contributor/types.ts`, `src/contributor/tier-calculator.ts`, `src/contributor/expertise-scorer.ts`, `src/contributor/profile-store.ts`
  - Persistent contributor profiles use the 4-tier model (`newcomer | developing | established | senior`) backed by `contributor_profiles.overall_tier`.
  - `src/db/migrations/011-contributor-profiles.sql` hard-codes `overall_tier DEFAULT 'newcomer'`.
- `src/execution/review-prompt.ts`
  - `buildAuthorExperienceSection()` merges both taxonomies into one prompt-policy function.
  - Same user-facing behavior is duplicated as literal copy per tier.
- `src/lib/review-utils.ts`
  - `formatReviewDetailsSummary()` independently re-maps tier strings to visible labels like `newcomer guidance`, `developing guidance`, etc.
  - It accepts `authorTier?: string`, not the union type.
- `src/knowledge/multi-query-retrieval.ts`
  - The live review path adds `author: <tier>` only to the “intent” retrieval variant.
  - This surface also accepts `authorTier?: string`.
- `src/knowledge/retrieval-query.ts`
  - Legacy single-query builder still appends `Author: <tier>`, but it is currently test-only / unused by the live review path.
- `src/slack/slash-command-handler.ts`
  - `/kodiai profile` prints raw persisted `overallTier` and score/expertise.
  - link/opt-in/opt-out copy makes product promises about adaptation.
- `src/handlers/identity-suggest.ts`
  - DM copy says linked accounts get “personalized code reviews”, which is another implicit product contract outside the main review surface.

## Key findings and surprises
1. One type currently carries three different meanings.
   - `AuthorTier` is simultaneously:
     - the low-fidelity fallback taxonomy,
     - the high-fidelity persisted profile taxonomy,
     - the UI/prompt vocabulary.
   - That makes “what we know” and “how we behave” inseparable.
2. The real architecture seam is provenance vs behavior, not just taxonomy count.
   - `resolveAuthorTierFromSources()` returns a raw tier plus source, but downstream renderers mostly consume only the raw tier.
   - Review prompt and Review Details cannot distinguish “high-confidence established” from “coarse cached core” except through the literal tier chosen upstream.
3. Review-surface copy is duplicated, not centralized.
   - `buildAuthorExperienceSection()` and `formatReviewDetailsSummary()` each encode their own tier-to-guidance mapping.
   - Slack profile formatting and retrieval query shaping are separate again.
4. Slack opt-out semantics are currently contradictory.
   - `src/slack/slash-command-handler.ts` says opted-out users receive generic, non-adapted reviews.
   - `src/contributor/profile-store.ts#getByGithubUsername()` hides opted-out profiles from review resolution.
   - `src/handlers/review.ts` then falls back to author cache / fallback classification, which still adapts tone.
5. The contributor-profile “source of truth” is still coupled to the knowledge subsystem.
   - The review handler only calls `resolveAuthorTier()` inside `if (knowledgeStore)`.
   - If `knowledgeStore` is missing or resolution throws, the handler keeps the default `regular` tier and proceeds with developing guidance.
6. The current failure default is itself a product choice.
   - Classification failure or missing knowledge store does not mean “no adaptation”; it means “regular/developing guidance”.
   - That may be acceptable, but it is not documented as the contract anywhere.
7. Retrieval surface is weakly coupled and easy to narrow.
   - Contributor experience affects retrieval only by adding a single text token to one query variant.
   - If M045 decides retrieval should not depend on contributor experience, this is a small change with limited blast radius.
8. `buildRetrievalQuery()` is already stale relative to the live path.
   - M045 should either align or retire it to avoid dead contract drift.
9. Schema change may be optional; behavior change is not.
   - `author_cache.tier` and `contributor_profiles.overall_tier` are `TEXT`, so a DB migration may not be necessary for label renames.
   - But migration 011, defaults, tests, and copy still encode the current terminology.

## Verification baseline
Current proof surfaces are strong for GitHub review behavior and thin elsewhere.

Verified during research:
- `bun run verify:m042:s01` — PASS
- `bun run verify:m042:s02` — PASS
- `bun run verify:m042:s03` — PASS
- `bun test src/slack/slash-command-handler.test.ts src/knowledge/retrieval-query.test.ts src/knowledge/multi-query-retrieval.test.ts src/lib/review-utils.test.ts` — 31 pass / 0 fail

What exists already:
- M042 proof harnesses cover:
  - persisted-tier recalculation and precedence,
  - prompt truthfulness,
  - Review Details truthfulness,
  - cache/fallback non-contradiction.
- Unit tests cover:
  - Slack profile card rendering and opt-in/out command behavior,
  - retrieval query/variant text shaping,
  - Review Details tier text.

What is still missing:
- no milestone-level verifier that proves Slack profile output, opt-out semantics, retrieval query shaping, and review surfaces all match the same chosen contract.
- no proof surface for the current “generic reviews” opt-out promise.
- no proof surface asserting whether contributor experience should remain visible in Review Details vs prompt-only vs Slack-only.

## Constraints and boundary contracts
- R046 is the active requirement; R039-R042 are continuity constraints.
  - M045 can change the contract, but it should not reintroduce the old M042 failure mode: contradictory or overclaiming tier guidance.
- The GitHub review surface is the core product surface and already has deterministic proof harnesses.
  - This is the safest place to anchor the contract first.
- `src/handlers/review.ts` is 4,354 LOC and `src/execution/review-prompt.ts` is 2,285 LOC.
  - Favor a small exported contract module consumed by existing files over a large structural rewrite.
- Several downstream surfaces are stringly typed (`authorTier?: string`, `overallTier: string`).
  - If M045 keeps multiple terms, drift will continue unless typing is tightened.
- `author_cache` was intentionally restricted in M042 to low-fidelity fallback values only.
  - If M045 wants one public taxonomy everywhere, it must either:
    1. preserve cache as coarse internal confidence buckets and map them deliberately, or
    2. redesign cache semantics with equal care to avoid overclaiming.

## What should be proven first
1. The GitHub review-surface contract.
   - Decide whether contributor experience changes:
     - prompt tone only,
     - prompt + Review Details visibility,
     - or neither on uncertain/degraded paths.
   - Existing M042 harnesses make this the fastest place to detect regressions.
2. Opt-out semantics.
   - Decide whether opting out means:
     - no contributor-adapted behavior at all, or
     - only no profile-backed personalization while coarse repo history still applies.
   - Current shipped copy says the former; current implementation behaves like the latter.
3. Retrieval/Slack scope.
   - Decide whether these surfaces are part of the contributor-experience contract or should become informational-only / contract-excluded.
4. Then prove one central mapping can drive all remaining in-scope surfaces.

## Recommended slice boundaries for the roadmap
### S01 — Surface Contract and Product Position
Goal: settle the product matrix before broad refactoring.
- Decide per surface: review prompt, Review Details, retrieval shaping, Slack profile, opt-out messaging, identity-link messaging.
- Explicitly answer the open questions from milestone context:
  - visible in Review Details, prompt only, or both?
  - should fallback taxonomy survive at all, and if so as internal confidence only or user-visible vocabulary?
  - how much explanation-depth variation is desirable?
- Deliverable should be executable: an exported contract shape or policy table, not only prose.

Why first:
- this retires the main risk: implementing taxonomy changes without a product answer.
- it also forces the opt-out contradiction into the open.

### S02 — Taxonomy and Architecture Unification
Goal: make one code path own the chosen truth.

Likely seams:
- extract a single contributor-experience contract module that converts source data + confidence into:
  - review prompt behavior,
  - Review Details visibility/labels,
  - retrieval hint input (or explicit omission),
  - Slack/profile display model.
- decouple contributor-profile resolution from `knowledgeStore` presence if the contract still relies on it.
- tighten stringly surfaces to typed contract inputs.
- either delete or align `src/knowledge/retrieval-query.ts` so dead helpers do not preserve old semantics.
- update Slack/identity-link copy to match the actual contract.

Why second:
- once the contract is explicit, this becomes largely mechanical refactoring plus targeted policy edits.
- it also keeps the big files (`review.ts`, `review-prompt.ts`) stable by routing them through one smaller module.

### S03 — Cross-Surface Contract Proof
Goal: add the proof surface M045 currently lacks.
- Build an M045 verifier similar to M042:
  - human-readable + JSON output,
  - named checks,
  - direct assertions for review prompt/details, retrieval variants, Slack profile output, and opt-out behavior.
- Preserve or update M042 checks as regression guards where still applicable.

Why third:
- the contract and architecture will still be fragile until there is one milestone-level verifier that spans all in-scope surfaces.

## Requirement analysis
### Table stakes from active requirements
- **R046** is the direct milestone target: one explicit contributor-experience contract across in-scope surfaces.
- **R048** is a downstream continuity expectation: M045 should shape the rollout so M047 can prove end-to-end coherence, not discover new ambiguity.

### Continuity expectations from validated work
- **R039-R042** effectively say:
  - profile-backed truth must beat weaker signals,
  - degraded paths must stay truthful and fail open,
  - proof harnesses matter.
- M045 should preserve these properties even if it changes the wording or visibility model.

### Behaviors that are currently missing from the requirement set
Candidate requirements for planner/user review:
1. **Opt-out semantics must be explicit and truthful.**
   - If users opt out, either all contributor-adapted behavior stops, or the shipped copy must say exactly what still adapts.
2. **All in-scope contributor-experience surfaces must consume one typed contract, not raw free-form tier strings.**
   - This is the smallest durable way to stop future drift.
3. **M045 should ship a milestone-level verifier that spans Slack + retrieval + review surfaces, not only prompt/details.**
   - Otherwise R046 can be claimed without proving cross-surface coherence.

Advisory only, not necessarily requirements:
- retire or align `src/knowledge/retrieval-query.ts` if it remains unused.
- update identity-link DM copy if contributor linking no longer implies personalized reviews.

## Risks that should shape slice ordering
- Product contraction is a valid outcome.
  - The right answer may be less visible adaptation, not better-preserved tiers everywhere.
  - That argues for deciding scope before refactoring storage or recalibration.
- Over-unifying taxonomy could erase useful confidence semantics.
  - The current 3-tier fallback intentionally encodes lower confidence.
  - A naive “everything becomes the same four labels” change could overclaim certainty.
- Big-file blast radius is real.
  - `review.ts` and `review-prompt.ts` are large enough that broad rewrites raise regression risk quickly.
- Slack/retrieval may look small but are where false product promises currently live.
  - Especially opt-out and “personalized code reviews” messaging.

## Recommended direction
Use M045 to separate **experience policy** from **tier provenance**.

A good target shape is not “pick one set of labels and reuse them everywhere”; it is:
- one internal contract that knows:
  - what source produced the contributor signal,
  - how confident/coarse that signal is,
  - what behavior is allowed on each surface,
  - what, if anything, should be shown to the user.
- user-visible copy then becomes a deliberate projection of that contract, not the raw stored/cache label.

That keeps M045 focused on architecture and product truth, while leaving M046 free to evaluate whether the scoring/tiering itself is any good.
