# S01: Prompt Fix + Content Filter

**Goal:** Add a deterministic reasoning-prose filter (`isReasoningProse`) that drops suggestions starting with known reasoning starters before they reach voice validation, and add an `## Output Contract` section to `buildVoicePreservingPrompt` that explicitly bans those starters in generated output.
**Demo:** `bun test src/knowledge/wiki-voice-validator.test.ts src/knowledge/wiki-voice-analyzer.test.ts` passes with new tests proving: reasoning text is rejected, real wiki content with PR citation is accepted, empty string edge case is handled, and `buildVoicePreservingPrompt` output contains an explicit prohibition phrase banning reasoning starters.

## Must-Haves

- `isReasoningProse(text: string): boolean` exported from `src/knowledge/wiki-voice-validator.ts`, matching any of: `I'll`, `Let me`, `I will`, `Looking at`, `I need to` at the start of the string (case-insensitive, trimmed)
- `generateWithVoicePreservation` calls `isReasoningProse` immediately after generating the initial suggestion; if it returns true, the suggestion is dropped (returns empty suggestion with `voiceMismatchWarning: false`) and a `logger.warn` is emitted
- `buildVoicePreservingPrompt` in `src/knowledge/wiki-voice-analyzer.ts` gains an `## Output Contract` section with explicit prohibition: model must not start output with reasoning starters; must output the updated section directly
- Unit tests in `wiki-voice-validator.test.ts`: reasoning text → `isReasoningProse` returns true; valid MediaWiki content → returns false; empty string → returns false; `generateWithVoicePreservation` with reasoning-prose initial output drops the suggestion
- Unit test in `wiki-voice-analyzer.test.ts`: `buildVoicePreservingPrompt` output contains a prohibition phrase such as "do not" or "Do NOT" banning reasoning starters

## Proof Level

- This slice proves: contract
- Real runtime required: no
- Human/UAT required: no

## Verification

- `bun test src/knowledge/wiki-voice-validator.test.ts` — all existing 20 tests pass plus new `isReasoningProse` tests and reasoning-prose pipeline drop test
- `bun test src/knowledge/wiki-voice-analyzer.test.ts` — all existing 31 tests pass plus new output contract prohibition test

## Tasks

- [x] **T01: Implement isReasoningProse and wire into generateWithVoicePreservation** `est:45m`
  - Why: R033 requires generation output to be pattern-verified before storage; this is the deterministic gate that enforces that requirement in `wiki-voice-validator.ts`
  - Files: `src/knowledge/wiki-voice-validator.ts`, `src/knowledge/wiki-voice-validator.test.ts`
  - Do: Add `isReasoningProse(text: string): boolean` as an exported function; call it immediately after `generateFn()` returns the initial suggestion inside `generateWithVoicePreservation`; if it returns true, log a warning and return `{ suggestion: "", voiceMismatchWarning: false, validationResult: { passed: false, ... }, templateCheckPassed: false, headingCheckPassed: false, formattingAdvisory: [], sectionLengthAdvisory: null }` — do not proceed to template check or voice validation; add unit tests covering: five reasoning starters (all return true), valid wiki content (returns false), empty string (returns false), mixed content that starts clean (returns false), and a `generateWithVoicePreservation` integration test that injects a reasoning-prose string from `generateFn` and asserts the returned `suggestion` is `""`
  - Verify: `bun test src/knowledge/wiki-voice-validator.test.ts` — all tests pass, new reasoning-prose tests included
  - Done when: `bun test src/knowledge/wiki-voice-validator.test.ts` exits 0 with no failures; grep confirms `export function isReasoningProse` exists in `wiki-voice-validator.ts`

- [x] **T02: Add Output Contract section to buildVoicePreservingPrompt** `est:30m`
  - Why: The prompt must instruct the LLM not to start output with reasoning prose; without this the filter is the only safeguard and the LLM has no signal to avoid generating such output in the first place
  - Files: `src/knowledge/wiki-voice-analyzer.ts`, `src/knowledge/wiki-voice-analyzer.test.ts`
  - Do: Add an `## Output Contract` section at the end of the prompt returned by `buildVoicePreservingPrompt` (after the `## Hard Constraints` section); the contract must explicitly list the banned starters ("I'll", "Let me", "I will", "Looking at", "I need to") and state that output must begin directly with the updated section text, not reasoning or analysis; add a test in `wiki-voice-analyzer.test.ts` asserting that the prompt output contains a phrase banning reasoning starters — specifically check for the presence of both `Output Contract` (the section header) and at least one of "do not" / "Do NOT" in the output contract section
  - Verify: `bun test src/knowledge/wiki-voice-analyzer.test.ts` — all tests pass including new output contract test
  - Done when: `bun test src/knowledge/wiki-voice-analyzer.test.ts` exits 0; `grep -q "Output Contract" src/knowledge/wiki-voice-analyzer.ts` succeeds

## Files Likely Touched

- `src/knowledge/wiki-voice-validator.ts`
- `src/knowledge/wiki-voice-validator.test.ts`
- `src/knowledge/wiki-voice-analyzer.ts`
- `src/knowledge/wiki-voice-analyzer.test.ts`

## Observability / Diagnostics

**Runtime signals added by this slice:**

- `isReasoningProse` fires before template/voice checks, so a drop is always attributable to this gate — inspect logs for `"isReasoningProse: dropping suggestion"` with `pageTitle` field
- `logger.warn` is emitted with `{ pageTitle }` whenever a reasoning-prose drop occurs, giving operators visibility into which page triggered the filter
- `VoicePreservedSuggestion.validationResult.feedback` is set to `"Reasoning prose detected: suggestion dropped"` — downstream consumers can distinguish this from other failure modes without parsing log streams
- All signals are emitted at the `wiki-voice-validator` child logger module for easy log filtering: `module === "wiki-voice-validator"`

**Inspecting failure state:**

- A dropped suggestion surfaces as `{ suggestion: "", voiceMismatchWarning: false, validationResult: { passed: false, feedback: "Reasoning prose detected: suggestion dropped" } }`
- To verify the gate fires, run: `grep "isReasoningProse" <log-output>` or filter structured logs on `{ module: "wiki-voice-validator", level: "warn" }`
- Redaction: `pageTitle` values logged here are wiki page titles; they are not secrets but should be treated as user-content identifiers

**Diagnostic verification:**

- `bun test src/knowledge/wiki-voice-validator.test.ts --test-name-pattern "drops suggestion"` — exercises the full drop path without a real LLM and asserts the observable failure shape
