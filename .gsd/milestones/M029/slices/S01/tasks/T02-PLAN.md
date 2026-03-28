---
estimated_steps: 3
estimated_files: 2
skills_used:
  - test
---

# T02: Add Output Contract section to buildVoicePreservingPrompt

**Slice:** S01 — Prompt Fix + Content Filter
**Milestone:** M029

## Description

`buildVoicePreservingPrompt` in `src/knowledge/wiki-voice-analyzer.ts` must gain an `## Output Contract` section that explicitly tells the LLM not to start its output with reasoning prose. Without this, the LLM has no prompt-level signal to avoid generating such output — the `isReasoningProse` filter from T01 is the enforcement gate, but the prompt should direct the model to avoid triggering it in the first place.

The output contract section lists the five banned starters (`I'll`, `Let me`, `I will`, `Looking at`, `I need to`) and instructs the model to begin its output directly with the updated section content.

## Steps

1. **Add `## Output Contract` section** to the string returned by `buildVoicePreservingPrompt` in `src/knowledge/wiki-voice-analyzer.ts`. Append it after the existing `## Hard Constraints` block (which ends with `- Output the COMPLETE updated section, not a diff`). The new section should read:

   ```
   ## Output Contract
   - Do NOT begin your response with reasoning, analysis, or meta-commentary
   - Do NOT start with: "I'll", "Let me", "I will", "Looking at", "I need to", or similar phrases
   - Output MUST begin directly with the updated section text
   - Reasoning and explanation belong in a code review, not in a wiki article
   ```

2. **Add unit test** in `src/knowledge/wiki-voice-analyzer.test.ts` — add a test inside the existing `describe("buildVoicePreservingPrompt")` block: `"includes Output Contract section banning reasoning starters"`. Call `buildVoicePreservingPrompt` with any valid minimal inputs and assert:
   - `prompt.includes("## Output Contract")` → `true`
   - `prompt.includes("Do NOT")` → `true` (at least one "Do NOT" prohibition in the contract section)
   - `prompt.includes("I'll")` → `true` (the banned starter appears in the contract listing)

3. **Run both test suites** to confirm no regressions:
   - `bun test src/knowledge/wiki-voice-analyzer.test.ts`
   - `bun test src/knowledge/wiki-voice-validator.test.ts`

## Must-Haves

- [ ] `## Output Contract` section is present in the prompt returned by `buildVoicePreservingPrompt`
- [ ] The contract explicitly names at least: `I'll`, `Let me`, `I will`, `Looking at`, `I need to` as banned starters
- [ ] The contract instructs the model to output the updated section text directly
- [ ] Existing `buildVoicePreservingPrompt` tests still pass (no regressions — the 8 existing tests in that describe block must all still pass)
- [ ] New test passes: prompt contains `## Output Contract`, `Do NOT`, and `I'll`

## Verification

- `bun test src/knowledge/wiki-voice-analyzer.test.ts` — exits 0, all tests pass (31 existing + 1 new = 32 minimum)
- `grep -q "Output Contract" src/knowledge/wiki-voice-analyzer.ts`
- `bun test src/knowledge/wiki-voice-validator.test.ts` — still exits 0 (no regressions from this task)

## Inputs

- `src/knowledge/wiki-voice-analyzer.ts` — existing file; `buildVoicePreservingPrompt` function to extend with `## Output Contract` section
- `src/knowledge/wiki-voice-analyzer.test.ts` — existing test file to extend with one new test

## Expected Output

- `src/knowledge/wiki-voice-analyzer.ts` — modified: `buildVoicePreservingPrompt` returns prompt including `## Output Contract` section with banned starters listed
- `src/knowledge/wiki-voice-analyzer.test.ts` — modified: new test asserting output contract section presence
