---
id: S02
parent: M036
milestone: M036
provides:
  - applyActivationPolicy: orchestrator for pending→active transitions, consumed by S03 sweep scheduler
  - shouldAutoActivate: pure threshold predicate, consumed by S03 and any policy-override paths
  - getActiveRulesForPrompt + formatActiveRulesSection: production-ready active-rule retrieval and formatting pipeline, already wired into buildReviewPrompt
  - verify-m036-s02.ts: proof harness covering activation, prompt injection, and fail-open — consumed by S03 verifier as upstream evidence
requires:
  []
affects:
  - S03 — consumes applyActivationPolicy, getActiveRulesForPrompt, formatActiveRulesSection, and the S02 proof harness for end-to-end lifecycle coverage
key_files:
  - src/knowledge/generated-rule-activation.ts
  - src/knowledge/generated-rule-activation.test.ts
  - src/knowledge/active-rules.ts
  - src/knowledge/active-rules.test.ts
  - src/execution/review-prompt.ts
  - src/execution/review-prompt.test.ts
  - scripts/verify-m036-s02.ts
  - scripts/verify-m036-s02.test.ts
key_decisions:
  - shouldAutoActivate is a pure predicate (no I/O) separated from applyActivationPolicy orchestrator — keeps threshold logic trivially testable without store stubs
  - Threshold reads from env var at call time (not module load) so tests can inject threshold directly via parameter override
  - Active-rules retrieval is fail-open — store errors log a warn and return empty result so reviews proceed without generated rules
  - Absolute cap of 20 rules guards against prompt overload regardless of caller-configured limit
  - Rules section placed before custom instructions so repo-specific instructions retain recency-bias position
  - sanitizeRule delegates to the existing sanitizeContent pipeline — no custom sanitization logic
patterns_established:
  - SpyLogger pattern: createSpyLogger() that records _warnCalls array is the harness-level pattern for asserting warn emissions from fail-open paths
  - Explicit threshold parameter overrides env lookup — enables test isolation without process.env mutation
  - formatActiveRulesSection([]) returning empty string is the canonical signal that no rules are active (used at both test and harness level)
observability_surfaces:
  - applyActivationPolicy emits per-decision structured logs: threshold-hit (info), skipped (debug), activated (info), failure (warn), run-complete summary (info) with activated/skipped/failures/durationMs
  - getActiveRulesForPrompt emits info log with rules.length, truncatedCount, durationMs on every call
  - Fail-open path in getActiveRulesForPrompt emits warn log with error message on store errors
drill_down_paths:
  - .gsd/milestones/M036/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M036/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M036/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-04T23:02:58.115Z
blocker_discovered: false
---

# S02: Rule Activation and Prompt Injection

**Implemented auto-activation policy, sanitized active-rule retrieval, bounded prompt injection, and a 3-check proof harness covering the full pending→active→prompt pipeline with fail-open guarantees.**

## What Happened

S02 delivered three focused tasks that complete the activation-to-prompt path for generated rules.

**T01 — Activation logic (generated-rule-activation.ts)**
Created `src/knowledge/generated-rule-activation.ts` with two surfaces: `shouldAutoActivate(signalScore, threshold)` — a pure predicate with no I/O — and `applyActivationPolicy({ store, logger, repo, limit?, threshold? })` — an orchestrator that fetches pending rules, evaluates each against the threshold, and calls `store.activateRule`. The threshold defaults to 0.7, overrideable via `GENERATED_RULE_ACTIVATION_THRESHOLD` env var, with the explicit parameter taking priority over env. Null returns from `activateRule` are counted as `activationFailures` to handle concurrent-delete races gracefully. Every decision emits structured pino logging (threshold-hit, skipped as debug, activated as info, failure as warn, run-complete summary). 25 tests covering predicate boundary conditions, env-var parsing, fail-open error handling, and the pending→active transition contract.

**T02 — Active-rule retrieval and prompt injection (active-rules.ts + review-prompt.ts)**
Created `src/knowledge/active-rules.ts` with three surfaces: `sanitizeRule` (runs the full `sanitizeContent` pipeline plus `MAX_RULE_TEXT_CHARS` truncation), `getActiveRulesForPrompt` (fail-open bounded retrieval with absolute cap of 20 rules, per-call observability), and `formatActiveRulesSection` (pure markdown formatter returning `## Generated Review Rules` section or empty string). Extended `buildReviewPrompt` context to accept `activeRules?: SanitizedActiveRule[]` and injected the formatted section before custom instructions, preserving recency-bias position for repo config. 19 tests in `active-rules.test.ts` and 11 new injection tests in `review-prompt.test.ts` (178 total passing).

**T03 — Proof harness (verify-m036-s02.ts)**
Created `scripts/verify-m036-s02.ts` with 3 checks using pure in-process stubs: ACTIVATION (applyActivationPolicy with a high-signal pending rule, verifies activated=1 and shouldAutoActivate boundary predicate), PROMPT-INJECTION (getActiveRulesForPrompt + formatActiveRulesSection, verifies section header, title, text, signal label), FAIL-OPEN (store throws, verifies empty result + warn emitted + empty section string). 18 harness tests in `verify-m036-s02.test.ts`. All 240 slice tests pass, harness exits 0 with `overallPassed: true`.

## Verification

Full slice verification run: `bun test ./src/knowledge/generated-rule-activation.test.ts ./src/knowledge/active-rules.test.ts ./src/execution/review-prompt.test.ts ./scripts/verify-m036-s02.test.ts` → 240 pass, 0 fail. `bun run verify:m036:s02 -- --json` → 3/3 checks PASS, overallPassed:true, exit 0. `bun run tsc --noEmit` → exit 0 (verified at T01, T02, and T03 completion).

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

The activation policy runs synchronously against the store interface but has no DB-connected integration tests — the proof harness uses in-process stubs only. Live DB integration testing is deferred to S03, which adds retirement and lifecycle verification against the real store.

## Follow-ups

S03 needs to wire `applyActivationPolicy` into the periodic sweep scheduler and exercise the full lifecycle (pending→active→retired) against the real DB store. The `GENERATED_RULE_ACTIVATION_THRESHOLD` env var is not yet surfaced in the AppConfig Zod schema — add it when hooking into the production sweep path.

## Files Created/Modified

- `src/knowledge/generated-rule-activation.ts` — New — activation logic: shouldAutoActivate predicate + applyActivationPolicy orchestrator with fail-open error handling and structured logging
- `src/knowledge/generated-rule-activation.test.ts` — New — 25 tests covering predicate boundaries, env-var parsing, fail-open, and pending→active transition contract
- `src/knowledge/active-rules.ts` — New — sanitizeRule, getActiveRulesForPrompt (fail-open bounded retrieval), formatActiveRulesSection (pure formatter)
- `src/knowledge/active-rules.test.ts` — New — 19 tests covering sanitization, retrieval limits/caps, fail-open, and section formatting
- `src/execution/review-prompt.ts` — Extended buildReviewPrompt context to accept activeRules; injected Generated Review Rules section before custom instructions
- `src/execution/review-prompt.test.ts` — Added 11 active-rules injection tests (178 total passing)
- `scripts/verify-m036-s02.ts` — New — 3-check proof harness: ACTIVATION, PROMPT-INJECTION, FAIL-OPEN
- `scripts/verify-m036-s02.test.ts` — New — 18 harness tests covering all check pass/fail paths and JSON output shape
- `package.json` — Added verify:m036:s02 script
