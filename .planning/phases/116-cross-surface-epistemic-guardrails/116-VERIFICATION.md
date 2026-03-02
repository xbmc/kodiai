---
status: passed
phase: 116
phase_name: Cross-Surface Epistemic Guardrails
verified: 2026-03-02
requirements: [PROMPT-04]
---

# Phase 116 Verification: Cross-Surface Epistemic Guardrails

## Goal Verification

**Phase Goal:** Epistemic guardrails apply consistently across all bot response surfaces, not just PR reviews

**Result: PASSED**

## Success Criteria Check

### 1. @kodiai mention responses on issues and PRs apply the same epistemic boundary rules as PR reviews

**Status: PASSED**

- `src/execution/mention-prompt.ts` imports `buildEpistemicBoundarySection` from `review-prompt.ts` (line 4)
- Called at line 289: `lines.push(buildEpistemicBoundarySection())`
- Issue mentions get additional context-visible tier adaptation (lines 292-299)
- Old "Factual Accuracy -- CRITICAL" section removed and replaced
- Tests in `mention-prompt.test.ts` verify: PR mention includes "Epistemic Boundaries", issue mention includes "Epistemic Boundaries", old header removed

### 2. Slack assistant responses apply the same epistemic boundary rules as PR reviews

**Status: PASSED**

- `src/slack/assistant-handler.ts` imports `buildEpistemicBoundarySection` from `../execution/review-prompt.ts` (line 4)
- Called at line 137 in `buildSlackAssistantPrompt()` before "Slack message:" content
- Old blanket "Never hedge" rule replaced with scoped "For things you can see in the codebase: state definitively"
- Tests in `assistant-handler.test.ts` verify: prompt contains "Epistemic Boundaries", "Diff-visible", "External knowledge"; does NOT contain old "Never hedge" rule

### 3. All surfaces refuse to assert external facts unless grounded in retrieved context or visible diff content

**Status: PASSED**

- All three surfaces (review, mention, Slack) share the exact same `buildEpistemicBoundarySection()` output
- Section explicitly states: "External knowledge -- Do NOT hedge these claims. Do NOT acknowledge the limitation. Silently omit them entirely."
- Common hallucination patterns listed: version numbers, feature introductions, deprecations, release dates, CVE details
- Universal citation rule enforced: no evidence = silently omit

## Requirement Traceability

| Requirement | Status | Evidence |
|-------------|--------|----------|
| PROMPT-04 | Verified | Epistemic guardrails present in review-prompt.ts, mention-prompt.ts, and assistant-handler.ts via shared buildEpistemicBoundarySection() |

## Test Evidence

```
194 pass, 0 fail, 560 expect() calls
Ran 194 tests across 3 files [42ms]
```

Files tested:
- `src/execution/review-prompt.test.ts` -- existing + new surface-neutral tests
- `src/execution/mention-prompt.test.ts` -- existing + new epistemic section tests
- `src/slack/assistant-handler.test.ts` -- existing + new epistemic + hedge reconciliation tests

## Must-Haves Checklist

- [x] `buildEpistemicBoundarySection()` uses surface-neutral language
- [x] Mention prompt (PR mentions) includes shared epistemic section
- [x] Mention prompt (issue mentions) includes shared epistemic section with context-visible tier
- [x] Slack assistant prompt includes shared epistemic section
- [x] Existing PR review behavior unchanged
- [x] Tests verify epistemic guardrails in each surface's prompt output
