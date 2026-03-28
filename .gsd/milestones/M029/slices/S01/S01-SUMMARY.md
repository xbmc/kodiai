---
id: S01
milestone: M029
status: done
risk: high
depends: []
completed_at: 2026-03-21
tasks_completed: 2/2
verification_result: passed
---

# S01 Summary: Prompt Fix + Content Filter

**Delivered a two-layer reasoning-prose defence: a deterministic runtime filter (`isReasoningProse`) that drops suggestions before voice validation, and a prompt-level `## Output Contract` that instructs the LLM not to produce such output in the first place.**

---

## What This Slice Delivered

### `isReasoningProse(text: string): boolean` — deterministic pre-LLM gate

Exported from `src/knowledge/wiki-voice-validator.ts`. Trims the input and matches against:

```
/^(I'll|Let me|I will|Looking at|I need to)/i
```

Returns `true` for any of the five banned starters; returns `false` for valid wiki content, empty string, and mid-text occurrences. The trim+anchor design avoids mid-text false positives.

### Short-circuit in `generateWithVoicePreservation`

`isReasoningProse` fires as "Step 1a" — the very first check after `generateFn()` returns, before template preservation and voice validation. When it fires:

- Returns `{ suggestion: "", voiceMismatchWarning: false, validationResult: { passed: false, feedback: "Reasoning prose detected: suggestion dropped" } }`
- Emits `logger.warn` with `{ pageTitle }` at `module="wiki-voice-validator"`
- No template check or LLM voice-validation calls are made

This ensures reasoning prose is dropped at the cheapest possible point in the pipeline.

### `## Output Contract` section in `buildVoicePreservingPrompt`

Appended after the `## Hard Constraints` section in `src/knowledge/wiki-voice-analyzer.ts`. Explicitly lists all five banned starters and instructs the LLM to begin output directly with the updated section text. The prompt mirrors the runtime filter exactly — both layers guard the same patterns.

---

## Test Coverage Added

**`wiki-voice-validator.test.ts`** — total: 30 tests, 0 fail  
New tests (10):
- 5 × `isReasoningProse` returns true (one per banned starter)
- 1 × returns false for valid wiki content with PR citation
- 1 × returns false for empty string
- 1 × returns false when reasoning words appear mid-text
- 1 × case-insensitive match
- 1 × `generateWithVoicePreservation` drops suggestion when `generateFn` returns reasoning prose

**`wiki-voice-analyzer.test.ts`** — total: 32 tests, 0 fail  
New tests (1):
- `buildVoicePreservingPrompt` includes `## Output Contract` section with `Do NOT` prohibition and the `I'll` starter listed verbatim

---

## Patterns Established

**Pre-LLM deterministic filter pattern:** `trim → regex → early return before any LLM calls`. This gate is the canonical approach for quality enforcement at generation time in this pipeline. Place it as early as possible — before any I/O-bound validation — so failures are cheap.

**Two-layer prompt/filter alignment:** The LLM instruction (prompt-level) and the runtime filter list the same starters verbatim. This keeps the two layers in sync and means the test for the prompt (`includes("I'll")`) serves as a cross-check that both layers agree.

---

## Observability Surfaces

| Signal | Where | How to find it |
|--------|-------|----------------|
| `logger.warn` | `module="wiki-voice-validator"` | message: `"isReasoningProse: dropping suggestion — starts with reasoning prose"`, field: `pageTitle` |
| `VoicePreservedSuggestion.validationResult.feedback` | returned struct | value: `"Reasoning prose detected: suggestion dropped"` |
| Prompt-level Output Contract | LLM request payload | `module="wiki-voice-pipeline"` debug logs, search for `"## Output Contract"` |

---

## Requirement Coverage

| Req | Treatment |
|-----|-----------|
| R033 | **Primary owner: this slice.** `isReasoningProse` is the deterministic pattern-verification gate specified by R033. Proven by 10 unit tests. |
| R025 | Re-validated: the content filter enforces that stored suggestions are actual wiki text, not reasoning prose. Both test suites pass. |

---

## Files Changed

| File | Change |
|------|--------|
| `src/knowledge/wiki-voice-validator.ts` | Added `isReasoningProse` export; added Step 1a short-circuit in `generateWithVoicePreservation` |
| `src/knowledge/wiki-voice-validator.test.ts` | Added `isReasoningProse` import; 9-test describe block + 1-test pipeline integration describe block |
| `src/knowledge/wiki-voice-analyzer.ts` | Appended `## Output Contract` section to `buildVoicePreservingPrompt` template string |
| `src/knowledge/wiki-voice-analyzer.test.ts` | Added Output Contract presence test in `buildVoicePreservingPrompt` describe block |

---

## What the Next Slices Should Know

- **S02 (heuristic threshold):** `isReasoningProse` is exported and stable. S02's SQL threshold test does not interact with this filter — they operate at different pipeline stages (page selection vs. generation).
- **S03 (issue cleanup):** The deterministic filter means re-generated content posted after cleanup will not contain reasoning prose, provided `isReasoningProse` fires correctly. The filter alone does not clean existing DB rows — S04 handles that separately.
- **S04 (proof harness):** The `CONTENT-FILTER-REJECTS` check in the verify harness should call `isReasoningProse("I'll analyze the evidence from PR #27909")` and assert it returns `true`. The `PROMPT-BANS-META` check should call `buildVoicePreservingPrompt` with minimal inputs and assert the output contains `"## Output Contract"` and `"Do NOT"`.
- **Drop shape is canonical:** Downstream consumers distinguishing this failure from other failure modes should match `validationResult.feedback === "Reasoning prose detected: suggestion dropped"` — do not parse log streams.
