---
estimated_steps: 4
estimated_files: 5
skills_used:
  - test-driven-development
  - verify-before-complete
---

# T02: Gate candidate code pointers, PR diff prefetch, and retrieval inputs off the same policy

**Slice:** S02 — Mention Flow Context Diet
**Milestone:** M061

## Description

Close the expensive secondary paths so the context diet is real instead of cosmetic. Today the handler still eagerly builds issue code pointers, retrieval variants from rich mention context, and PR diff prefetch for many mention shapes. This task should make those paths consume the same admission policy introduced in T01, preserving the rich `review.full` path while ensuring ordinary `mention.response` execution only pays for heavy context when the request shape clearly needs it.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `buildIssueCodeContext()` workspace scan | Fail open without code pointers and continue the mention reply. | Bound the scan as today and skip code pointers rather than blocking prompt assembly. | Ignore malformed pointer candidates and omit the section instead of emitting misleading code pointers. |
| Retrieval execution / variant construction | Keep mention execution running without retrieval context, preserving existing fail-open behavior. | Skip retrieval context for the current mention rather than retrying inside the handler. | Drop malformed retrieval results and keep only valid merged findings. |
| Git diff prefetch for PR context | Continue without prefetched diff and let the model/tooling fall back to file reads. | Skip diff prefetch for the current run and log the failure path. | Omit malformed diff/stat data rather than injecting broken prompt sections. |

## Load Profile

- **Shared resources**: workspace filesystem scans, git diff calls, retriever concurrency, and telemetry writes
- **Per-operation cost**: optional issue-code scan, optional PR diff prefetch, and up to three retrieval variants
- **10x breakpoint**: repeated eager scans/diff reads on normal conversational mentions drive prompt and compute cost before any model turn happens

## Negative Tests

- **Malformed inputs**: conversational questions that mention a filename casually should not automatically trigger the full rich path unless the heuristic explicitly classifies them as code-seeking/diff-seeking.
- **Error paths**: retrieval partial failures, code-pointer scan failures, and diff prefetch failures remain fail-open and still produce a mention reply.
- **Boundary conditions**: explicit review mentions keep `review.full`; ordinary mention replies stay `mention.response` and omit heavy sections unless the request shape needs them.

## Steps

1. Reuse the T01 admission policy in `src/handlers/mention.ts` to decide when issue code pointers, PR diff prefetch, and retrieval-body construction are allowed to run.
2. Adjust retrieval variant inputs in `src/knowledge/multi-query-retrieval.ts` or at the call site so the light conversational path uses a staged summary/body rather than the fully built rich mention context.
3. Keep explicit-review mention behavior unchanged, including `review.full` task typing and publish/read-only boundaries.
4. Expand `src/handlers/mention.test.ts` with integration-oriented coverage for the reduced conversational path, preserved explicit-review path, and fail-open heavy-context failures.

## Must-Haves

- [ ] Candidate code pointers are no longer built for every issue mention by default.
- [ ] PR diff prefetch only runs for explicit review or clearly diff-inspection-shaped requests.
- [ ] Retrieval inputs follow the same staged policy as the prompt so token savings are not merely cosmetic.

## Verification

- Targeted integration tests: `bun test ./src/handlers/mention.test.ts`
- Manual code review: confirm the same admission-policy seam drives context, retrieval, and diff/code-pointer gating instead of duplicating divergent heuristics.

## Observability Impact

- Signals added/changed: handler-level prompt-section telemetry and completion logs should now reflect when heavy sections are omitted on conversational mention paths.
- How a future agent inspects this: exercise the guarded paths in `src/handlers/mention.test.ts` and compare task-type / prompt-section assertions with `scripts/usage-report.ts` output.
- Failure state exposed: regressions where the light path still builds rich context should fail handler tests or show unexpected prompt sections in the report surface.

## Inputs

- `src/handlers/mention.ts` — eager issue-code, retrieval, and PR diff branches
- `src/execution/issue-code-context.ts` — code-pointer scan behavior and current thresholds
- `src/knowledge/multi-query-retrieval.ts` — retrieval variant builder and body truncation behavior
- `src/handlers/mention.test.ts` — integration-oriented mention handler coverage
- `src/execution/mention-context.ts` — staged mention-context outputs consumed by the handler

## Expected Output

- `src/handlers/mention.ts` — shared gating policy applied to code pointers, retrieval inputs, and PR diff prefetch
- `src/knowledge/multi-query-retrieval.ts` — retrieval variants aligned with the staged light/rich policy if a helper seam is needed
- `src/handlers/mention.test.ts` — regression coverage for lighter `mention.response` and preserved rich `review.full` behavior
