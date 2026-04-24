# S03 Research — Bounded continuation shaping and authority-safe proof

## Summary

S03 is a **targeted research** slice. The core continuation lifecycle already exists from S01, and the one-surface publication contract already exists from S02. The remaining work is proof-oriented but still touches shipped code paths:

- prove continuation prompt/context is **materially narrower** than the first pass
- prove continuation remains **sufficient-but-bounded** rather than replaying first-pass breadth
- re-prove that **final same-surface continuation writes** still obey publish-rights guards on the shipped M063 path

Primary owned requirement is **R066**. This slice also supports milestone acceptance around stale continuation safety, but formal ownership of broader supersession durability remains **R067 / M064/S01**.

The strongest current seam is already in code: initial and retry prompts both flow through `buildReviewPromptDetails(...)`-derived contexts, and retry publication already rechecks `ReviewWorkCoordinator` authority before both canonical-comment merge and Review Details merge. What is missing is a deterministic proof surface that compares first-pass vs continuation prompt shape and exercises the final write guards on the same-surface continuation path.

## Requirements Targeted

- **R066** — continuation must stop after sufficient high-risk coverage and remain truthful/sufficient-but-bounded rather than exhaustive.
- **Supports milestone success criteria** — stale/superseded continuation must not overwrite newer authoritative state on shipped continuation write paths.
- **Supports R062/R063/R065 preservation** — S03 should prove the narrowing/safety work does not regress automatic continuation, same-surface ownership, or explicit revision behavior already shipped in S01/S02.

## Recommendation

Build S03 around **deterministic production-seam proof**, not around new product behavior.

Recommended shape:

1. **Add a new deterministic verifier** (likely `scripts/verify-m063-s03.ts`) that compares an initial large-PR prompt context against the retry prompt context using the real prompt builder / prompt-section metrics.
2. **Use section-level evidence**, not prose, to prove narrowing:
   - compare total estimated tokens / char counts
   - compare `review-change-context` and `review-size-context` specifically
   - prove retry prompt omits `largePRContext` and narrows `changedFiles`
3. **Extend handler tests for final write-path authority**, specifically the same-surface retry merge path:
   - canonical summary merge suppressed when retry loses publish rights
   - nested Review Details merge suppressed independently when retry loses publish rights
   - quiet no-delta settlement still does no public write
4. Keep this slice **proof-first and minimally invasive**. If a deterministic verifier cannot reach production seams cleanly, extract a small pure helper for “initial vs continuation prompt build context” rather than adding more logic to `src/handlers/review.ts`.

This follows the loaded superpowers rule of **evidence before claims** (`verify-before-complete` / `verification-before-completion`) and the project rule to use the **lightest sufficient tool first**: prove the shipped behavior through existing production seams before considering deeper architectural change.

## Implementation Landscape

### Files that matter

- `src/handlers/review.ts`
  - Initial prompt build context is assembled around `reviewPromptBuildContext` and passed through `buildReviewPromptResultWithCache(...)`.
  - Retry prompt build context is assembled separately in the queued continuation path.
  - Final continuation writes already gate through `canPublishReviewWorkOutput(...)` before:
    - retry canonical comment merge
    - retry nested Review Details merge
  - Existing telemetry already records retry scope metadata and prompt-section records.

- `src/execution/review-prompt.ts`
  - `buildReviewPromptDetails(...)` returns named section metrics via `PromptBuildResult`.
  - Sections are already split into stable proof surfaces:
    - `review-pr-context`
    - `review-change-context`
    - `review-size-context`
    - `review-graph-context`
    - `review-knowledge-context`
    - `review-instructions`
  - This is the cleanest deterministic proof seam for prompt narrowing.

- `src/execution/prompt-section-metrics.ts`
  - Defines `PromptBuildResult`, section char counts, estimated tokens, and truncation flags.
  - Lets S03 prove narrowing without live LLM execution.

- `src/lib/review-continuation-lifecycle.ts`
  - Still defines why continuation exists at all: reduced-scope scheduling via `computeRetryScope(...)`, `scopeRatio`, and `continuationFiles`.
  - Important constraint: current retry shaping is still driven by file-scope reduction, not a separate continuation-specific prompt DSL.

- `src/lib/retry-scope-reducer.ts`
  - Determines retry scope from unreviewed high-risk files.
  - Current rule: continuation reviews the highest-risk remainder, with `scopeRatio` between `0.5` and `1.0` depending on already-reviewed fraction.
  - This is a planner-visible contract that S03 proof must not accidentally invalidate.

- `src/jobs/review-work-coordinator.ts`
  - Publish authority remains process-local and ordinal-based.
  - `canPublish(attemptId)` is still the last-mile authority seam.
  - S03 should prove shipped continuation write paths recheck this seam, not expand scope into durable cross-process coordination.

- `src/telemetry/types.ts`
  - Retry telemetry already stores `retryFilesCount`, `retryScopeRatio`, `retryTimeoutSeconds`, and `retryCheckpointEnabled`.
  - Useful as supporting evidence, but deterministic proof should not depend on live telemetry.

- `scripts/verify-m063-s01.ts`
  - Established the pattern for deterministic continuation lifecycle + stale-authority proof.

- `scripts/verify-m063-s02.ts`
  - Established the pattern for deterministic same-surface ownership + quiet no-delta proof.

- `scripts/verify-m061-s03.ts`
  - Existing proof surface for named `review.user-prompt` sections and truncation visibility in telemetry.
  - Good model for S03’s prompt-budget/narrowing assertions, but S03 should stay DB-independent if possible.

- `src/handlers/review.test.ts`
  - Already contains coverage for:
    - queued retry keeping rights after parent unwind
    - stale/superseded retry merge suppression
    - timeout Review Details suppression after rights loss
    - initial and retry prompt-section telemetry preservation
  - Natural place to extend shipped-path authority and narrowing regressions.

### What exists already

- **Initial vs retry prompt construction already differs materially in inputs**:
  - initial build uses `changedFiles: promptFiles`
  - retry build uses `changedFiles: retryFiles`
  - initial build sets `largePRContext` when the PR is large
  - retry build hard-codes `largePRContext: null`
- **Named prompt sections already exist**, so proof can compare exact sections instead of string-grepping whole prompts.
- **Retry scheduling already records `scopeRatio`** from `computeRetryScope(...)`.
- **Final continuation writes already recheck authority** via `canPublishReviewWorkOutput(...)` for both summary merge and Review Details merge.

### Important current gaps

- There is **no deterministic S03 verifier** yet.
- Existing retry prompt tests only prove that prompt-section telemetry is still multi-section; they do **not** prove retry is narrower than first pass.
- The retry prompt build context currently reuses much of the initial context (`diffAnalysis`, retrieval, precedents, wiki knowledge, unified results, structural impact, linked issues, cluster patterns). That means narrowing likely comes mostly from:
  - smaller `changedFiles`
  - absent `largePRContext`
  - smaller change/size sections
  Not from wholesale context pruning.
- Retry prompt build context currently appears to **omit `reviewBoundedness`** while the initial prompt includes it. That may help narrowing, but it also means S03 should treat boundedness disclosure as a visible-output truth contract, not assume retry prompt itself carries the same disclosure instructions.

## Natural Seams for Planning

### Seam 1 — Pure narrowing proof surface

Best first task: create a pure helper or verifier fixture builder that can instantiate:

- an initial large-PR prompt context
- a continuation/retry prompt context derived from the same underlying review state

Then compare the resulting `PromptBuildResult.sections`.

This seam is the lowest-risk way to deliver R066 evidence because it does not require live executor runs, Postgres, or GitHub I/O.

### Seam 2 — Handler-level authority proof on final continuation writes

Second task: extend `src/handlers/review.test.ts` around the shipped retry merge path.

The important proof is not generic coordinator behavior — S01 already covered that. The proof needed here is:

- once S02 collapsed continuation onto one canonical comment, the **actual final write path** still suppresses stale retry work on both update steps
- no stale retry can mutate the canonical comment after a newer attempt becomes authoritative

### Seam 3 — Package-level verifier wiring

After the verifier exists, wire `package.json` with something like `verify:m063:s03` and add a dedicated test file for the verifier.

That matches S01/S02’s proof pattern and gives milestone close a single command to run.

## Key Findings and Constraints

### 1. Prompt narrowing is already measurable from production seams

`buildReviewPromptDetails(...)` emits section metrics with `charCount`, `estimatedTokens`, and `truncated` flags. S03 does not need live telemetry or LLM calls to prove narrowing. It can compare the pure builder output directly.

### 2. Retry prompt is narrower by construction, but only in specific dimensions

Current retry prompt context differs from initial mainly in these ways:

- `changedFiles` becomes `retryFiles`
- `largePRContext` is removed (`null`)
- retry-specific instructions are added (`focus ONLY on listed files`, no top-level summary, optional checkpoint reminder)

Most expensive knowledge/context inputs are otherwise reused. That means S03 should prove **material narrowing in the sections that actually change**, not require every section to shrink.

### 3. `computeRetryScope(...)` is a product constraint, not just an implementation detail

Continuation scope currently remains tied to high-risk remainder ranking. If S03’s proof asserts over-specific ratios, it may overfit the current heuristic. Safer proof:

- continuation file set is a strict subset of first-pass file set or large-PR review universe
- retry `review-change-context` is smaller than initial for large-PR scenarios
- retry `review-size-context` no longer carries the large-PR triage block

### 4. Last-mile authority is already duplicated intentionally across retry writes

In the retry merge path, `review.ts` rechecks `canPublishReviewWorkOutput(...)` before:

- updating the canonical comment body
- updating the canonical comment again with merged Review Details

S03 should preserve this explicit double-check pattern. Do not “simplify” it away during proof work.

### 5. Quiet no-delta settlement remains part of the safety contract

S02 already established that all-zero continuation delta counts are a public no-op. S03 proof should keep that scenario in scope because a stale or no-delta continuation that still mutates the canonical comment would violate both boundedness and authority-safety expectations.

### 6. Cross-process durability stays out of scope

`ReviewWorkCoordinator` is still in-memory. S03 should not try to solve durable distributed authority. That remains M064 territory per roadmap/context.

## Verification Strategy

Use the superpowers rule **evidence before claims** directly: verify with fresh outputs, not inferred behavior.

### Deterministic verifier

Add `scripts/verify-m063-s03.ts` plus `scripts/verify-m063-s03.test.ts`.

Minimum proof matrix:

1. **initial-large-pr vs continuation-retry prompt**
   - retry total estimated tokens < initial total estimated tokens
   - retry `review-change-context` < initial `review-change-context`
   - retry `review-size-context` < initial `review-size-context`
   - retry prompt still includes required review sections
2. **sufficient-but-bounded continuation**
   - retry prompt narrows to continuation files only
   - retry prompt omits `largePRContext`
   - proof wording reports that continuation stayed narrower without claiming exhaustiveness
3. **authority-safe final writes**
   - stale retry cannot update canonical summary
   - stale retry cannot update nested Review Details
   - no-delta continuation makes no public mutation

A good implementation pattern is `scripts/verify-m040-s03.ts`: pure fixtures, named checks, no live DB dependency.

### Handler regression tests

Run and likely extend:

- `bun test src/handlers/review.test.ts --filter "retry"`
- or the exact targeted retry/continuation tests added for S03

Important scenarios to lock:

- stale retry summary merge suppression
- stale retry Review Details merge suppression
- no-delta continuation leaves canonical comment unchanged
- retry prompt-section records for both initial and retry deliveries remain present and comparable

### Prompt builder tests

Add/extend targeted tests in:

- `src/execution/review-prompt.test.ts`

Ideal assertions:

- initial large-PR context returns larger `review-change-context` and `review-size-context` than retry context
- retry still preserves required named sections
- retry instruction text stays continuation-specific and bounded

### Slice-close commands

Expected verification set:

- `bun test src/execution/review-prompt.test.ts`
- `bun test src/handlers/review.test.ts --filter "retry|continuation|prompt"`
- `bun test scripts/verify-m063-s03.test.ts`
- `bun run verify:m063:s03 -- --json`
- `bun run tsc --noEmit`

## Risks

- **False proof from the wrong metric**: overall prompt size may not shrink dramatically if reused retrieval/knowledge sections dominate. Compare section-level deltas, not just one total number.
- **Overfitting to current retry ratio math**: assert narrowing and boundedness, not exact percentages unless the heuristic is explicitly part of product contract.
- **Accidentally broadening scope into M064**: durable cross-process authority is not this slice.
- **Regressing S02 same-surface behavior while proving authority safety**: any handler edits should be surgical and covered by existing S02 verifier plus retry tests.

## Skill Discovery (suggest)

Directly relevant stack is internal TypeScript/Bun review orchestration. Installed skills are already sufficient; none map directly to this proof-focused continuation slice. External search found a generic Bun skill if the team wants optional Bun-specific workflow guidance later:

- `npx skills add sickn33/antigravity-awesome-skills@bun-development` — highest install count from `npx skills find "bun typescript"`

No Octokit-specific skill was found (`npx skills find "octokit"` returned none). No extra skill is necessary for planning this slice.