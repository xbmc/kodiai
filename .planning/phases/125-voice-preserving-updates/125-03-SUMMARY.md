---
phase: 125-voice-preserving-updates
plan: 03
subsystem: knowledge
tags: [llm, wiki, voice-pipeline, task-types, integration]

requires:
  - phase: 125-01
    provides: extractPageStyle, selectExemplarSections, types
  - phase: 125-02
    provides: generateWithVoicePreservation, validateVoiceMatch
provides:
  - TASK_TYPES.VOICE_EXTRACT and TASK_TYPES.VOICE_VALIDATE registered
  - buildVoicePreservingPrompt function
  - createVoicePreservingPipeline factory (public API for Phase 123)
  - VoicePreservingPipelineOptions and VoicePreservedUpdate types
affects: [123-update-generation]

tech-stack:
  added: []
  patterns: [voice-preserving pipeline factory, prompt composition with style + exemplars + constraints]

key-files:
  created: []
  modified:
    - src/llm/task-types.ts
    - src/knowledge/wiki-voice-analyzer.ts
    - src/knowledge/wiki-voice-analyzer.test.ts
    - src/knowledge/wiki-voice-types.ts
    - src/knowledge/wiki-voice-validator.ts

key-decisions:
  - "TASK_TYPES.VOICE_EXTRACT and VOICE_VALIDATE are non-agentic (AI SDK via generateWithFallback)"
  - "Pipeline extracts style once per page, selects exemplars once per page, then processes sections"
  - "buildVoicePreservingPrompt enforces all CONTEXT.md constraints in prompt text"
  - "String literals replaced with TASK_TYPES constants in both analyzer and validator"

patterns-established:
  - "Voice-preserving pipeline factory: createVoicePreservingPipeline returns processPage function"
  - "Prompt composition: style description + exemplar sections + original content + diff evidence + constraints"
  - "Feedback injection on retry: append Voice Match Feedback section to original prompt"

requirements-completed: []

duration: 8min
completed: 2026-03-03
---

# Phase 125-03: Task Types and Pipeline Wiring Summary

**Registered voice task types and created cohesive voice-preserving generation pipeline for Phase 123 integration**

## Performance

- **Duration:** 8 min
- **Tasks:** 2 completed
- **Files modified:** 5

## Accomplishments

- Registered `TASK_TYPES.VOICE_EXTRACT` ("voice.extract") and `TASK_TYPES.VOICE_VALIDATE` ("voice.validate") as non-agentic task types
- Created `buildVoicePreservingPrompt()` — composes style description, exemplar sections, original content, diff evidence, and all CONTEXT.md constraints into a single generation prompt
- Created `createVoicePreservingPipeline()` — factory that returns a `processPage` function orchestrating: fetch chunks -> extract style -> select exemplars -> generate per section -> validate per section -> retry if needed
- Added `VoicePreservingPipelineOptions` and `VoicePreservedUpdate` types for Phase 123 consumption
- Replaced all string literal task types with TASK_TYPES constants in both analyzer and validator
- Added 7 new tests for buildVoicePreservingPrompt covering all constraints

## Self-Check: PASSED

- [x] TASK_TYPES.VOICE_EXTRACT and VOICE_VALIDATE exist and are not in AGENTIC_TASK_TYPES
- [x] buildVoicePreservingPrompt includes all CONTEXT.md constraints
- [x] createVoicePreservingPipeline extracts style once per page (not per section)
- [x] All 24 tests pass across both test files
- [x] No regressions in wiki-staleness-detector tests (7/7 pass)
