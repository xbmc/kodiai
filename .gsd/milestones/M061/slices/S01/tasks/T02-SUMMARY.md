---
id: T02
parent: S01
milestone: M061
key_files:
  - src/execution/prompt-section-metrics.ts
  - src/execution/mention-context.ts
  - src/execution/mention-prompt.ts
  - src/execution/review-prompt.ts
  - src/execution/executor.ts
  - src/execution/agent-entrypoint.ts
  - src/handlers/mention.ts
  - src/handlers/review.ts
  - src/execution/mention-context.test.ts
  - src/execution/mention-prompt.test.ts
  - src/execution/review-prompt.test.ts
key_decisions:
  - Represent prompt accounting as deterministic PromptSectionRecord metadata returned from prompt-building seams rather than parsing prompt text after the fact.
  - Propagate prompt-section metadata through executor workspace config and result.json for Agent SDK runs so handlers can persist the same records they built locally.
duration: 
verification_result: passed
completed_at: 2026-04-24T00:39:46.919Z
blocker_discovered: false
---

# T02: Instrumented mention and review prompt builders with named section metrics and threaded prompt-section telemetry through executor/runtime paths.

**Instrumented mention and review prompt builders with named section metrics and threaded prompt-section telemetry through executor/runtime paths.**

## What Happened

I added a shared text-free prompt accounting helper at `src/execution/prompt-section-metrics.ts` and used it to expose explicit prompt-section metrics from the real mention and review construction seams instead of inferring sizes later. `src/execution/mention-context.ts` now has a detailed builder that emits named sections for bounded conversational context, while `src/execution/mention-prompt.ts` and `src/execution/review-prompt.ts` now expose detail builders that return both the prompt text and ordered section metrics without changing the existing string-returning APIs used elsewhere.

I updated the mention and review handlers to consume those detailed builders and assemble durable `PromptSectionRecord` payloads for the actual execution paths. Mention executions now persist separate records for conversational context and the composed mention prompt; issue-thread code pointers are accounted as their own named section when present. Review executions now capture the main review prompt metrics for both the normal path and the timeout-retry path.

To thread those metrics through the remote execution/runtime boundary, I updated `src/execution/executor.ts` to include prompt-section metadata in `agent-config.json`, `src/execution/agent-entrypoint.ts` to carry the metadata back in `result.json`, and both handlers to persist the returned-or-local prompt-section records via `telemetryStore.recordPromptSections()` with fail-open logging. This keeps the accounting deterministic and text-free for Agent SDK review/mention runs instead of relying only on local `generateWithFallback()` flows.

## Verification

Ran the task’s required test command and the prompt builder suites all passed with the new section-metrics assertions. Then ran ESLint over the touched execution and handler files to catch runtime-threading mistakes outside the narrow test entrypoints; that pass completed cleanly. LSP diagnostics were unavailable in this environment because no language server was running, so linting served as the structural check for the touched TypeScript runtime files.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts` | 0 | ✅ pass | 120ms |
| 2 | `bun x eslint src/execution/mention-context.ts src/execution/mention-prompt.ts src/execution/review-prompt.ts src/execution/prompt-section-metrics.ts src/execution/executor.ts src/execution/agent-entrypoint.ts src/handlers/mention.ts src/handlers/review.ts` | 0 | ✅ pass | 828ms |

## Deviations

Added a small shared helper file, `src/execution/prompt-section-metrics.ts`, to keep token-estimation and section-record construction deterministic across mention and review builders. This was a local implementation refinement; the behavior stayed within the task contract.

## Known Issues

`capture_thought` failed when attempting to save a reusable prompt-telemetry pattern, so no durable memory entry was recorded from this task. LSP diagnostics were unavailable because no language server was active in this workspace.

## Files Created/Modified

- `src/execution/prompt-section-metrics.ts`
- `src/execution/mention-context.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/review-prompt.ts`
- `src/execution/executor.ts`
- `src/execution/agent-entrypoint.ts`
- `src/handlers/mention.ts`
- `src/handlers/review.ts`
- `src/execution/mention-context.test.ts`
- `src/execution/mention-prompt.test.ts`
- `src/execution/review-prompt.test.ts`
