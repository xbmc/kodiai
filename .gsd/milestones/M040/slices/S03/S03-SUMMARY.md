---
id: S03
parent: M040
milestone: M040
provides:
  - buildGraphContextSection() — bounded graph prompt section builder, ready for any caller with a ReviewGraphBlastRadiusResult
  - isTrivialChange() — configurable trivial-change bypass predicate, fail-closed on zero files, wired in review handler
  - validateGraphAmplifiedFindings() — optional non-destructive LLM annotation gate for graph-amplified findings, fail-open, wired in review handler
  - Full review handler wiring — trivial bypass + blast radius prompt injection + optional validation gate, all three paths fail-open
  - scripts/verify-m040-s03.ts — machine-checkable proof that all S03 operational properties hold end-to-end without live DB or LLM
requires:
  - slice: S01
    provides: ReviewGraphStore interface, extractors, graph schema — used by validation.ts and prompt-context.ts types
  - slice: S02
    provides: ReviewGraphBlastRadiusResult type, queryBlastRadiusFromSnapshot(), reviewGraphQuery DI seam in handler — consumed by buildGraphContextSection() and validateGraphAmplifiedFindings()
affects:
  []
key_files:
  - src/review-graph/prompt-context.ts
  - src/review-graph/validation.ts
  - src/execution/review-prompt.ts
  - src/handlers/review.ts
  - scripts/verify-m040-s03.ts
  - scripts/verify-m040-s03.test.ts
  - src/review-graph/validation.test.ts
  - src/execution/review-prompt.test.ts
key_decisions:
  - Graph section placed between incremental-review context and knowledge-retrieval context — gives graph signals before knowledge context without displacing high-priority instructions
  - Hard item caps (20/10/10) applied before char budget loop — caps bound worst-case loop size; budget loop is O(cap × max_line_len) not O(N)
  - GraphContextSection return type carries stats (charCount, item counts, truncated) for downstream observability without re-parsing the section text
  - isTrivialChange() is fail-closed on zero files — zero changed files is unexpected input; running the graph is safer than silently skipping
  - validateGraphAmplifiedFindings() is non-destructive — only adds metadata, never removes/suppresses findings; callers decide how to act on verdicts
  - Dynamic import for GUARDRAIL_CLASSIFICATION task router inside the validation gate block — avoids circular dependency between handler and task router
  - Zod config schema addition for graphValidation deferred — type assertion keeps gate inert by default without a migration; production enablement is an explicit opt-in op change
  - packSubSection() helper encapsulates the bounded-list packing pattern for reuse across impacted-files, tests, and dependents sub-sections
patterns_established:
  - Bounded prompt section pattern: hard item caps (applied first) + char budget loop (applied second) + truncation note + observability stats in return value
  - Trivial-change bypass pattern: fail-closed on unexpected input (zero files), configurable threshold, reason string for structured logging, wired before graph query to short-circuit overhead
  - Non-destructive LLM annotation gate pattern: annotation-only (never suppress), graph-scoped (amplified files only), fail-open (any error returns original findings + succeeded=false), configurable enabled flag defaulting to off
  - Dynamic import inside optional gate block to avoid circular dependencies between handler and task routers
observability_surfaces:
  - GraphContextSection.stats carries charCount, impactedFilesIncluded, likelyTestsIncluded, dependentsIncluded, truncated for each prompt build — callers can log or surface these fields
  - isTrivialChange() returns a reason string (e.g., 'file-count-1-lte-threshold-3') suitable for structured log fields at the bypass decision site
  - validateGraphAmplifiedFindings() result carries succeeded, validatedCount, confirmedCount, uncertainCount fields for logging the validation pass outcome
  - Review handler already logs graphHitCount, graphRankedSelections, graphAwareSelectionApplied from S02; S03 adds trivial bypass decision as a preceding log point
drill_down_paths:
  - .gsd/milestones/M040/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M040/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M040/slices/S03/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-05T12:34:48.984Z
blocker_discovered: false
---

# S03: Bounded Prompt Integration, Bypass, and Validation Gate

**Completed the M040 operational shape: bounded graph prompt packing, trivial-change bypass, fail-open optional validation, and a 4-check proof harness — all wired into the review handler with every path fail-open.**

## What Happened

S03 delivered the three remaining operational pieces that close M040 end-to-end.

**T01 — Bounded Graph Prompt Packing**
Created `src/review-graph/prompt-context.ts` with `buildGraphContextSection()`, which converts a `ReviewGraphBlastRadiusResult` into a bounded, rank-ordered Markdown section for the review prompt. Two independent caps enforce the bound: hard item caps (max 20/10/10 for impacted files/tests/dependents, applied before the budget loop) and a char budget (default 2500, applied in a second pass with a truncation note). Items are rank-ordered before capping so highest-signal entries always survive. The function returns a `GraphContextSection` carrying the rendered text, a truncation flag, and observability stats (`charCount`, item counts). It returns empty on null/empty blast radius (fail-open backward-compat path).

Updated `src/execution/review-prompt.ts` to accept `graphBlastRadius` and `graphContextOptions` params and inject the section between incremental-review context and knowledge-retrieval context — position chosen to give the LLM graph signals before it sees knowledge context without displacing high-priority review instructions. Added 35 new tests covering all packing invariants, confidence labels, truncation behavior, and prompt integration; total test count reached 203 with tsc clean.

**T02 — Trivial-Change Bypass and Validation Gate**
Created `src/review-graph/validation.ts` with two exports:

- `isTrivialChange()`: fail-closed bypass predicate (returns `bypass: false` on zero files), configurable file-count threshold (default 3), optional line threshold (default disabled), returns a `reason` string for structured logging.
- `validateGraphAmplifiedFindings()`: optional non-destructive second-pass LLM annotation gate. Only fires on findings for files in `impactedFiles`/`probableDependents` that are NOT in the changed-file set. Adds `graphValidated` and `graphValidationVerdict` metadata — never removes or suppresses findings. Fail-open: any LLM error returns original findings with `succeeded: false`. Defaults off (`enabled: false`).

Wired both into `src/handlers/review.ts`: trivial bypass check fires before the graph query (short-circuits graph overhead entirely), blast radius result is captured and passed to `buildReviewPrompt()`, and the optional validation gate runs after the guardrail pipeline using a dynamic import of `GUARDRAIL_CLASSIFICATION` task router to avoid circular dependencies. Config access via type assertion (Zod schema addition deferred — gate is inert by default). 24 new tests; 235 total pass with tsc clean.

**T03 — Proof Harness**
Created `scripts/verify-m040-s03.ts` with four machine-checkable check IDs:
- `M040-S03-PROMPT-BOUNDED`: builds maximum-size blast radius, asserts `charCount ≤ maxChars` (result: 2316/2500)
- `M040-S03-TRIVIAL-BYPASS`: exercises 1-file (bypass), 10-file (no bypass), 0-file (fail-closed)
- `M040-S03-FAIL-OPEN-VALIDATION`: throwing LLM — asserts no throw, `succeeded=false`, original findings preserved
- `M040-S03-VALIDATION-ANNOTATES`: partial LLM — asserts graph-amplified findings annotated, directly-changed findings skipped, counts correct

Created `scripts/verify-m040-s03.test.ts` with 40 tests covering all checks with real deterministic fixtures plus synthetic failure-condition overrides. `bun run verify:m040:s03 -- --json` exits 0 with `overallPassed: true`.

**Final verification:** 235 (graph+prompt) + 40 (harness) = 275 tests pass. All 4 proof checks PASS. tsc exits 0 with no errors.

## Verification

All slice-plan verification checks passed:

1. `bun test ./src/review-graph/ ./src/execution/review-prompt.test.ts` → 235 pass, 7 skip (DB-gated store tests), 0 fail
2. `bun test ./scripts/verify-m040-s03.test.ts` → 40 pass, 0 fail
3. `bun run verify:m040:s03 -- --json` → exit 0, `overallPassed: true`, all 4 check IDs PASS with detail:
   - PROMPT-BOUNDED: charCount=2316 maxChars=2500 withinBudget=true totalIncluded=20 truncated=false
   - TRIVIAL-BYPASS: smallPR bypass=true; largePR bypass=false; zeroPR bypass=false (fail-closed)
   - FAIL-OPEN-VALIDATION: neverThrew=true succeeded=false findingsCount=2 originalFindingsPreserved=true validatedCount=0
   - VALIDATION-ANNOTATES: succeeded=true validatedCount=2 confirmedCount=1 uncertainCount=1 allAmplifiedAnnotated=true directFindingSkipped=true
4. `bun run tsc --noEmit` → exit 0, no errors

## Requirements Advanced

- R038 — validateGraphAmplifiedFindings() fails open when graph/LLM unavailable (never blocks review); buildGraphContextSection() returns empty on null blast radius; trivial bypass short-circuits gracefully — all three paths implement the R038 fail-open contract

## Requirements Validated

- R038 — M040-S03-FAIL-OPEN-VALIDATION proof check (verify:m040:s03 --json) confirms: neverThrew=true, succeeded=false, originalFindingsPreserved=true when LLM throws. buildGraphContextSection() returns empty text for null blast radius (35 tests). All 4 proof checks exit 0 with overallPassed: true.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

T02: `config.review.graphValidation` schema not added to Zod config — accessed via type assertion to keep the gate inert by default without requiring a schema migration. Schema formalization deferred; the gate requires explicit `enabled: true` opt-in and does not affect any existing code path.

T03: The tight-budget boundedness test in the harness validates the `charCount ≤ maxChars` invariant directly on the fixture rather than via the check function (the check function requires at least one row included to avoid vacuous passes). This is a test structure clarification, not a deviation from scope.

## Known Limitations

1. The `config.review.graphValidation` schema is not yet in the Zod config definition — the gate is accessed via type assertion. Production enablement requires a config schema update and deployment config change.
2. The graph query DI seam in the review handler is not wired to a production `ReviewGraphStore` instance — the seam exists and is tested, but production callers must explicitly pass the `reviewGraphQuery` provider. Graph context will only appear in reviews when the indexer is deployed and the provider is wired.
3. The trivial-change bypass is file-count-only by default (line threshold disabled). PRs with many small files touching unrelated areas will not be bypassed even if the total diff is trivial. Line threshold can be enabled via `TrivialChangeOptions.trivialLineThreshold`.

## Follow-ups

1. Add `graphValidation` to the Zod config schema so validation gate can be enabled without a type assertion.
2. Wire the production `reviewGraphQuery` provider in the review handler entrypoint when graph indexing is deployed.
3. Consider whether `trivialLineThreshold` should have a non-zero default for repos with high file-count but low-diff PRs (e.g., auto-generated code changes).
4. M041 (canonical repo-code corpus) and M038 (AST call-graph impact) are the next consumers of the M040 substrate.

## Files Created/Modified

- `src/review-graph/prompt-context.ts` — New — buildGraphContextSection() with bounded prompt packing, hard item caps, char budget, observability stats
- `src/review-graph/validation.ts` — New — isTrivialChange() bypass predicate and validateGraphAmplifiedFindings() non-destructive annotation gate
- `src/review-graph/validation.test.ts` — New — 24 tests covering all trivial bypass thresholds, active validation, fail-open paths, and edge cases
- `src/execution/review-prompt.ts` — Modified — added graphBlastRadius and graphContextOptions params; graph section injected between incremental and knowledge context
- `src/execution/review-prompt.test.ts` — Modified — 35 new tests for buildGraphContextSection behavior and prompt integration; total 203 tests
- `src/handlers/review.ts` — Modified — trivial bypass before graph query, blast radius passed to buildReviewPrompt(), optional validation gate after guardrail pipeline
- `scripts/verify-m040-s03.ts` — New — 4-check proof harness: PROMPT-BOUNDED, TRIVIAL-BYPASS, FAIL-OPEN-VALIDATION, VALIDATION-ANNOTATES
- `scripts/verify-m040-s03.test.ts` — New — 40 tests covering all proof check functions with deterministic fixtures and failure-condition overrides
- `package.json` — Modified — added verify:m040:s03 script
