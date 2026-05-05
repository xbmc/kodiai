---
id: T03
parent: S01
milestone: M066
key_files:
  - src/execution/types.ts
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
key_decisions:
  - Used the existing pure formatter-suggestion parser as the single source of mention intent and carried its descriptor through `ExecutionContext` rather than re-parsing downstream.
  - Treated only `review-and-format` formatter requests as explicit review work so format-only suggestions stay on the read-only mention lane.
duration: 
verification_result: mixed
completed_at: 2026-05-05T00:15:00.223Z
blocker_discovered: false
---

# T03: Wired formatter-suggestion mention intent into executor context without enabling write mode.

**Wired formatter-suggestion mention intent into executor context without enabling write mode.**

## What Happened

Added the optional `formatterSuggestionRequest` field to `ExecutionContext` and imported the pure formatter-suggestion parser into the mention handler. The handler now detects formatter-suggestion requests immediately after mention stripping in both the provisional queue-routing path and the execution-time path. Combined `review & format suggestions` requests are treated as explicit review work for queue coordination, review prompt routing, review output keys, and inline tools, while format-only suggestion requests remain read-only mention responses. The PR implicit write-intent guard now skips formatter-suggestion descriptors so explicit format-suggestion wording cannot fall through into write-mode detection. Full-handler fixture tests capture the executor context for `@kodiai format suggestions`, `@kodiai suggest formatting fixes`, and `@kodiai review & format suggestions`.

## Verification

Followed test-first flow: the new mention fixture tests initially failed because `formatterSuggestionRequest` was undefined in executor context, then passed after wiring. Ran the targeted task command and the full S01 slice verification command successfully. LSP diagnostics were attempted but no TypeScript language server was available in this harness.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000` | 1 | ❌ fail | 6390ms |
| 2 | `bun test ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000` | 0 | ✅ pass | 6360ms |
| 3 | `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000` | 0 | ✅ pass | 6450ms |
| 4 | `lsp diagnostics src/handlers/mention.ts` | 1 | ❌ fail | 0ms |

## Deviations

GSD memory lookup failed before implementation because the memory database reported `database disk image is malformed`; execution proceeded from task artifacts and source evidence. LSP diagnostics were unavailable because no TypeScript language server was found.

## Known Issues

The local GSD memory database is malformed. TypeScript LSP diagnostics are unavailable in this harness.

## Files Created/Modified

- `src/execution/types.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
