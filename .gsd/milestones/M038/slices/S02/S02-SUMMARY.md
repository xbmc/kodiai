---
id: S02
parent: M038
milestone: M038
provides:
  - A stable `StructuralImpactPayload` → Review Details formatting contract for downstream timeout/cache verification work.
  - Prompt-level breaking-change instructions that can consume truthful structural evidence without overstating certainty.
  - A deterministic verifier (`verify:m038:s02`) that S03 can extend for cache reuse and degradation scenarios without redefining expected review output.
requires:
  - slice: S01
    provides: Bounded structural-impact payload orchestration, graph/corpus adapter seams, degradation records, and review-facing integration hooks that S02 could render without direct substrate coupling.
affects:
  - S03
key_files:
  - src/lib/structural-impact-formatter.ts
  - src/lib/review-utils.ts
  - src/execution/review-prompt.ts
  - src/handlers/review.ts
  - scripts/verify-m038-s02.ts
  - scripts/verify-m038-s02.test.ts
  - package.json
  - .gsd/KNOWLEDGE.md
  - .gsd/PROJECT.md
key_decisions:
  - Render Structural Impact in Review Details with hard per-list caps and explicit shown/total/truncated metadata rather than relying on an opaque character budget alone.
  - Use stronger graph evidence wording only for full-confidence graph edges and probable graph evidence wording for all lower-confidence graph results.
  - Thread the bounded structural-impact payload separately from raw graph blast-radius data so prompt/review rendering can evolve without coupling to substrate-native types.
  - Strengthen breaking-change instructions only when truthful structural evidence is present; otherwise emit explicit fallback-used or partial-evidence guidance instead of overstating certainty.
  - Verify the feature through real prompt and Review Details rendering seams using a small stable JSON proof envelope rather than duplicating formatter internals in the verifier.
patterns_established:
  - Bound user-visible structural sections with independent hard caps plus explicit shown/total/truncated metadata rather than a single silent truncation budget.
  - Treat confidence wording as a contract: stronger claims require full-confidence graph evidence; lower-confidence graph paths must stay labeled probable.
  - Use real prompt/rendering seams in proof harnesses so verifiers test the shipped contract instead of reimplementing formatter logic.
  - Keep substrate payloads decoupled from prompt/review rendering via a bounded adapter-owned payload shape and optional fail-open integration.
observability_surfaces:
  - `verify:m038:s02` deterministic JSON proof harness with explicit per-check status codes for C++ and Python rendering scenarios.
  - `formatReviewDetailsSummary()` rendered-count line for callers/files/tests/unchanged evidence, making bounded output visible and machine-checkable.
  - Existing structural-impact degradation/status fields remain surfaced through the bounded payload and prompt instructions, preserving fail-open observability for downstream runtime work.
drill_down_paths:
  - .gsd/milestones/M038/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M038/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M038/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-05T19:39:18.772Z
blocker_discovered: false
---

# S02: Structural Impact Rendering and Review Flow Integration

**Structural Impact is now rendered as bounded review-visible evidence in Review Details and review prompts, with deterministic C++/Python proof coverage and structurally grounded breaking-change guidance.**

## What Happened

S02 turned the bounded structural-impact payload from S01 into review-visible output. T01 added a dedicated formatter that renders changed symbols, graph coverage, probable callers/dependents, impacted files, likely tests, and canonical unchanged-code evidence with truthful confidence language and explicit truncation metadata. T02 then threaded that payload into the main review flow: Review Details now shows a bounded Structural Impact subsection, and the main review prompt includes structural evidence plus breaking-change instructions that distinguish evidence-present, partial-evidence, and fallback-used cases. T03 closed the slice with a deterministic C++/Python verifier that exercises the real prompt and Review Details seams and emits stable JSON proof output. During slice closure, a full-repo typecheck exposed two proof-harness fixture drifts that task-level checks had not enforced: `ResolvedReviewProfile` fixtures needed the required `autoBand` field, and writable stream test stubs needed to return `boolean`. Fixing those issues kept the slice truthful and left the repo green under the full verification gate.

## Verification

Executed the full slice verification contract and kept rerunning until all checks passed: `bun test ./src/lib/structural-impact-formatter.test.ts`, `bun test ./src/execution/review-prompt.test.ts`, `bun test ./scripts/verify-m038-s02.test.ts`, `bun run verify:m038:s02 -- --json`, and `bun run tsc --noEmit`. The first slice-level full gate exposed two real TypeScript issues in verifier fixtures/stubs; after fixing them, the entire chain passed cleanly. The verifier JSON reported `overallPassed: true` with both check IDs green: `M038-S02-CPP-REVIEW-DETAILS-STRUCTURAL-IMPACT` and `M038-S02-PYTHON-BREAKING-CHANGE-EVIDENCE`.

## Requirements Advanced

- R037 — Completed the user-visible validation target by rendering bounded Structural Impact evidence and unchanged-code context into Review Details and prompt output for production-like C++ and Python review scenarios.
- R038 — Strengthened breaking-change guidance with caller/dependent/test evidence when structural evidence exists while preserving fallback behavior when it is absent or partial.

## Requirements Validated

- R037 — `bun run verify:m038:s02 -- --json` passed both the C++ Review Details Structural Impact check and the Python structurally grounded breaking-change evidence check, and Review Details now renders a bounded Structural Impact section with unchanged-code evidence.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

One slice-level verification pass uncovered real TypeScript fixture drift outside the task-level green path: `ResolvedReviewProfile` test fixtures in `scripts/verify-m038-s02.ts` were missing the now-required `autoBand` field, and writable stream stubs in `scripts/verify-m038-s02.test.ts` returned `void` instead of `boolean`. The slice closer repaired both issues before rerunning the full verification contract. No functional scope was descoped.

## Known Limitations

The new verifier is fixture-based and hermetic: it proves the user-visible rendering contract, but it does not hit live graph or canonical-corpus adapters. Cache reuse and timeout/fail-open execution paths are not validated until S03. Structural evidence remains bounded and summary-oriented rather than a full blast-radius dump by design.

## Follow-ups

S03 should verify timeout-driven degradation, stable cache reuse across repeated reviews, and end-to-end fail-open behavior when graph/corpus adapters partially or fully fail. It should reuse the S02 deterministic rendering harness as the user-visible contract while expanding proof coverage to runtime/cache paths.

## Files Created/Modified

- `src/lib/structural-impact-formatter.ts` — Added the bounded Structural Impact Review Details formatter with truthful confidence wording, hard caps, truncation metadata, and unchanged-code evidence rendering.
- `src/lib/review-utils.ts` — Extended Review Details rendering to accept structural-impact payloads and append the Structural Impact subsection plus machine-usable rendered-count metadata.
- `src/execution/review-prompt.ts` — Threaded structural-impact evidence into the main review prompt and breaking-change instructions with explicit evidence-present/partial/fallback guidance.
- `src/handlers/review.ts` — Integrated structural-impact payload capture and propagation through the main review flow while preserving fail-open behavior.
- `scripts/verify-m038-s02.ts` — Added a deterministic fixture-based verifier proving bounded Structural Impact rendering and structural breaking-change evidence for C++ and Python scenarios.
- `scripts/verify-m038-s02.test.ts` — Added verifier tests and fixed type-safe writable stream stubs for the proof harness.
- `package.json` — Registered the new `verify:m038:s02` package script.
- `.gsd/KNOWLEDGE.md` — Recorded new reusable gotchas for full-shape `ResolvedReviewProfile` fixtures and writable stream test stubs.
- `.gsd/PROJECT.md` — Refreshed project state to mark M038/S02 complete and describe the new structural-impact rendering layer.
