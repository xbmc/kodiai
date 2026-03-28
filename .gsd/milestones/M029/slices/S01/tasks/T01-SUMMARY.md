---
id: T01
parent: S01
milestone: M029
provides:
  - isReasoningProse exported function in wiki-voice-validator.ts
  - reasoning-prose short-circuit in generateWithVoicePreservation
  - 9 isReasoningProse unit tests + 1 pipeline integration test
key_files:
  - src/knowledge/wiki-voice-validator.ts
  - src/knowledge/wiki-voice-validator.test.ts
key_decisions:
  - regex anchored at trimmed-string start — no mid-text false positives
  - short-circuit fires before template check and voice validation — cheapest gate runs first
  - observable via logger.warn with pageTitle field and via feedback string in VoicePreservedSuggestion
patterns_established:
  - pre-LLM deterministic filter pattern: trim → regex → early return before any LLM calls
observability_surfaces:
  - logger.warn at module="wiki-voice-validator" with message "isReasoningProse: dropping suggestion — starts with reasoning prose"
  - VoicePreservedSuggestion.validationResult.feedback = "Reasoning prose detected: suggestion dropped"
duration: ~20m
verification_result: passed
completed_at: 2026-03-21
blocker_discovered: false
---

# T01: Implement isReasoningProse and wire into generateWithVoicePreservation

**Added `isReasoningProse` deterministic gate to `wiki-voice-validator.ts` and wired it as the first check in `generateWithVoicePreservation`, dropping reasoning-prose suggestions before any LLM validation calls.**

## What Happened

Added `export function isReasoningProse(text: string): boolean` immediately after the `VOICE_MATCH_THRESHOLD` constant in `wiki-voice-validator.ts`. The function trims the input and tests against `/^(I'll|Let me|I will|Looking at|I need to)/i`, returning `true` for any of the five banned reasoning starters and `false` otherwise (including empty string).

Wired the function into `generateWithVoicePreservation` as "Step 1a" — the first check executed after `generateFn()` returns. When it fires, the function immediately returns a fully-populated `VoicePreservedSuggestion` with `suggestion: ""`, `voiceMismatchWarning: false`, and `feedback: "Reasoning prose detected: suggestion dropped"`. A `logger.warn` with `{ pageTitle }` is emitted to surface the event in structured logs. No template check or LLM voice-validation calls are made when this gate triggers.

Extended `wiki-voice-validator.test.ts` with:
- Import of `isReasoningProse` added to the existing named-import list
- `describe("isReasoningProse")` block: 9 tests covering all five starters (true), valid wiki content (false), empty string (false), mid-text occurrence (false), and case-insensitivity (true)
- `describe("generateWithVoicePreservation — reasoning prose drop")` block: 1 integration test verifying the short-circuit path returns `suggestion: ""` and `voiceMismatchWarning: false` without needing a real LLM

Also resolved three pre-flight observability gaps:
- Added `## Observability / Diagnostics` section to S01-PLAN.md documenting log signals, failure shape, and filtering guidance
- Added a diagnostic verification step to S01-PLAN.md pointing at the test-name-pattern flag
- Added `## Observability Impact` section to T01-PLAN.md documenting the new warn signal and inspectable failure shape

## Verification

Ran `bun test src/knowledge/wiki-voice-validator.test.ts` — 30 tests pass, 0 fail.

Ran `grep -q "export function isReasoningProse" src/knowledge/wiki-voice-validator.ts` — exits 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/knowledge/wiki-voice-validator.test.ts` | 0 | ✅ pass | 145ms |
| 2 | `grep -q "export function isReasoningProse" src/knowledge/wiki-voice-validator.ts` | 0 | ✅ pass | <1ms |

## Diagnostics

- Filter logs by `{ module: "wiki-voice-validator", level: "warn" }` and message `"isReasoningProse: dropping suggestion"` to see all reasoning-prose drops with their `pageTitle`.
- Observable failure shape: `{ suggestion: "", voiceMismatchWarning: false, validationResult: { passed: false, feedback: "Reasoning prose detected: suggestion dropped" } }`.
- Isolated test: `bun test src/knowledge/wiki-voice-validator.test.ts --test-name-pattern "drops suggestion"` — exercises the full drop path without a real LLM.

## Deviations

The plan described adding the pipeline integration test inside the existing `describe("generateWithVoicePreservation")` block. Instead, a separate `describe("generateWithVoicePreservation — reasoning prose drop")` block was created to avoid mixing it with the single existing test that has a try/catch pattern. This keeps the reasoning-prose test self-contained and avoids needing to inherit the existing test's error-handling approach.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/wiki-voice-validator.ts` — added `isReasoningProse` export and Step 1a short-circuit in `generateWithVoicePreservation`
- `src/knowledge/wiki-voice-validator.test.ts` — added `isReasoningProse` import, 9-test describe block, and 1-test pipeline integration describe block
- `.gsd/milestones/M029/slices/S01/S01-PLAN.md` — added `## Observability / Diagnostics` section and marked T01 done
- `.gsd/milestones/M029/slices/S01/tasks/T01-PLAN.md` — added `## Observability Impact` section
