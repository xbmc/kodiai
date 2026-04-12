# M048: PR Review Latency Reduction and Bounded Execution

**Gathered:** 2026-04-10
**Status:** Queued — pending auto-mode execution.

## Project Description

Reduce end-to-end PR review latency on the real `xbmc/kodiai` review path without sacrificing review truthfulness. The milestone should measure where review time is actually spent, reduce avoidable serial overhead, tune large-PR behavior more aggressively where that is honest, and explore parallel review-worker fan-out only if the cheaper plumbing wins are not enough.

## Why This Milestone

Recent live `@kodiai review` runs on `xbmc/kodiai` proved two separate latency problems: first, the ACA job timeout was lower than the computed review budget; then, after that was fixed, a real repo-backed review still hit the repo-config 600-second ceiling. The user wants reviews to end quicker and asked whether parts can be parallelized, but explicitly chose a **best-effort** latency target rather than a brittle hard guarantee that every review must finish within 10 minutes.

That makes this milestone about truthful speed, not fake completeness: reduce wall-clock latency where the system is slow by design or accident, make the time distribution visible to operators, and keep large-PR behavior explicit when the system still needs bounded scope or staged work.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Trigger a real Kodiai PR review on `xbmc/kodiai` and get materially faster feedback on the live path, with fewer timeout-class failures.
- Inspect a live review run and see where time was spent instead of guessing whether the delay came from workspace setup, retrieval, prompt/context assembly, or the remote agent execution itself.
- Run large or strict reviews with clearer bounded-behavior rules, rather than silently waiting through long single-review stalls.

### Entry point / environment

- Entry point: GitHub PR review flow (`pull_request.*` and explicit `@kodiai review`), plus operator verification surfaces and Azure log/telemetry inspection.
- Environment: production-like Azure Container Apps + GitHub webhook/review path.
- Live dependencies involved: GitHub webhooks/APIs, Azure Container Apps app + job, Azure Files workspace mount, Anthropic Claude Agent SDK, retrieval/knowledge subsystems.

## Completion Class

- Contract complete means: Kodiai has one explicit latency strategy that is still truthful under load — best-effort faster reviews, bounded large-PR behavior when needed, and no fake implication that every huge PR got a full exhaustive pass inside a fixed wall-clock budget.
- Integration complete means: the real review path from webhook/mention -> workspace prep -> retrieval/context assembly -> ACA job -> GitHub-visible outcome works with the optimized design on `xbmc/kodiai`.
- Operational complete means: operators can inspect per-phase review timing and explain slow runs without ad hoc log archaeology.

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- A live `xbmc/kodiai` PR review run completes materially faster than the current timeout-prone baseline on the same end-to-end path, with timing evidence broken down by major phase.
- Large-PR optimization behavior is explicit and truthful: if scope is reduced, staged, or fanned out, the GitHub-visible outcome and operator evidence must say so rather than implying exhaustive single-pass review when that did not happen.
- The optimization work does not regress review correctness/publish reliability on the real GitHub + ACA integration path.
- At least one live production-like review proof on `xbmc/kodiai` is required; synthetic tests alone are not enough for milestone completion.

## Risks and Unknowns

- **The dominant latency may be inside the remote agent’s own reasoning/tool loop, not in orchestration.** Plumbing wins alone may not buy enough time on large strict reviews.
- **Parallel shard-and-merge review is architecturally expensive.** It risks duplicate findings, conflicting severity/copy, and higher model cost if the merge contract is weak.
- **Large-PR behavior shifts trade depth for time.** More aggressive bounded scope or profile downgrades may be honest and useful, but they change product behavior and need explicit review-surface disclosure.
- **Current synchronize triggers are still effectively disabled by config shape.** Live proof and operator iteration may still need explicit `@kodiai review` requests until the trigger config is corrected.
- **The current 10-minute desire is not a hard guarantee.** Some PRs may still exceed that target unless the system adopts staged or partial-review behavior for worst cases.

## Existing Codebase / Prior Art

- `src/handlers/review.ts` — current review orchestration already does large-PR triage, retrieval context generation, review-profile selection, timeout estimation, optional scope reduction, single `executor.execute(...)`, and reduced-scope retry; verified against current codebase state.
- `src/execution/executor.ts` — review execution still dispatches exactly one ACA job per review execution and now stages a repo snapshot into the remote workspace before polling for completion; verified against current codebase state.
- `src/jobs/workspace.ts` — workspace creation currently clones a temp repo checkout and, for PR review flows, uses the base-clone + pull-ref-fetch strategy; verified against current codebase state.
- `src/jobs/aca-launcher.ts` — ACA polling currently uses one remote execution plus a 10-second poll interval and timeout-driven cancel path; verified against current codebase state.
- `src/knowledge/multi-query-retrieval.ts` and `src/knowledge/retrieval.ts` — retrieval variants already have internal concurrency and cross-corpus fan-in, so latency work should not assume retrieval is purely serial today; verified against current codebase state.
- `src/lib/timeout-estimator.ts` — current timeout control only covers dynamic timeout scaling, high-risk scope reduction, and reduced file count for high-risk reviews; verified against current codebase state.
- `src/lib/auto-profile.ts`, `src/lib/review-utils.ts`, and `src/execution/config.ts` — review depth is still strongly shaped by `strict` / `balanced` / `minimal` profiles, comment caps, and large-PR thresholds (`fileThreshold: 50`, `fullReviewCount: 30`, `abbreviatedCount: 20`); verified against current codebase state.
- `src/review-audit/log-analytics.ts` and existing ACA console logs — operator-grade Azure log querying infrastructure already exists and can be reused for latency-phase proof rather than invented from scratch; verified against current codebase state.

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- `R034` — Current active requirement already says review-context enhancements must not regress small-PR latency/cost. M048 extends that concern into a broader live review-latency optimization effort.
- `R043` / `R044` — Review latency work must preserve explicit mention review execution and publish reliability on the GitHub + ACA path.
- `R049` — New scope introduced by this milestone: best-effort PR review latency reduction with operator-visible phase timing and truthful bounded behavior on large PRs.

## Scope

### In Scope

- Measure and surface end-to-end review timing by major phase on the live `xbmc/kodiai` path.
- Reduce avoidable serial overhead in workspace prep, context assembly, retrieval orchestration, executor handoff, and related pre-agent steps.
- Re-evaluate large-PR behavior and profile/scope rules for latency-sensitive reviews, as long as any bounded behavior stays explicit and truthful.
- Explore parallel review-worker or shard-and-merge strategies if measurement shows plumbing wins alone are insufficient.
- Leave behind a repeatable live proof surface for latency improvements on the real GitHub/ACA review path.

### Out of Scope / Non-Goals

- A fake promise that every PR, regardless of size or profile, will always complete within 10 minutes.
- Broad product redesign of review semantics unrelated to latency.
- Replacing the existing review system with a different external review engine.
- Hiding reduced-scope or staged-review behavior behind normal-looking approval/comment output.

## Technical Constraints

- The milestone must preserve review truthfulness: reduced scope, staged work, or partial coverage must be surfaced explicitly.
- The current execution model is one ACA job per review; any parallelization must define how findings are merged, deduplicated, and published exactly once.
- The current review path already has some concurrency in retrieval, so planning must measure before assuming the biggest wins are there.
- Live proof depends on GitHub + Azure production-like infrastructure and cannot be reduced to unit tests alone.
- Existing publish/idempotency guarantees from M043 and audit/observability patterns from M044 must not be regressed.

## Integration Points

- **GitHub review/mention handlers** — latency changes will likely touch `src/handlers/review.ts` and `src/handlers/mention.ts` orchestration paths.
- **ACA job execution** — `src/execution/executor.ts` and `src/jobs/aca-launcher.ts` control the one-job review execution path and timeout enforcement.
- **Workspace preparation** — `src/jobs/workspace.ts` and Azure Files staging affect fixed overhead before the agent starts doing review work.
- **Knowledge retrieval** — `src/knowledge/retrieval.ts` and multi-query retrieval influence pre-agent context generation cost.
- **Operator evidence surfaces** — Azure Log Analytics and any execution/telemetry outputs must expose latency-phase timing clearly enough for live proof.

## Open Questions

- If plumbing improvements alone are insufficient, is shard-and-merge review worth the extra complexity and model cost? — Current thinking: measure first, then gate fan-out behind hard evidence that single-worker optimization cannot meet the best-effort target.
- What large-PR behavior changes are acceptable before users feel review quality has been watered down? — Current thinking: bounded or staged behavior is acceptable only if the surface says exactly what happened.
- Should the milestone also normalize the review-trigger config shape so synchronize-triggered reruns participate in latency proof loops? — Current thinking: likely yes if it is cheap, because explicit mention-only live proof slows operator iteration.
- What is the right latency proof baseline? — Current thinking: compare against the known timeout-prone `xbmc/kodiai` path and require per-phase timings so improvements are attributable rather than anecdotal.
