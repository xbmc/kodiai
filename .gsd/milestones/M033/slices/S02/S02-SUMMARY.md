---
id: S02
parent: M033
milestone: M033
provides:
  - anthropic-api-key pattern in scanOutgoingForSecrets — sk-ant-oat01-* and sk-ant-api03-* tokens are now blocked from all 4 MCP servers and the Slack assistant handler that wire through scanOutgoingForSecrets.
requires:
  []
affects:
  []
key_files:
  - src/lib/sanitizer.ts
  - src/lib/sanitizer.test.ts
key_decisions:
  - Regex /sk-ant-[a-z0-9]+-[A-Za-z0-9_\-]{20,}/ — fixed prefix + type slug + min-20-char body avoids false positives on short strings while covering both oat01/api03 token families.
patterns_established:
  - New secret pattern entries in scanOutgoingForSecrets follow the shape: { name: string, regex: RegExp }. The pattern is append-only; the JSDoc count comment must be updated to match.
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/milestones/M033/slices/S02/tasks/T01-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-31T11:42:40.527Z
blocker_discovered: false
---

# S02: Add Anthropic token patterns to outgoing secret scan

**Added anthropic-api-key as the 7th pattern in scanOutgoingForSecrets, blocking sk-ant-oat01-* (Claude Code OAuth) and sk-ant-api03-* (Anthropic API) tokens from leaving the system.**

## What Happened

Single-task slice. T01 appended a new pattern entry to the `SECRET_PATTERNS` array in `src/lib/sanitizer.ts` — regex `/sk-ant-[a-z0-9]+-[A-Za-z0-9_\-]{20,}/` matching the fixed `sk-ant-` prefix, a lower-case type slug (e.g. `oat01-`, `api03-`), and a minimum-20-char base64url body. The JSDoc count comment was updated from 6 to 7 and the new entry appended to the pattern list. Three test cases were added to `src/lib/sanitizer.test.ts`: standalone oat01 OAuth token, standalone api03 API key, and an api03 token embedded in prose — all asserting `blocked:true` with `matchedPattern:"anthropic-api-key"`. Slice-level verification ran `bun test ./src/lib/sanitizer.test.ts` and all 71 tests passed (68 pre-existing + 3 new).

## Verification

Ran `bun test ./src/lib/sanitizer.test.ts` — 71 pass, 0 fail. The three new anthropic-api-key cases all assert correctly: `detects anthropic-api-key (sk-ant-oat01- OAuth token)`, `detects anthropic-api-key (sk-ant-api03- API key)`, `detects anthropic-api-key embedded in prose`.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

The regex requires a minimum 20-char body. Real Anthropic tokens are substantially longer (80+ chars), so the 20-char floor is a conservative lower bound. A pathologically short synthetic token (under 20 chars) would not be caught — acceptable given real token lengths.

## Follow-ups

None.

## Files Created/Modified

- `src/lib/sanitizer.ts` — Added anthropic-api-key as 7th pattern entry; updated JSDoc count and pattern list.
- `src/lib/sanitizer.test.ts` — Added 3 test cases for anthropic-api-key pattern (oat01, api03, embedded in prose).
