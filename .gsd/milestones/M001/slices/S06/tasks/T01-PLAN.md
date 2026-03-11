# T01: 06-content-safety 01

**Slice:** S06 — **Milestone:** M001

## Description

Create the content sanitizer module and TOCTOU comment filter as a standalone library.

Purpose: Provides the security primitives that Phase 6 Plan 02 will wire into the prompt pipeline. Ported from the battle-tested reference implementation in `tmp/claude-code-action/src/github/utils/sanitizer.ts`.
Output: `src/lib/sanitizer.ts` (sanitization + TOCTOU filter) and `src/lib/sanitizer.test.ts` (comprehensive tests)

## Must-Haves

- [ ] "sanitizeContent strips HTML comments from input"
- [ ] "sanitizeContent strips invisible Unicode characters (zero-width, control chars, soft hyphens, bidi overrides)"
- [ ] "sanitizeContent strips hidden content from markdown image alt text and link titles"
- [ ] "sanitizeContent strips hidden HTML attributes (alt, title, aria-label, data-*, placeholder)"
- [ ] "sanitizeContent normalizes HTML entities (decode printable ASCII, remove non-printable)"
- [ ] "sanitizeContent redacts GitHub tokens (ghp_, gho_, ghs_, ghr_, github_pat_)"
- [ ] "filterCommentsToTriggerTime excludes comments created at or after trigger timestamp"
- [ ] "filterCommentsToTriggerTime excludes comments updated at or after trigger timestamp"

## Files

- `src/lib/sanitizer.ts`
- `src/lib/sanitizer.test.ts`
