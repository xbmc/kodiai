---
estimated_steps: 4
estimated_files: 6
skills_used:
  - test-driven-development
  - verify-before-complete
---

# T01: Add staged mention-context admission and finer prompt-section accounting

**Slice:** S02 — Mention Flow Context Diet
**Milestone:** M061

## Description

Implement the root-cause admission seam for mention context. The handler already classifies explicit review, issue-thread, write, and plan-only intent before building context; this task should turn that classification into a durable policy that keeps ordinary conversational mentions light while preserving the rich explicit-review path. The task also needs to split coarse mention-context metrics so downstream proof can attribute reductions to the right named sections instead of treating all context as one bucket.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| GitHub comment / PR context reads in `buildMentionContextDetails` | Fail open to a minimal prompt and log/telemetry-safe warning; do not block the mention reply. | Use the existing bounded context fallback and avoid retry loops inside prompt assembly. | Sanitize and drop malformed fields rather than widening context or crashing prompt construction. |
| Mention config parsing in `src/execution/config.ts` | Preserve current defaults so existing repos keep working. | N/A for local parsing. | Reject invalid knobs through schema validation instead of silently enabling richer context. |

## Load Profile

- **Shared resources**: GitHub API reads during context construction and prompt-section telemetry emission
- **Per-operation cost**: one bounded mention-context build plus prompt-section metric assembly
- **10x breakpoint**: unnecessary conversation/metadata admission increases prompt size and upstream API pressure before model execution even starts

## Negative Tests

- **Malformed inputs**: empty question text after mention stripping, missing PR body/title fields, and oversized comment bodies still produce deterministic bounded context.
- **Error paths**: context-builder failure still yields an empty/minimal mention context instead of aborting the whole mention reply.
- **Boundary conditions**: explicit review mentions stay rich, while ordinary conversational mentions omit sections that are no longer admitted by default.

## Steps

1. Add or extract a mention admission-policy helper in `src/handlers/mention.ts` that derives whether the current request should admit rich conversation history, PR metadata/review-thread material, and any new section labels.
2. Thread that policy into `src/execution/mention-context.ts` and `src/execution/config.ts`, keeping defaults conservative and splitting section metrics so proof can distinguish conversation history from other admitted mention context.
3. Update `src/execution/mention-prompt.ts` only as needed so prompt assembly and section naming stay aligned with the new mention-context output.
4. Expand `src/execution/mention-context.test.ts` and `src/execution/mention-prompt.test.ts` to pin the lighter default path, preserved explicit-review path, and the exact named section metrics emitted.

## Must-Haves

- [ ] Default conversational mentions build a lighter context by policy, not just by lower truncation caps.
- [ ] Explicit PR review mentions still receive the richer context required for `review.full` behavior.
- [ ] Mention-context section metrics are fine-grained enough for downstream proof to attribute reductions honestly.

## Verification

- Targeted tests: `bun test ./src/execution/mention-context.test.ts ./src/execution/mention-prompt.test.ts`
- Manual code review: confirm new section names and config knobs used in tests match the runtime implementation exactly.

## Observability Impact

- Signals added/changed: named prompt-section attribution for mention context becomes finer-grained than the current single `conversation-history` bucket.
- How a future agent inspects this: read the section names asserted in `src/execution/mention-context.test.ts` and compare them to runtime report output via `scripts/usage-report.ts`.
- Failure state exposed: over-admission or misnamed sections should fail deterministic tests instead of surfacing later as ambiguous token regressions.

## Inputs

- `src/handlers/mention.ts` — current request-shape classification and eager context build order
- `src/execution/mention-context.ts` — bounded mention context builder and current coarse section metric output
- `src/execution/mention-prompt.ts` — prompt assembly that consumes mention context
- `src/execution/config.ts` — mention config schema/default seam for any admission knobs
- `src/execution/mention-context.test.ts` — existing bounded-context coverage
- `src/execution/mention-prompt.test.ts` — existing mention prompt and prompt-section coverage

## Expected Output

- `src/handlers/mention.ts` — request-shape admission policy wired into mention context construction
- `src/execution/mention-context.ts` — lighter default context assembly plus finer section metrics
- `src/execution/mention-prompt.ts` — prompt assembly aligned with new mention-context sections if needed
- `src/execution/config.ts` — conservative schema/default updates if policy knobs are introduced
- `src/execution/mention-context.test.ts` — assertions for lighter default path and finer section metrics
- `src/execution/mention-prompt.test.ts` — assertions for admitted/omitted prompt sections on mention paths
