# S06: Content Safety

**Goal:** Create the content sanitizer module and TOCTOU comment filter as a standalone library.
**Demo:** Create the content sanitizer module and TOCTOU comment filter as a standalone library.

## Must-Haves


## Tasks

- [x] **T01: 06-content-safety 01** `est:2min`
  - Create the content sanitizer module and TOCTOU comment filter as a standalone library.

Purpose: Provides the security primitives that Phase 6 Plan 02 will wire into the prompt pipeline. Ported from the battle-tested reference implementation in `tmp/claude-code-action/src/github/utils/sanitizer.ts`.
Output: `src/lib/sanitizer.ts` (sanitization + TOCTOU filter) and `src/lib/sanitizer.test.ts` (comprehensive tests)
- [x] **T02: 06-content-safety 02** `est:2min`
  - Integrate content sanitization and TOCTOU filtering into all prompt builders.

Purpose: Wires the sanitizer module (from Plan 01) into every location where user-generated content enters the LLM prompt, closing both MENTION-06 (sanitization) and MENTION-07 (TOCTOU) requirements.
Output: All three prompt builder files modified to sanitize user content at the boundary.

## Files Likely Touched

- `src/lib/sanitizer.ts`
- `src/lib/sanitizer.test.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/review-prompt.ts`
- `src/execution/prompt.ts`
