# S02 Research — Review-Surface Truthfulness Wiring

## Summary

S02 is light-to-targeted work. S01 already fixed the source-of-truth side: `resolveAuthorTier()` in `src/handlers/review.ts` now prefers contributor-profile tier over cache and fallback, and the review handler threads a single resolved `authorClassification.tier` into downstream surfaces. The remaining work is review-surface truthfulness: prove that resolved established/senior tiers actually produce non-newcomer wording in prompt output and deterministic Review Details output, and add a repro-focused verifier so the CrystalP-shaped case cannot silently regress.

Primary requirements supported here are **R040** (review output consumes corrected contributor tier and avoids newcomer mislabeling) and **R042** (real repro captured in regression verification). R041 is adjacent but mainly belongs to S03 because cache/fallback persistence across repeated runs is not the core surface-wiring problem.

## Recommendation

Do not change contributor scoring again in S02. Keep the S01 precedence contract intact and focus on three seams:

1. **Prompt wording seam** — `src/execution/review-prompt.ts` / `buildAuthorExperienceSection()`
2. **Deterministic summary/details seam** — `src/lib/review-utils.ts` / `formatReviewDetailsSummary()`
3. **Integration seam** — existing captured prompt/details harnesses in `src/handlers/review.test.ts`

The practical target is: when contributor-profile tier resolves to `established` or `senior`, neither prompt nor review-details output should imply newcomer/developing guidance. Add explicit negative guards for newcomer-style phrases, not just positive assertions on the chosen tier.

## Implementation Landscape

### `src/handlers/review.ts`
- `resolveAuthorTierFromSources()` is the canonical precedence helper from S01:
  - `contributor-profile` first
  - `author-cache` second
  - `fallback` last
- `resolveAuthorTier()` already performs the store/cache/fallback selection and returns one `authorClassification.tier`.
- The handler already threads `authorClassification.tier` into both major review surfaces:
  - `buildReviewPrompt({ authorTier: authorClassification.tier, ... })`
  - `formatReviewDetailsSummary({ authorTier: authorClassification.tier, ... })`
- That means S02 should not invent another source-selection path. If review-surface output is wrong, it is now a rendering/testing problem, not a precedence problem.

### `src/execution/review-prompt.ts`
- `buildAuthorExperienceSection()` is where user-visible author-context wording is chosen.
- Current mappings:
  - `first-time` / `newcomer` → explicitly newcomer-style educational tone
  - `regular` / `developing` → “developing contributor” guidance
  - `established` → brief, non-pedagogical guidance
  - `core` / `senior` → terse peer-to-peer guidance
- `buildReviewPrompt()` appends this section whenever `context.authorTier` exists.
- This is the most important truthfulness surface for R040 because it changes model behavior, not just metadata.

### `src/lib/review-utils.ts`
- `formatReviewDetailsSummary()` currently renders a compact author line:
  - `- Author: ${authorTier ?? "regular"} (${authorTier === "regular" ? "default" : "adapted tone"})`
- This means Review Details already carries the selected tier, but only coarsely.
- Existing tests cover usage/tokens, not author-tier truthfulness directly.
- S02 can either:
  - keep this formatting and add regression tests proving the correct tier shows up, or
  - tighten wording if needed so Review Details does not flatten established/senior into an unhelpful generic “adapted tone”.
- The safer first move is tests. Change wording only if the current line is too weak to satisfy the slice demo.

### `src/handlers/review.test.ts`
Useful existing seams:
- `resolveAuthorTierFromSources` focused unit tests from S01 already prove precedence only.
- `createReviewHandler auto profile selection` includes `runProfileScenario()`, which captures:
  - generated review prompt
  - deterministic Review Details comment body
- This is the cleanest integration harness to reuse or clone for S02 because it already proves one handler run can surface both prompt and details output without full production dependencies.
- There are many Review Details assertions already; author-tier assertions can be added alongside them without inventing new test infrastructure.

### `src/execution/review-prompt.test.ts`
- Existing tests only cover isolated prompt-section variants:
  - first-time → educational/new contributor wording
  - regular → developing wording
  - core → terse/core-senior wording
- Missing today:
  - explicit `established` test
  - explicit negative guards proving established/senior sections do **not** contain newcomer/developing wording
  - prompt-builder integration assertion that `buildReviewPrompt()` includes the correct section when `authorTier` is passed through full prompt context

### `scripts/verify-m042-s01.ts`
- S01 verifier proves persistence and precedence, not review-surface wording.
- `package.json` only has `verify:m042:s01` registered today.
- S02 should add a separate verifier rather than overloading S01’s scope.

### `src/lib/author-classifier.ts`
- Still a legacy 3-tier fallback (`first-time`, `regular`, `core`) with different semantics than contributor-profile tiers.
- For S02 this is a constraint, not a redesign target.
- The prompt builder intentionally accepts both 3-tier and 4-tier values by unioning them in `AuthorTier` and mapping pairs (`first-time/newcomer`, `regular/developing`, `core/senior`).
- Do not try to unify the models in S02. That belongs to a broader calibration effort or S03 cache/fallback consistency work.

## Natural Task Split

### Task 1 — Prompt-surface truthfulness regression coverage
Files:
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`

Work:
- Add explicit `established` coverage.
- Add negative guards so `established`/`senior` sections do not contain newcomer-style or developing-style phrases.
- If needed, tighten `buildAuthorExperienceSection()` wording so the tier buckets remain clearly distinct.

Why first:
- Lowest-risk, directly addresses the main user-visible misbehavior.
- Clarifies whether the rendering logic is already correct and only under-tested, or whether text changes are needed.

### Task 2 — Review Details truthfulness wiring and integration test
Files:
- `src/lib/review-utils.ts`
- `src/lib/review-utils.test.ts`
- `src/handlers/review.test.ts`

Work:
- Add focused Review Details tests for `authorTier` rendering.
- Reuse/clone the existing captured prompt/details handler harness to inject contributor-profile tier and assert both:
  - prompt output does not contain newcomer/developing guidance for an established contributor
  - Review Details reflects the established/senior tier truthfully
- Keep this scoped to one handler-run seam rather than broad end-to-end orchestration.

Why second:
- Depends on prompt-language expectations being settled.
- Gives one integrated proof that the selected tier reaches both output surfaces.

### Task 3 — Slice verifier for CrystalP-shaped regression
Files:
- `scripts/verify-m042-s02.ts`
- `scripts/verify-m042-s02.test.ts`
- `package.json`

Work:
- Add a named verifier focused on review-surface invariants, not scoring internals.
- Likely checks:
  - established contributor prompt excludes newcomer-style guidance
  - established contributor prompt includes established-tier guidance
  - review-details surface reflects established/senior truthfully
  - contributor-profile tier still wins over fallback-style low tier in the review-surface path
- Reuse production helpers directly; use `_fn`/stub injection only if a helper truly needs a seam.

Why third:
- It should encode the final contract after prompt/details behavior is settled.
- Gives milestone closure a reusable `verify:m042:s02` command alongside S01.

## Verification Plan

Primary commands:
- `bun test ./src/execution/review-prompt.test.ts`
- `bun test ./src/lib/review-utils.test.ts`
- `bun test ./src/handlers/review.test.ts`
- `bun test ./scripts/verify-m042-s02.test.ts`
- `bun run verify:m042:s02`
- `bun run tsc --noEmit`

Recommended assertion style:
- Use **negative guards on full strings** for banned wording, not partial/proxy checks.
- For prompt truthfulness, assert absence of strings like:
  - `first-time or new contributor`
  - `developing contributor`
  - `Explain WHY each finding matters`
- And presence of tier-appropriate strings like:
  - `established contributor`
  - `core/senior contributor`
  - `Keep explanations brief`
  - `Be concise and assume familiarity`

## Risks / Constraints

### 1. Two tier taxonomies still exist by design
- 4-tier persistent model: `newcomer`, `developing`, `established`, `senior`
- 3-tier fallback model: `first-time`, `regular`, `core`
- S02 should preserve the current pairwise mapping in `buildAuthorExperienceSection()` rather than trying to normalize the entire taxonomy.

### 2. Review Details is a weaker truthfulness surface than prompt behavior
- The prompt directly changes review tone and explanation depth.
- Review Details is supporting evidence only.
- If time/scope pressure appears, prioritize prompt-surface regression proof before polishing Review Details wording.

### 3. Keep fail-open behavior intact
- S01 established that enrichment failures must not block review execution.
- S02 should not add any gating that would make missing contributor profile data fatal.
- Tests should cover the truthful path, not accidentally hard-require contributor-profile presence globally.

## Existing Patterns to Follow

From project rules and loaded context:
- **Read before edit** and use the smallest seam first.
- **Root-cause first**: here the root cause for S02 is not source precedence anymore; it is unproven/under-tested surface rendering.
- **Negative regression guards must test the full rendered output**, not a proxy substring in the wrong place. This matches the M028 knowledge entry about guarding the full comment body, not a marker line.
- **Verifier-driven closure**: follow the existing M042/S01 pattern and add a named slice verifier instead of relying only on unit tests.
- **Fail-open enrichment rule** from S01 summary remains in force. Do not introduce review-blocking author-tier validation.

## Skill Discovery

Relevant installed skills checked from available skills:
- `debug-like-expert` — relevant only if S02 exposes an unexpected integration mismatch; not needed by default.
- `review` — potentially useful later for reviewing the final diff, but not a core implementation dependency.

No missing external technology here warrants `npx skills find`. This slice is plain TypeScript test/wiring work inside established repo patterns.

## Planner Notes

- Treat this as a **wiring + regression-hardening slice**, not a subsystem redesign.
- The fastest path is to start with tests in `review-prompt` and `review-utils`, then add one handler integration test, then encode the contract in `verify-m042-s02.ts`.
- Avoid broad changes inside `src/handlers/review.ts` unless an integration test proves a real bypass of `authorClassification.tier`. The current research evidence says the handler already threads the resolved tier correctly.
- If a code change is needed beyond tests, the most likely place is **rendering text**, not tier resolution.
