# M047 S02 Research — Contract-first Slack, retrieval, and profile continuity rollout

## Research depth

Targeted research. S01 already established the trust boundary and review-time resolver. S02 is mostly about rolling that existing truth boundary through the remaining Slack/profile continuity surfaces and proving retrieval stays aligned.

## Requirement read

### R048

S02 is the slice that makes R048 true outside the GitHub review entrypoint:

- remove the remaining raw stored-tier assumptions on Slack/profile surfaces
- keep retrieval hints aligned with the already-shipped review-time contract seam
- ensure link/opt/profile continuity text does not falsely claim active `profile-backed` guidance when the stored profile is merely linked, legacy, stale, or malformed

S01 already advanced the review-path requirement work. S02 should **reuse** that trust boundary, not invent a second interpretation.

## Executive read

This slice is **not** a new scoring or persistence project. The remaining work is mostly a Slack/profile rollout problem plus proof:

1. `src/slack/slash-command-handler.ts` still treats raw `profile.overallTier` as trustworthy and hard-codes optimistic “active linked guidance” copy.
2. The live review retrieval path is already contract-first after S01, so retrieval likely needs **verification coverage more than production logic changes**.
3. `src/handlers/identity-suggest.ts` has one real continuity bug: it looks up existing profiles without `includeOptedOut: true`, so opted-out linked profiles can be treated as absent and still receive identity-link suggestion DMs.
4. Current Slack/verifier fixtures are still effectively pre-S01 on this axis: their “linked profile is active” scenarios omit `trustMarker`, so `verify:m045:s03` passing does **not** prove M047 truthfulness for persisted-profile states.

Safest path: add one shared **stored-profile-to-surface contract resolver**, rewire Slack/profile messages to use it, fix opted-out identity suppression, and add slice-level proof that composes with S01 instead of mutating review logic again.

## Commands run

- `npx skills find "Slack"`
- `npx skills find "Hono"`
- `bun test ./src/contributor/experience-contract.test.ts ./src/slack/slash-command-handler.test.ts ./src/routes/slack-commands.test.ts ./src/handlers/identity-suggest.test.ts ./src/knowledge/retrieval-query.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./scripts/verify-m045-s03.test.ts`
- `bun run verify:m045:s03 -- --json`
- `rg -n "resolveContributorExperienceSlackProfileProjection|formatProfileCard|profile opt|suggestIdentityLink|getByGithubUsername\(|authorHint|trustMarker" src scripts`
- `rg -n "verify:m047:s02|verify-m047-s02" . -g '!node_modules'`

### Baseline status

- The targeted baseline test bundle passed: **53 pass / 0 fail**.
- `verify:m045:s03 -- --json` currently passes.
- No `verify:m047:s02` script exists yet.

## Skill discovery

Following the **find-skills** rule to search only for directly relevant technologies and to present install commands without installing anything, I only looked at Slack and Hono.

### Already installed and relevant enough

- `chat-sdk` exists, but this slice is custom Slack slash-command + Hono route work, not Chat SDK bot work.
- `github-bot` / `github-workflows` are not central to S02.

### Promising external skills found

- **Slack:** `stablyai/agent-slack@agent-slack` — 937 installs  
  Install: `npx skills add stablyai/agent-slack@agent-slack`
- **Hono:** `yusukebe/hono-skill@hono` — 3K installs  
  Install: `npx skills add yusukebe/hono-skill@hono`

I did not install anything.

## What exists now

### 1) The public contract seam is already stable

`src/contributor/experience-contract.ts` still looks like the right durable public vocabulary:

- `profile-backed`
- `coarse-fallback`
- `generic-unknown`
- `generic-opt-out`
- `generic-degraded`

It already drives:

- review prompt shaping
- Review Details text
- retrieval author hints via `resolveContributorExperienceRetrievalHint(...)`
- Slack profile projection text via `resolveContributorExperienceSlackProfileProjection(...)`

The important caveat: the Slack helper is only truthful **if the caller passes a truthful source+tier input**. It has no persisted-profile trust input of its own.

### 2) Review-time retrieval is already contract-first after S01

`src/handlers/review.ts` now does:

- `resolveReviewAuthorClassification(...)`
- `resolveContributorExperienceRetrievalHint(authorClassification.contract)`
- `buildRetrievalVariants({ authorHint })`

So the live review retrieval path is already downstream of the S01 truth boundary. `src/knowledge/retrieval-query.ts` and `src/knowledge/multi-query-retrieval.ts` simply normalize/omit `authorHint`; they do not infer contributor semantics themselves.

Implication: retrieval is probably a **proof/composition task**, not a production refactor, unless S02 decides to change the public hint vocabulary (which would contradict M045/M046 evidence).

### 3) Slack profile output still trusts raw stored tier data

`src/slack/slash-command-handler.ts` is the remaining raw-tier consumer:

- `formatProfileCard(...)` only receives `{ githubUsername, overallTier, optedOut }`
- it calls `resolveContributorExperienceSlackProfileProjection({ source: "contributor-profile", tier: profile.overallTier, optedOut: profile.optedOut })`
- it therefore still treats any normalized stored tier as active linked guidance

That means S01’s trust marker boundary is currently bypassed on `/kodiai profile`.

### 4) Link and opt-in copy still overclaims “active linked guidance”

Two strings are now false for newly linked / legacy / stale profiles:

- `link`: `Your contributor profile is now active.`
- `profile opt-in`: `Contributor-specific guidance is now on for your linked profile.`

Both assume `profile-backed` guidance immediately after mutation, even though `linkIdentity(...)` creates/updates rows that remain untrusted until a fresh calibrated score stamps `trust_marker`.

`profile opt-out` copy is already generic-safe and likely needs little or no behavioral change.

### 5) Route dependency surface is intentionally narrow

`src/routes/slack-commands.ts` injects only:

- `config`
- `logger`
- `profileStore`

It executes `result.asyncWork()` but currently that async work only logs. So:

- this route surface is already sufficient for **truthful continuity copy**
- it is **not** sufficient for full link-time recalculation unless the dependency surface expands

That matters for planning: if S02 stays focused on truthful contract rollout, route changes can stay minimal.

### 6) Identity suggestion wording is mostly safe, but opted-out suppression is wrong

`src/handlers/identity-suggest.ts` already uses cautious copy:

- `...so Kodiai can use your linked contributor profile when available.`

That wording does **not** falsely promise immediate profile-backed guidance for newly linked rows.

But the existing lookup is:

- `profileStore.getByGithubUsername(githubUsername)`

and the store default hides opted-out rows. The repo knowledge file already records the rule: internal contract/system lookups must use `includeOptedOut: true` when opt-out state matters. Identity suggestion currently violates that rule.

Result: an opted-out linked contributor can be treated as “no existing profile” and still receive a suggestion DM.

### 7) Current Slack/verifier fixtures are not trust-aware yet

This was the biggest hidden coupling in the slice.

#### `src/slack/slash-command-handler.test.ts`

Positive linked-profile tests seed rows with:

- `overallTier`
- `overallScore`
- `lastScoredAt`

but **no `trustMarker`**.

Under S01 semantics, those fixtures represent legacy/untrusted rows unless explicitly stamped.

#### `scripts/verify-m045-s03.ts`

The same issue exists in the cross-surface verifier:

- `buildSlackProfileSeed(...)` creates profile rows with `lastScoredAt` but no `trustMarker`
- `toContributorProfile(...)` drops `trustMarker`
- the in-memory `updateTier(...)` helper updates `lastScoredAt` but does not stamp the current trust marker

So `verify:m045:s03` is still proving the **M045 rendering contract**, not the **M047 persisted-profile truth boundary**.

### 8) There is no slice-level verifier for S02 yet

Search confirms there is currently no:

- `scripts/verify-m047-s02.ts`
- `scripts/verify-m047-s02.test.ts`
- `package.json` script for `verify:m047:s02`

That means S02 currently has no operator-facing proof surface equivalent to S01’s `verify:m047:s01`.

## Key findings and surprises

### A) The riskiest gap is fixture truth, not retrieval code

I expected retrieval to need code changes. It probably does not. The bigger problem is that the existing Slack/profile tests and `verify:m045:s03` positive fixtures still seed “active linked guidance” from rows that no longer satisfy the S01 trust boundary.

### B) Identity suggestion has a real opt-out continuity bug today

This is not just a wording concern. Because `suggestIdentityLink(...)` uses the default GitHub-profile lookup, it can ignore opted-out rows and continue suggesting links to contributors who already opted out.

### C) S02 does not need route expansion unless the product insists on link-time recalibration

If the goal is truthful continuity, the route can stay exactly as-is. The handler can resolve and message the **current** stored-profile state without trying to recalculate expertise immediately.

### D) Reusing the review resolver directly on Slack would be overbuilt

`resolveReviewAuthorClassification(...)` depends on knowledge store/search/fallback behavior that makes sense for review-time author inference. `/kodiai profile` is different: it is about the current persisted linked profile, not author-cache or GitHub-search fallback.

So Slack/profile continuity should mirror the **stored-profile trust boundary**, not import the whole review fallback stack.

## Natural seams for the planner

### Seam 1 — Add one shared stored-profile surface resolver

**Likely files:**

- new helper near `src/contributor/experience-contract.ts` or a new `src/contributor/profile-surface-resolution.ts`
- maybe `src/contributor/experience-contract.test.ts`

**What it should do:**

Given a persisted `ContributorProfile`, derive the surface-safe contract from:

- `profile.optedOut`
- `classifyContributorProfileTrust(profile)`
- normalized stored tier

**Why this seam matters:**

It lets Slack/profile surfaces consume the S01 truth boundary without importing review-time fallback/search logic.

**Likely outcomes:**

- opted-out => `generic-opt-out`
- calibrated + valid tier => `profile-backed`
- linked-unscored / legacy / malformed => generic surface (likely `generic-unknown`)
- stale => decide explicitly between `generic-unknown` and `generic-degraded`; do not leave this implicit

### Seam 2 — Rewire Slack slash-command continuity messaging

**Primary file:** `src/slack/slash-command-handler.ts`

**Supporting tests:**

- `src/slack/slash-command-handler.test.ts`
- possibly `src/routes/slack-commands.test.ts`

**What changes:**

- `formatProfileCard(...)` should consume a full profile or pre-resolved contract, not just `overallTier`
- resolve the contract before fetching expertise so generic states can skip `getExpertise(...)`
- `link` and `profile opt-in` should compute post-mutation messaging from the actual resolved contract instead of hard-coding “active linked guidance”
- `profile opt-out` likely remains mostly unchanged

### Seam 3 — Fix identity-link continuity for opted-out profiles

**Files:**

- `src/handlers/identity-suggest.ts`
- `src/handlers/identity-suggest.test.ts`

**What changes:**

- use `getByGithubUsername(githubUsername, { includeOptedOut: true })`
- suppress DM when a linked/opted-out row already exists
- keep the current DM wording unless product wants stricter copy

**Important test rule:**

Use `resetIdentitySuggestionStateForTests()` in setup/teardown. The repo knowledge file already records that the in-memory cache/suggestion set otherwise bleeds across tests.

### Seam 4 — Add slice-level proof instead of overloading M045 proof

**Likely files:**

- `scripts/verify-m047-s02.ts`
- `scripts/verify-m047-s02.test.ts`
- `package.json`
- possibly updates in `scripts/verify-m045-s03.ts` only where trust-aware fixture plumbing is reusable

**What it should prove:**

- trusted calibrated profile => Slack `/kodiai profile` is truly active and shows expertise
- linked-unscored / legacy / stale / malformed profile => Slack/profile/link/opt-in surfaces never claim active linked guidance
- opted-out linked profile => generic Slack state and no identity-link DM
- retrieval author hints derived from S01/runtime contract remain aligned for the same contributor-state matrix

**Design guidance:**

Follow the existing M045 knowledge rule: keep expected phrases local to the verifier instead of generating them from the same helper under test.

## What to build or prove first

1. **Decide the stored-profile-only Slack state mapping.**  
   The only real product ambiguity is how stale rows should present on `/kodiai profile` and opt-in continuity text. Everything else is already constrained by S01.

2. **Implement the shared stored-profile resolver.**  
   This unblocks profile card output and truthful mutation responses.

3. **Update the slash-command handler.**  
   This is the main user-visible surface still leaking raw-tier certainty.

4. **Fix identity suggestion opted-out suppression.**  
   Small, self-contained, and important for continuity/privacy truth.

5. **Make the proof harness trust-aware.**  
   Update or replace the current Slack/profile verifier fixtures so they stamp `CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER` for genuinely active profiles and explicitly cover untrusted rows.

## Constraints and non-goals

- No new database migration appears necessary; `trust_marker` already exists from S01.
- No retrieval-builder rewrite appears necessary; both retrieval builders already accept optional `authorHint` and omit it cleanly.
- Avoid expanding `routes/slack-commands.ts` dependencies unless the slice explicitly chooses to trigger full recalculation on link/opt-in.
- Avoid piping author-cache / GitHub-search fallback semantics into `/kodiai profile`; that surface should describe the linked profile truthfully, not mimic review-time fallback inference.

## Verification plan

Per the **verification-before-completion** rule, the slice should not claim success without fresh evidence from the exact commands below.

### Code-level verification

- `bun test ./src/contributor/experience-contract.test.ts ./src/slack/slash-command-handler.test.ts ./src/routes/slack-commands.test.ts ./src/handlers/identity-suggest.test.ts`
- add any new helper/unit test file explicitly if created
- `bun run tsc --noEmit`

### Proof-surface verification

- `bun run verify:m047:s01`
- `bun run verify:m045:s03` if that harness is updated
- `bun run verify:m047:s02 -- --json` once added

### Verification gotchas already recorded in repo knowledge

1. **Bun can ignore missing file filters.**  
   If S02 adds `scripts/verify-m047-s02.test.ts`, do not treat a broad multi-path `bun test` bundle as proof the file exists; either run the file directly or explicitly confirm the path/script exists.

2. **Identity-suggest tests need state reset.**  
   Call `resetIdentitySuggestionStateForTests()` around tests/verifier scenarios that assert Slack API fetch order or DM behavior.

## Recommended slice shape

The smallest truthful S02 is:

- one shared stored-profile surface resolver
- Slack/profile/link/opt-in rewiring to use it
- opted-out identity-suggestion suppression fix
- a new slice-level verifier that composes S01/runtime truth with Slack/profile/retrieval continuity

If the planner keeps the scope there, S02 stays targeted and mechanical. If it tries to reopen scoring or add link-time recalculation, it will expand into a different slice.