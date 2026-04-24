---
id: T02
parent: S02
milestone: M061
key_files:
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
key_decisions:
  - Heavy mention-side work now uses one shared request-shape policy so prompt trimming, retrieval shaping, and diff/code-pointer prefetch cannot drift independently.
  - Casual filename mentions are treated as conversational by default; a filename/reference only upgrades to code-pointer admission when paired with location/debug-style intent.
  - Conversational retrieval keeps running fail-open, but its body and file-path hints are now staged to match the admitted context instead of inheriting rich prompt context wholesale.
duration: 
verification_result: mixed
completed_at: 2026-04-24T01:35:54.507Z
blocker_discovered: false
---

# T02: Gated mention code pointers, PR diff prefetch, and retrieval inputs behind the same light-vs-rich request policy.

**Gated mention code pointers, PR diff prefetch, and retrieval inputs behind the same light-vs-rich request policy.**

## What Happened

I tightened `src/handlers/mention.ts` so heavy mention-context side paths now follow one shared admission seam instead of running eagerly. I added request-shape helpers that distinguish code-seeking issue questions from casual filename mentions and diff-seeking PR questions from ordinary conversational asks. The handler now only builds candidate issue code pointers when the question looks like a real code-location/debug request, only prefetches PR diff context for explicit review or clearly diff-inspection-shaped mentions, and feeds retrieval variants with a staged body derived from the same policy instead of always reusing the full mention-context blob. I expanded `src/handlers/mention.test.ts` with regression coverage for the reduced conversational issue path, reduced conversational PR path, and a retrieval-input check that proves light-path queries do not carry candidate code-pointer context. Existing explicit-review and fail-open behavior stayed covered by the full handler suite.

## Verification

Ran `bun test ./src/handlers/mention.test.ts` after the final code change; all 125 tests passed, including the new light-path gating regressions and the preserved explicit-review/fail-open paths. I also attempted LSP diagnostics on the edited files, but no language server was available in this workspace, so the test suite served as the authoritative verification surface for this task. Manual code review of `src/handlers/mention.ts` confirmed the same admission-policy seam now drives code-pointer gating, retrieval-body shaping, retrieval file-path collection, and PR diff prefetch.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/handlers/mention.test.ts` | 0 | ✅ pass | 7040ms |
| 2 | `lsp diagnostics src/handlers/mention.ts + src/handlers/mention.test.ts` | 1 | ❌ fail | 20ms |

## Deviations

None.

## Known Issues

`capture_thought` failed when I tried to persist the shared-admission-policy pattern, so no durable memory entry was recorded for this task. The implementation, tests, and task artifacts were unaffected. LSP diagnostics were unavailable because no language server was running in this workspace.

## Files Created/Modified

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
