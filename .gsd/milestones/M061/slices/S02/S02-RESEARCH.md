# M061/S02 — Research

**Date:** 2026-04-23

## Summary

S02 is not starting from a blank mention flow. After S01, the mention path already persists text-free prompt-section telemetry through `prompt_section_events`, and the handler already records two prompt surfaces for conversational mentions: `mention.context` and `mention.user-prompt`. The expensive problem is now visible in code: `src/handlers/mention.ts` eagerly builds bounded mention context, issue-thread candidate code pointers, retrieval context, and pre-fetched PR diff context before the final prompt is dispatched, even though only a subset of conversational mentions actually need those sections.

The main optimization opportunity is admission control, not just tighter caps. The handler already classifies the trigger early (`explicitReviewRequest`, `isIssueThreadComment`, `isWriteRequest`, `isPlanOnly`) before the heavy context work starts. That means S02 can stage expensive sections behind request-shape gates rather than shrinking everything uniformly. The roadmap language matches the real hotspots: long thread history comes from `buildMentionContextDetails()`, candidate code pointers come from `buildIssueCodeContext()`, and PR diff bodies come from the `prDiffContext` prefetch in `src/handlers/mention.ts`.

The recommendation is to keep explicit review mentions (`taskType="review.full"`) on their current richer path and slim only the default conversational mention path (`taskType="mention.response"`). Use the new named section metrics from S01 to prove reductions section-by-section, not by eyeballing rendered prompts. That keeps the slice honest: it should reduce default prompt size while preserving truthful grounding and the explicit review publish flow.

## Recommendation

Take a staged-admission approach in `src/handlers/mention.ts` instead of a broad rewrite of prompt builders. The handler already knows enough, early enough, to decide whether the trigger is an explicit review request, an issue-thread Q&A, a PR conversation, a plan-only request, or a write request. Use that existing classification to decide which expensive context builders run at all.

Concretely, preserve the current rich path for explicit review mentions and add a lighter default path for ordinary conversational mentions. Conversation history should be admitted in tiers rather than always pulling the full current budget. Candidate code pointers should stay issue-thread-only and should be further gated to code-seeking questions instead of every issue mention. Pre-fetched PR diff context should remain available for explicit review intent, but default PR conversations should miss it unless the question clearly requires diff inspection. Retrieval should follow the same staged model; otherwise the token savings become partly cosmetic because retrieval still consumes the full built mention context as its `body` input in `buildRetrievalVariants()`.

The slice should treat S01 telemetry as the proof surface: compare `prompt_section_events` for `mention.response` before and after the change, especially `conversation-history`, `candidate-code-pointers`, and any PR-diff-bearing prompt sections. Avoid adding a second reporting path or a special-case measurement script. The existing usage and verification surfaces already know how to read the canonical Postgres truth.

## Implementation Landscape

### Key Files

- `src/handlers/mention.ts` — primary orchestration seam. It classifies mention intent early, then currently does heavy work eagerly: `buildMentionContextDetails()`, `buildIssueCodeContext()`, retrieval, and PR diff prefetch. This is the main place to introduce staged admission.
- `src/execution/mention-context.ts` — builds conversation history, PR metadata, inline review-thread context, and scale notes. Today it emits a single `conversation-history` section metric even though it contains several sub-pieces of context.
- `src/execution/mention-prompt.ts` — assembles the final mention prompt. It injects optional `mentionContext`, retrieval/unified knowledge, triage context, and `prDiffContext`. This is where staged sections become user-prompt size changes.
- `src/execution/issue-code-context.ts` — issue-thread-only code-pointer finder. It scans the workspace and can be expensive/noisy if run for every issue mention.
- `src/knowledge/multi-query-retrieval.ts` — retrieval variant builder. The `intent` variant uses `body`, currently fed from the fully built `mentionContext`, so staged context and retrieval-query shape need to stay aligned.
- `src/execution/config.ts` — existing mention conversation config only exposes `maxTurnsPerPr` and `contextBudgetChars`. If S02 needs policy knobs for staged loading, this is the schema/default seam.
- `src/execution/executor.ts` — preserves the distinction between conversational PR mentions and explicit review mentions. `taskType !== "review.full"` is already the reduced-tool conversational path and should remain the behavioral boundary.
- `src/telemetry/types.ts` / `src/telemetry/store.ts` — canonical prompt-section telemetry seam. S02 should consume these rather than inventing a slice-local metric path.
- `scripts/usage-report.ts` — canonical operator report for task-path, delivery, cache, and prompt-section breakdowns. This is the existing evidence surface for S02 reductions.
- `scripts/verify-m061-s01.ts` — baseline proof surface established by S01. S02 should add or reuse proof checks on top of this measurement model, not bypass it.
- `src/execution/mention-context.test.ts` — existing bounded-context coverage. Needs expansion for staged-admission behavior and possibly finer section accounting if the context builder starts emitting more than one section.
- `src/execution/mention-prompt.test.ts` — current prompt-shape tests. Good place to pin when optional sections are absent by default and present only when gated in.
- `src/handlers/mention.test.ts` — integration-oriented handler coverage for conversational mentions vs explicit review requests. The slice should prove the gating decisions here.

### Build Order

1. **Define the staged-admission policy first in the mention handler.** Decide which request shapes get: full conversation history, issue code pointers, retrieval context, and pre-fetched PR diff context. This is the root-cause step; changing caps before changing admission rules would keep the eager topology intact.
2. **Refine prompt-section accounting for the mention path second.** If `mention-context` remains a single `conversation-history` bucket, S02 will not be able to prove which subcomponent got smaller. Split or add section metrics only where needed to make the reduction attributable.
3. **Thread the lighter context into retrieval third.** Ensure retrieval query construction does not still depend on the pre-diet full mention context. Otherwise prompt-size reductions and retrieval-compute reductions diverge.
4. **Update tests and proof/report surfaces last.** Once the gating policy is stable, lock it down in mention handler tests, context/prompt tests, and the M061 verification surface using the S01 telemetry/reporting baseline.

### Verification Approach

- Run targeted tests around the mention flow seams:
  - `bun test ./src/execution/mention-context.test.ts`
  - `bun test ./src/execution/mention-prompt.test.ts`
  - `bun test ./src/handlers/mention.test.ts`
- Run the reporting/proof surfaces that S01 established so the slice proves real reduction on canonical telemetry paths:
  - `bun test ./scripts/usage-report.test.ts ./scripts/verify-m061-s01.test.ts`
- Add or update assertions that prove:
  - ordinary `mention.response` executions omit or reduce heavy sections by default;
  - explicit `review.full` mention requests still receive the richer context needed for inspection and publish behavior;
  - issue-thread candidate code pointers only appear on request shapes that truly benefit from them;
  - retrieval queries no longer depend on eagerly built long-form mention context when the staged path chooses a lighter context;
  - prompt-section telemetry shows lower estimated tokens for conversational mention paths by named section, not just lower total prompt text.
- Operator proof after implementation should use the canonical report path, e.g. `bun run scripts/usage-report.ts --repo <repo> --since <window>` against live Postgres, and compare `mention.response` prompt-section rows before/after the slice.

## Constraints

- `src/handlers/mention.ts` currently builds heavy context after intent classification but before prompt dispatch. This is good for staging, but it also means S02 must be careful not to disturb explicit review mention behavior that shares the same handler.
- `src/execution/mention-context.ts` currently emits a single `conversation-history` metric block for the full assembled context text, even when that text includes PR metadata and review-thread material. Proof quality may require finer section boundaries.
- `buildRetrievalVariants()` truncates `body` to 200 chars, but that `body` still comes from the fully built mention context. Staging context only at final prompt injection is not enough if retrieval still consumes the richer pre-diet context.
- Conversational PR mentions already use a reduced tool surface in `src/execution/executor.ts`, while explicit review mentions intentionally inherit the full review tool surface. S02 should preserve that behavioral split.

## Common Pitfalls

- **Shrinking caps without changing admission** — lowering character budgets alone leaves the handler doing the same eager work and only trims the symptom.
- **Breaking explicit review mentions while optimizing conversation** — `@kodiai review` runs through the mention handler but must preserve `taskType="review.full"`, richer context, and approval/publish eligibility.
- **Proving reductions with prompt text snapshots** — S01 already established named prompt-section telemetry; S02 should use that canonical seam instead of brittle text diffs.
- **Optimizing prompt size but not retrieval inputs** — if retrieval still sees the pre-diet `mentionContext`, the slice will under-deliver on real compute/token savings.

## Open Risks

- The current `conversation-history` metric shape may be too coarse to distinguish thread-history savings from PR metadata or review-thread savings, which could force a small telemetry-shape refinement inside S02.
- Staging PR diff context too aggressively could regress grounded answers on conversational PR mentions that genuinely need diff inspection, even if they are not explicit `@kodiai review` requests.
- Candidate code-pointer gating for issue mentions may need a conservative heuristic at first; over-filtering could reduce usefulness on legitimate “where does this live?” questions.
