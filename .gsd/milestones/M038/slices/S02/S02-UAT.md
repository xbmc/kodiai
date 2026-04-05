# S02: Structural Impact Rendering and Review Flow Integration — UAT

**Milestone:** M038
**Written:** 2026-04-05T19:39:18.772Z

# S02 UAT — Structural Impact Rendering and Review Flow Integration

## Preconditions
- Repository is at the M038/S02 completion state.
- Bun dependencies are installed.
- Run from repo root: `/home/keith/src/kodiai`.
- No live graph/corpus services are required for this UAT; the verifier is fixture-based and deterministic.

## Test Case 1 — Bounded Structural Impact formatter renders truthful Review Details output
1. Run `bun test ./src/lib/structural-impact-formatter.test.ts`.
   - Expected: all 8 tests pass.
2. Inspect the passing cases named `renders bounded summaries`, `tracks rendered counts and truncation metadata`, and `uses truthful confidence language`.
   - Expected: formatter behavior is covered for changed symbols, graph coverage, probable callers/dependents, impacted files, likely tests, unchanged-code evidence, hard caps, and truncation metadata.
3. Confirm the test `renders partial-evidence wording when only degraded data is available` passes.
   - Expected: partial structural-impact payloads are rendered with downgraded evidence wording instead of full-confidence language.

## Test Case 2 — Review prompt includes structural evidence and breaking-change guidance
1. Run `bun test ./src/execution/review-prompt.test.ts`.
   - Expected: all tests pass.
2. Verify the passing cases under `buildReviewPrompt graph context integration` include:
   - `includes structural impact section when structuralImpact is provided`
   - `breaking-change instructions use structural evidence when callers or impacted files are present`
   - `breaking-change instructions fall back when structural impact is absent`
   - `breaking-change instructions call out partial structural evidence truthfully`
3. Open the generated prompt text via the verifier or unit-test fixtures if needed.
   - Expected: prompt contains a single `## Structural Impact Evidence` heading and only strengthens breaking-change wording when evidence is actually present.

## Test Case 3 — Deterministic C++ and Python proof harness validates shipped rendering contract
1. Run `bun test ./scripts/verify-m038-s02.test.ts`.
   - Expected: all 8 verifier tests pass.
2. Run `bun run verify:m038:s02 -- --json`.
   - Expected: command exits 0.
   - Expected JSON contains:
     - `overallPassed: true`
     - check id `M038-S02-CPP-REVIEW-DETAILS-STRUCTURAL-IMPACT` with `passed: true`
     - check id `M038-S02-PYTHON-BREAKING-CHANGE-EVIDENCE` with `passed: true`
3. In the JSON `scenarios` array, confirm both `cpp` and `python` report:
   - `promptIncludesStructuralSection: true`
   - `reviewDetailsIncludesStructuralSection: true`
   - `reviewDetailsIncludesRenderedCounts: true`
   - `promptStructuralImpactHeadingCount: 1`
   - `reviewDetailsStructuralImpactHeadingCount: 1`
   - Expected: bounded Structural Impact appears exactly once in both prompt and Review Details.

## Test Case 4 — Full slice verification gate stays green under typecheck
1. Run:
   `bun test ./src/lib/structural-impact-formatter.test.ts && bun test ./src/execution/review-prompt.test.ts && bun test ./scripts/verify-m038-s02.test.ts && bun run verify:m038:s02 -- --json && bun run tsc --noEmit`
2. Expected:
   - All tests pass.
   - Verifier exits 0 with `overallPassed: true`.
   - `tsc --noEmit` exits 0.
3. Confirm there are no TypeScript errors involving:
   - `ResolvedReviewProfile` fixture shape
   - writable stream `write()` stub return types
   - Expected: slice closure fixes remain in place and the repo-wide compile gate passes.

## Edge Cases

### Edge Case A — Partial structural evidence stays truthful
1. Use the existing prompt/formatter tests that cover partial structural-impact payloads.
2. Expected: output says evidence is partial and avoids overstating certainty.

### Edge Case B — Bounded output stays machine-checkable when lists are long
1. Use the formatter tests for truncation and hard-cap enforcement.
2. Expected: output includes explicit shown/total counts and `truncated` behavior instead of silently dropping entries.

### Edge Case C — Breaking-change guidance fails open when structural evidence is absent
1. Use the prompt test `breaking-change instructions fall back when structural impact is absent`.
2. Expected: review prompt still renders valid fallback guidance rather than requiring structural evidence to exist.

