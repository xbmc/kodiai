# S02: Mention Flow Context Diet

**Goal:** Reduce default conversational mention prompt cost by staging heavy context only for request shapes that need it, while preserving the existing rich explicit-review mention path and operator-visible prompt-section proof.
**Demo:** standard conversational mentions answer with smaller default prompts because long thread history, candidate code pointers, and PR diff bodies are staged in only when the request shape truly needs them.

## Must-Haves

- Ordinary `mention.response` executions no longer eagerly include full long-form conversation history, candidate code pointers, and PR diff bodies by default; those sections are admitted only when the request shape needs them.
- Explicit PR review mentions continue to run as `review.full` with the richer prompt/context needed for inspection and publish behavior.
- Retrieval query construction follows the staged mention-context policy so prompt-size reductions also reduce derived retrieval inputs instead of only trimming final prompt text.
- Named prompt-section telemetry and proof/report surfaces can show the reduction on conversational mention paths without introducing a second measurement system.

## Proof Level

- This slice proves: This slice proves: integration
- Real runtime required: no
- Human/UAT required: no

## Integration Closure

- Upstream surfaces consumed: `src/handlers/mention.ts`, `src/execution/mention-context.ts`, `src/execution/mention-prompt.ts`, `src/execution/issue-code-context.ts`, `src/knowledge/multi-query-retrieval.ts`, and the S01 prompt-section telemetry/reporting seams.
- New wiring introduced in this slice: request-shape admission policy in the mention handler, finer mention-context/prompt section accounting, retrieval-input staging, and a slice proof script/report assertion path for `mention.response` reductions.
- What remains before the milestone is truly usable end-to-end: S03 must compact review prompts, S04 must reuse retrieval/cached derived context safely, and S05 must prove integrated token reduction across representative flows.

## Verification

- Runtime signals: named prompt-section rows for `mention.context` / `mention.user-prompt` continue to be the canonical evidence surface, with finer attribution for admitted conversation history, candidate code pointers, and PR diff sections.
- Inspection surfaces: `prompt_section_events`, `scripts/usage-report.ts`, and a new `scripts/verify-m061-s02.ts` proof command should make conversational-vs-explicit-review differences inspectable.
- Failure visibility: mention-path tests and proof scripts should make over-admission, missing rich review context, and retrieval-policy drift fail loudly.
- Redaction constraints: continue text-free prompt accounting only; no raw prompt text is persisted in telemetry.

## Tasks

- [x] **T01: Add staged mention-context admission and finer prompt-section accounting** `est:90m`
  Implement the core mention-flow diet where the default conversational path stays light and only admits heavier context when the request shape warrants it. Start in `src/handlers/mention.ts` by extracting or introducing an explicit admission-policy seam based on the already-classified request shape (`explicitReviewRequest`, PR vs issue surface, write/plan intent, and code-seeking signals). Thread that policy into `src/execution/mention-context.ts` so the builder can produce a bounded lighter default context and emit section metrics that separate conversation-history from any PR/review-thread metadata that remains admitted. Keep the explicit review path rich and unchanged in behavior. Update prompt-builder coverage so prompt-section expectations stay explicit and named. Executors should load `test-driven-development` before coding and `verify-before-complete` before claiming the task done.
  - Files: `src/handlers/mention.ts`, `src/execution/mention-context.ts`, `src/execution/mention-prompt.ts`, `src/execution/config.ts`, `src/execution/mention-context.test.ts`, `src/execution/mention-prompt.test.ts`
  - Verify: bun test ./src/execution/mention-context.test.ts ./src/execution/mention-prompt.test.ts

- [x] **T02: Gate candidate code pointers, PR diff prefetch, and retrieval inputs off the same policy** `est:90m`
  Close the expensive secondary paths so the context diet is real instead of cosmetic. In `src/handlers/mention.ts`, only build issue-thread code pointers when the issue question looks code-seeking, only prefetch PR diff context for explicit review or clearly diff-inspection requests, and ensure retrieval query construction no longer consumes a fully built rich mention context on the light conversational path. If needed, add a small helper seam near `src/knowledge/multi-query-retrieval.ts` or the mention handler so retrieval variants consume the staged summary/body intended for the chosen path. Prove the preserved `review.full` boundary and the reduced `mention.response` boundary with integration-oriented handler tests. Executors should load `test-driven-development` before coding and `verify-before-complete` before closing the task.
  - Files: `src/handlers/mention.ts`, `src/execution/issue-code-context.ts`, `src/knowledge/multi-query-retrieval.ts`, `src/handlers/mention.test.ts`
  - Verify: bun test ./src/handlers/mention.test.ts

- [x] **T03: Publish a slice proof that measures conversational mention reduction on the canonical telemetry path** `est:60m`
  Turn the new gating behavior into durable operator evidence instead of snapshot assertions. Extend the current S01 evidence surfaces by adding or updating report/proof helpers so operators can inspect reduced `mention.response` prompt sections by name while still seeing the richer explicit-review path. Add a dedicated `scripts/verify-m061-s02.ts` proof command (and tests) that exercises the canonical report/query layer, proves the presence/shape of the staged mention sections, and stays fail-open when Postgres is unavailable. Keep the proof aligned with S01’s `prompt_section_events` pattern instead of inventing a slice-local metric source. Executors should load `write-docs` only if runbook/help text needs an update, plus `verify-before-complete` before completion.
  - Files: `scripts/usage-report.ts`, `scripts/usage-report.test.ts`, `scripts/verify-m061-s01.ts`, `scripts/verify-m061-s01.test.ts`, `scripts/verify-m061-s02.ts`, `scripts/verify-m061-s02.test.ts`
  - Verify: bun test ./scripts/usage-report.test.ts ./scripts/verify-m061-s01.test.ts ./scripts/verify-m061-s02.test.ts

## Files Likely Touched

- src/handlers/mention.ts
- src/execution/mention-context.ts
- src/execution/mention-prompt.ts
- src/execution/config.ts
- src/execution/mention-context.test.ts
- src/execution/mention-prompt.test.ts
- src/execution/issue-code-context.ts
- src/knowledge/multi-query-retrieval.ts
- src/handlers/mention.test.ts
- scripts/usage-report.ts
- scripts/usage-report.test.ts
- scripts/verify-m061-s01.ts
- scripts/verify-m061-s01.test.ts
- scripts/verify-m061-s02.ts
- scripts/verify-m061-s02.test.ts
