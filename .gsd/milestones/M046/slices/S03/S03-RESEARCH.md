# M046 S03 Research — Explicit Calibration Verdict and M047 Change Contract

## Requirement focus
- **R047** — S03 closes the loop on the fixture-driven calibration work by turning the already-shipped S01 fixture proof and S02 calibration proof into one milestone-level decision surface. The slice should not reopen score math; it should make the end-state explicit.
- **Downstream support for R048** — M047 still owns the shipped rollout, but S03 needs to hand M047 a concrete stay/change/replace contract instead of leaving the redesign open-ended.

## Executive summary
- This is a **targeted verifier-composition slice**, not a new architecture slice. S01 and S02 already shipped the hard parts:
  - `bun run verify:m046:s01 -- --json` currently passes with `retained=3`, `excluded=6`, complete provenance, and alias/source diagnostics.
  - `bun run verify:m046:s02 -- --json` currently passes and returns `recommendation.verdict = "replace"` with divergent contributors `fuzzard` and `koprajs`, plus stale contributor `fkoemep`.
  - `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts` currently passes **23/23**.
- Following the **writing-plans** skill’s file-structure-first rule, the blast radius should stay small and explicit: one new top-level verifier script, one test file, one `package.json` entry, and only an optional tiny pure helper if the change-contract data deserves reuse.
- The most important semantic rule for S03 is: **proof-harness success is not the same thing as calibration verdict**. A truthful final verdict of `replace` should still exit 0. Non-zero should mean the proof surface is broken, not that the answer was inconvenient.
- No runtime behavior change is required in S03. The slice should publish an integrated milestone proof plus a concrete M047 contract; M047 implements the redesign.

## Skill discovery
Following the **find-skills** skill, I only searched the core tech directly involved in this slice: **Bun**.

Installed skills already relevant enough:
- Existing in-repo verifier patterns are stronger than any extra installed skill for this slice.
- No additional installed skill is more relevant than the repo’s current Bun/TypeScript proof-harness conventions.

Promising external skills (not installed):
- `npx skills add sickn33/antigravity-awesome-skills@bun-development` — 1.7K installs
- `npx skills add affaan-m/everything-claude-code@bun-runtime` — 924 installs
- `npx skills add bun.sh@bun` — 683 installs

No install is warranted for S03; existing repo patterns are sufficient.

## Implementation landscape

### Existing proof surfaces to compose, not rewrite
- `scripts/verify-m046-s01.ts`
  - Canonical fixture-pack verifier.
  - Emits stable named checks for manifest validity, snapshot validity, curated sync, cohort coverage, provenance completeness, source availability, and alias diagnostics.
- `scripts/verify-m046-s02.ts`
  - Canonical calibration verifier.
  - Emits stable named checks, per-contributor live-vs-intended diagnostics, excluded controls, and the current `keep | retune | replace` recommendation.
  - Important seam: `evaluateM046S02()` already accepts an injectable `_evaluateS01` implementation, so S03 can evaluate S01 **once** and pass the exact same report into S02 instead of running S01 twice.
- `src/contributor/calibration-evaluator.ts`
  - Pure verdict engine already returning the current recommendation.
  - Current rationale is explicitly about live-path compression and divergence, not vague tuning language.
- `src/contributor/xbmc-fixture-snapshot.ts`
  - Shared offline fixture contract. S03 should keep reusing this only through the existing verifiers, not by duplicating snapshot logic.

### Best local patterns to copy
- `scripts/verify-m045-s03.ts`
  - Best precedent for a slice that composes an upstream verifier into one downstream operator command while preserving nested evidence intact.
- `scripts/verify-m027-s04.ts`
  - Best precedent for a milestone-level integrated proof harness with top-level checks plus nested raw evidence from prior stages.

### Current runtime seams the M047 contract must name
- `src/handlers/review.ts`
  - Contributor-profile resolution treats any normalized stored `overallTier` as profile-backed guidance.
  - There is **no** `lastScoredAt` or freshness gate before trusting the stored contributor profile tier.
  - The only live scoring update wired here is fire-and-forget `updateExpertiseIncremental({ type: "pr_authored" })`.
- `src/slack/slash-command-handler.ts`
  - `/kodiai profile` renders linked guidance from `overallTier` + `optedOut` only.
  - This means linked-but-unscored profiles still present as “linked contributor guidance is active.”
- `src/contributor/experience-contract.ts`
  - This is the semantic layer worth **keeping**. It already cleanly distinguishes `profile-backed`, `generic-unknown`, `generic-degraded`, and `generic-opt-out` behavior.
- `package.json`
  - Has `verify:m046:s01` and `verify:m046:s02`, but no top-level `verify:m046` entrypoint yet.
- `src/contributor/index.ts`
  - Exports the current contributor modules. If S03 extracts a reusable pure helper for the change contract, export it here.

### Downstream planning gap S03 should fill
- `.gsd/milestones/M047/M047-ROADMAP.md` is still effectively blank.
- That makes the S03 output more than a summary: it is the missing structured input that tells M047 what to preserve, what to change, and what to replace.

## Key findings and surprises
1. **S03 should not invent a new verdict algorithm.**  
   S02 already emits the calibration recommendation. S03 should reuse that verdict, verify the supporting evidence is intact, and add the M047 contract.

2. **The truthful final answer is already visible today: `replace`.**  
   Current live modeled behavior collapses all retained contributors into profile-backed newcomer guidance, while the intended full-signal model differentiates `fuzzard` to senior and `koprajs` to established. Only `fkoemep` stays newcomer, with stale/missing-review caveats.

3. **`overallPassed` must not mean `keep`.**  
   This is the biggest implementation trap. `verify:m046:s02` already returns `overallPassed: true` together with `recommendation.verdict = "replace"`. S03 should keep that distinction: the harness passes when it can honestly prove the answer.

4. **The M047 change contract can already be grounded in code reality.**  
   The report does not need speculative product prose. Today’s codebase already shows which mechanisms fall into each bucket:
   - **Keep:** fixture/snapshot proof surfaces, M045 contract vocabulary, explicit freshness/degradation reporting.
   - **Change:** how profile-backed guidance is gated and propagated across review/retrieval/Slack.
   - **Replace:** the current live incremental-only `pr_authored` scoring path as the shipping calibration mechanism, plus the linked-but-unscored newcomer default acting as trusted profile-backed guidance.

5. **This is broader than scorer math.**  
   `review.ts` and `slash-command-handler.ts` both trust stored contributor tiers without freshness gating. M047 will need coordinated surface changes even if the underlying scoring mechanism changes cleanly.

6. **The slice directory is empty.**  
   There is no existing `scripts/verify-m046.ts`, `scripts/verify-m046.test.ts`, or `verify:m046` package script to extend.

## Recommended task seams

### Task 1 — Define the final integrated report and contract shape
Recommended files:
- Create `scripts/verify-m046.ts`
- Create `scripts/verify-m046.test.ts`
- Modify `package.json`
- Optional only if reuse becomes clearly valuable: create `src/contributor/calibration-change-contract.ts` plus a test and export

Prefer a domain name like `calibration-change-contract.ts` if a helper is extracted. Avoid milestone-coded names in enduring source files.

Recommended report shape:
- top-level `command`, `generatedAt`, `check_ids`, `overallPassed`, `checks`
- nested `fixture` report preserving the full S01 evidence
- nested `calibration` report preserving the full S02 evidence
- separate `verdict` block copied from S02’s recommendation
- separate `m047ChangeContract` block

Suggested `m047ChangeContract` shape:

```ts
{
  verdict: "keep" | "retune" | "replace";
  rationale: string[];
  keep: Array<{
    mechanism: string;
    why: string;
    evidence: string[];
    impactedSurfaces: string[];
  }>;
  change: Array<{
    mechanism: string;
    why: string;
    evidence: string[];
    impactedSurfaces: string[];
  }>;
  replace: Array<{
    mechanism: string;
    why: string;
    evidence: string[];
    impactedSurfaces: string[];
  }>;
}
```

That is structured enough for M047 planning and avoids forcing later slices to scrape prose.

### Task 2 — Compose S01 and S02 intact
- Evaluate `evaluateM046S01()` once.
- Call `evaluateM046S02({ _evaluateS01: async () => s01Report, ... })` so the top-level verifier and S02 prerequisite are reading the **same** S01 evidence.
- Preserve both nested reports intact in JSON output; do not flatten them into booleans.
- Add top-level consistency checks for:
  - nested report presence/shape
  - S01 and S02 retained/excluded counts agreeing
  - S02 prerequisite summary matching the nested S01 report
  - final S02 recommendation being present when the proof inputs are healthy

### Task 3 — Make the M047 change contract explicit and testable
Pin at least these contract buckets:

**Keep**
- checked-in xbmc fixture/snapshot contract (`verify:m046:s01`)
- calibration evidence surface and explicit divergence/freshness reporting (`verify:m046:s02`)
- M045 contributor-experience contract vocabulary and truthful fail-open generic states from `src/contributor/experience-contract.ts`

**Change**
- profile-backed guidance should require actually scored/fresh contributor evidence (`lastScoredAt` or equivalent), not just a stored normalized tier
- review, retrieval, Slack profile, and contributor-profile persistence should consume one coherent shipped model
- if percentile tiering survives, it needs deterministic tie handling and minimum-cohort rules rather than implicit order sensitivity

**Replace**
- the live incremental-only `updateExpertiseIncremental({ type: "pr_authored" })` path as the decisive shipping calibration mechanism
- the current linked-but-unscored newcomer default acting as trusted profile-backed contributor guidance

### Task 4 — Human/JSON rendering and exit semantics
- Human output should follow the repo’s existing verifier style: final verdict line, stable top-level checks, short nested evidence summary, then explicit `Keep / Change / Replace` sections.
- `--json` and human output should come from one report object.
- Exit **non-zero** only when the proof surface is broken:
  - nested S01 or S02 report missing/malformed
  - nested counts or retained IDs drift in ways the integrated report cannot trust
  - verdict missing
  - change contract missing or internally contradictory
- Exit **zero** for truthful `keep`, `retune`, or `replace`.

## What to build or prove first
1. **Lock the top-level semantics in tests first.**  
   Especially: `overallPassed` vs `verdict`, and `replace` returning exit 0.
2. **Compose S01 and S02 next.**  
   Reuse the existing evaluation seams rather than re-implementing any fixture or calibration logic.
3. **Then add the explicit M047 change contract.**  
   This is the real new deliverable of the slice.
4. **Only extract a pure helper if the contract logic becomes messy or clearly reusable.**  
   Otherwise keep the blast radius in `scripts/`.

## Verification baseline
Fresh evidence gathered during research:
- `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts`
  - **23 pass / 0 fail**
- `bun run verify:m046:s01 -- --json`
  - `overallPassed: true`
  - `counts.retained: 3`
  - `counts.excluded: 6`
  - `diagnostics.statusCode: "snapshot-refreshed"`
  - alias diagnostics recorded for `kai-sommerfeld`↔`ksooo` and `keith`↔`keith-herrington`
- `bun run verify:m046:s02 -- --json`
  - `overallPassed: true`
  - `recommendation.verdict: "replace"`
  - `findings.liveScoreCompression: true`
  - `findings.divergentContributorIds: ["fuzzard", "koprajs"]`
  - `findings.staleContributorIds: ["fkoemep"]`

Code reality checks gathered during research:
- `src/handlers/review.ts` only wires live scoring through `updateExpertiseIncremental(... type: "pr_authored")`.
- `src/handlers/review.ts` trusts stored contributor tiers as profile-backed with no freshness gate.
- `src/slack/slash-command-handler.ts` presents linked guidance from stored tier/opt-out state only.

## Verification plan for S03
Minimum completion bar:
- `bun test ./scripts/verify-m046.test.ts`
- `bun run verify:m046`
- `bun run verify:m046 -- --json`

Regression bundle:
- `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts ./scripts/verify-m046.test.ts`
- `bun run verify:m046:s01 -- --json && bun run verify:m046:s02 -- --json && bun run verify:m046 -- --json`
- `bun run tsc --noEmit`

Important negative tests:
- malformed nested S01 report → non-zero with named status code
- malformed nested S02 report → non-zero with named status code
- missing final recommendation → non-zero
- missing or contradictory `m047ChangeContract` block → non-zero
- truthful `replace` verdict with complete contract → **exit 0**

## Recommendation
Treat S03 as a **small milestone-closeout verifier slice**.

Ship a new canonical `verify:m046` command that:
- nests S01 and S02 intact,
- reuses S02’s existing `keep | retune | replace` decision instead of inventing new verdict logic,
- separates proof-surface success from the verdict itself,
- and emits a structured M047 change contract.

The likely truthful contract from today’s evidence is:
- **Keep** the fixture/snapshot proof surfaces, M045 contract vocabulary, and explicit freshness/degradation reporting.
- **Change** profile-backed gating so review/retrieval/Slack only trust scored/fresh contributor data, and constrain any surviving tiering mechanism to deterministic behavior.
- **Replace** the current live incremental-only `pr_authored` calibration path and the linked-but-unscored newcomer default as the shipping contributor-model mechanism.

That gives M047 a precise, testable starting point instead of open-ended calibration prose.