---
id: T02
parent: S01
milestone: M029
provides:
  - "## Output Contract" section in buildVoicePreservingPrompt banning all five reasoning starters
  - unit test asserting Output Contract presence in the generated prompt
key_files:
  - src/knowledge/wiki-voice-analyzer.ts
  - src/knowledge/wiki-voice-analyzer.test.ts
key_decisions:
  - appended Output Contract after Hard Constraints block — keeps constraint sections adjacent and lets the LLM read them as a single policy unit
  - listed all five banned starters verbatim in the contract text — matches the isReasoningProse regex from T01 exactly so prompt and enforcement gate are in sync
patterns_established:
  - prompt-level output contract mirrors the runtime filter — both the LLM instruction and the deterministic gate list the same starters, closing the loop at two layers
observability_surfaces:
  - no new runtime signals; prompt change is observable by inspecting the prompt string returned by buildVoicePreservingPrompt or by reading the LLM request payload in structured logs at module="wiki-voice-pipeline"
duration: ~5m
verification_result: passed
completed_at: 2026-03-21
blocker_discovered: false
---

# T02: Add Output Contract section to buildVoicePreservingPrompt

**Added `## Output Contract` section to `buildVoicePreservingPrompt` listing the five banned reasoning starters and instructing the LLM to begin output directly with the updated section text.**

## What Happened

Appended a new `## Output Contract` block immediately after the closing line of the `## Hard Constraints` section in `buildVoicePreservingPrompt` (`src/knowledge/wiki-voice-analyzer.ts`). The block reads:

```
## Output Contract
- Do NOT begin your response with reasoning, analysis, or meta-commentary
- Do NOT start with: "I'll", "Let me", "I will", "Looking at", "I need to", or similar phrases
- Output MUST begin directly with the updated section text
- Reasoning and explanation belong in a code review, not in a wiki article
```

This exactly mirrors the five starters tested by `isReasoningProse` (from T01), so the LLM is explicitly instructed to avoid the patterns the runtime filter will reject.

Added one new test in the `describe("buildVoicePreservingPrompt")` block in `src/knowledge/wiki-voice-analyzer.test.ts`:

```
it("includes Output Contract section banning reasoning starters")
```

The test calls `buildVoicePreservingPrompt` with minimal valid inputs and asserts that `prompt.includes("## Output Contract")`, `prompt.includes("Do NOT")`, and `prompt.includes("I'll")` are all `true`.

## Verification

Ran `bun test src/knowledge/wiki-voice-analyzer.test.ts` — 32 tests pass (31 existing + 1 new), 0 fail.

Ran `bun test src/knowledge/wiki-voice-validator.test.ts` — 30 tests pass, 0 fail (no regressions).

`grep -q "Output Contract" src/knowledge/wiki-voice-analyzer.ts` exits 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/knowledge/wiki-voice-analyzer.test.ts` | 0 | ✅ pass | 136ms |
| 2 | `bun test src/knowledge/wiki-voice-validator.test.ts` | 0 | ✅ pass | 172ms |
| 3 | `grep -q "Output Contract" src/knowledge/wiki-voice-analyzer.ts` | 0 | ✅ pass | <1ms |

## Diagnostics

The Output Contract is a prompt-level change. To inspect it at runtime, read the `prompt` variable in `processPage` just before it is passed to `generateWithVoicePreservation` — it will contain the `## Output Contract` block. LLM request payloads logged at `module="wiki-voice-pipeline"` (debug level) include the full prompt text, so structured log search for `Output Contract` will surface it there.

No new failure-path signals are added by this task — failures are still caught by the `isReasoningProse` gate from T01 and surface as `{ suggestion: "", feedback: "Reasoning prose detected: suggestion dropped" }`.

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/wiki-voice-analyzer.ts` — appended `## Output Contract` section to the template string returned by `buildVoicePreservingPrompt`
- `src/knowledge/wiki-voice-analyzer.test.ts` — added `"includes Output Contract section banning reasoning starters"` test to the `buildVoicePreservingPrompt` describe block
