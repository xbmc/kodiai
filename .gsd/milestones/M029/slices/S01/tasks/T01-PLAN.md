---
estimated_steps: 4
estimated_files: 2
skills_used:
  - test
---

# T01: Implement isReasoningProse and wire into generateWithVoicePreservation

**Slice:** S01 — Prompt Fix + Content Filter
**Milestone:** M029

## Description

Add `isReasoningProse(text: string): boolean` as an exported function in `wiki-voice-validator.ts`. This function is the deterministic gate that satisfies R033: generation output is pattern-verified before storage. Wire it into `generateWithVoicePreservation` so that when the initial generation returns reasoning prose, the suggestion is dropped immediately (before template check or voice validation) with a warning log.

The five banned reasoning starters are: `I'll`, `Let me`, `I will`, `Looking at`, `I need to`. Matching is case-insensitive and applied to the trimmed text from the start of the string.

## Steps

1. **Add `isReasoningProse` function** to `src/knowledge/wiki-voice-validator.ts` — export it immediately after the existing constant and before `checkTemplatePreservation`. The function trims the input and tests it against a regex anchored at the start: `/^(I'll|Let me|I will|Looking at|I need to)/i`. Returns `true` if any pattern matches, `false` otherwise (including empty string).

2. **Wire into `generateWithVoicePreservation`** — after the line `let suggestion = await opts.generateFn();` (Step 1), add a new Step 1a block: call `isReasoningProse(suggestion)`; if it returns true, emit `logger.warn({ pageTitle: opts.styleDescription.pageTitle }, "isReasoningProse: dropping suggestion — starts with reasoning prose")` and return a fully-populated `VoicePreservedSuggestion` with `suggestion: ""`, `voiceMismatchWarning: false`, `validationResult: { passed: false, scores: { toneMatch: 0, perspectiveMatch: 0, structureMatch: 0, terminologyMatch: 0, formattingMatch: 0, markupPreservation: 0 }, overallScore: 0, feedback: "Reasoning prose detected: suggestion dropped" }`, `templateCheckPassed: false`, `headingCheckPassed: false`, `formattingAdvisory: []`, `sectionLengthAdvisory: null`. Do NOT proceed to the template check or voice validation steps.

3. **Add unit tests** in `src/knowledge/wiki-voice-validator.test.ts` — add a new `describe("isReasoningProse")` block with these tests:
   - `"returns true for I'll starter"` — `isReasoningProse("I'll analyze the evidence from PR #27909")` → `true`
   - `"returns true for Let me starter"` — `isReasoningProse("Let me look at what changed in this section.")` → `true`
   - `"returns true for I will starter"` — `isReasoningProse("I will now update this section.")` → `true`
   - `"returns true for Looking at starter"` — `isReasoningProse("Looking at the changes, the API was renamed.")` → `true`
   - `"returns true for I need to starter"` — `isReasoningProse("I need to first understand the context.")` → `true`
   - `"returns false for valid wiki content with PR citation"` — `isReasoningProse("== Configuration ==\nThe add-on now supports OAuth 2.0 (PR #27909).")` → `false`
   - `"returns false for empty string"` — `isReasoningProse("")` → `false`
   - `"returns false when reasoning words appear mid-text"` — `isReasoningProse("The system will now let me explain later.")` → `false`
   - `"is case insensitive"` — `isReasoningProse("i'll start with the overview.")` → `true`

4. **Add pipeline integration test** — add a test in the existing `describe("generateWithVoicePreservation")` block: `"drops suggestion when generateFn returns reasoning prose"`. Use the existing `makeOpts()` helper. Call `generateWithVoicePreservation` with `generateFn: async () => "I'll analyze the evidence from PR #27909"` and a dummy `buildPromptWithFeedback`. Because `isReasoningProse` fires synchronously before the LLM call, the function should return `{ suggestion: "", ... }` without ever calling `validateVoiceMatch`. Assert `result.suggestion === ""` and `result.voiceMismatchWarning === false`. (The function will not throw even without a real LLM because it returns before the LLM call.)

## Must-Haves

- [ ] `export function isReasoningProse(text: string): boolean` is present and exported from `wiki-voice-validator.ts`
- [ ] Pattern matches exactly: `I'll`, `Let me`, `I will`, `Looking at`, `I need to` (case-insensitive, anchored at start after trimming)
- [ ] `generateWithVoicePreservation` short-circuits and returns `suggestion: ""` when `isReasoningProse` returns true
- [ ] Warning is logged with `pageTitle` when the reasoning-prose drop fires
- [ ] 9 `isReasoningProse` unit tests pass
- [ ] Pipeline integration test passes without requiring a real LLM

## Verification

- `bun test src/knowledge/wiki-voice-validator.test.ts` — exits 0, all tests pass (minimum: 20 existing + 10 new = 30 tests)
- `grep -q "export function isReasoningProse" src/knowledge/wiki-voice-validator.ts`

## Inputs

- `src/knowledge/wiki-voice-validator.ts` — existing file to modify; add `isReasoningProse` function and wire it into `generateWithVoicePreservation`
- `src/knowledge/wiki-voice-validator.test.ts` — existing test file to extend with new test cases

## Expected Output

- `src/knowledge/wiki-voice-validator.ts` — modified: `isReasoningProse` exported, wired into `generateWithVoicePreservation`
- `src/knowledge/wiki-voice-validator.test.ts` — modified: new `isReasoningProse` describe block + pipeline integration test

## Observability Impact

**Signals changed by this task:**

- New `logger.warn` at `module: "wiki-voice-validator"` with message `"isReasoningProse: dropping suggestion — starts with reasoning prose"` and field `{ pageTitle }`. Fires once per reasoning-prose drop; never fires on clean content.
- `VoicePreservedSuggestion.validationResult.feedback` is set to `"Reasoning prose detected: suggestion dropped"` when the gate fires. Downstream consumers can branch on this string to distinguish reasoning-prose drops from template-check or voice-validation failures.
- No new metrics or counters added; log stream is the primary inspection surface.

**Inspecting this task's behavior:**

- Filter logs by `{ module: "wiki-voice-validator", level: "warn" }` and message containing `"isReasoningProse"`.
- Observable failure shape: `{ suggestion: "", voiceMismatchWarning: false, validationResult: { passed: false, feedback: "Reasoning prose detected: suggestion dropped" } }`.
- Run `bun test src/knowledge/wiki-voice-validator.test.ts --test-name-pattern "drops suggestion"` to exercise the full drop path in isolation without a real LLM.
