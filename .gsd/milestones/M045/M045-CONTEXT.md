# M045: Contributor Experience Product Contract and Architecture

**Gathered:** 2026-04-08
**Status:** Queued — pending auto-mode execution.

## Project Description

Define the long-term product contract for how contributor experience should influence Kodiai behavior, then reshape the architecture so that contract is coherent across all tier-related surfaces. This milestone is the implementation-oriented answer to issue #79: it should not just discuss tone theory, it should settle the product position and land the architectural changes needed to express that position cleanly.

## Why This Milestone

Current code mixes two different contributor taxonomies and threads them through multiple surfaces with different semantics. The fallback classifier in `src/lib/author-classifier.ts` emits `first-time / regular / core`, while the profile store in `src/contributor/types.ts` and `src/contributor/tier-calculator.ts` persists `newcomer / developing / established / senior`. Review prompt shaping in `src/execution/review-prompt.ts`, Review Details in `src/lib/review-utils.ts`, review-time source selection in `src/handlers/review.ts`, retrieval query shaping in `src/knowledge/retrieval-query.ts` and `src/knowledge/multi-query-retrieval.ts`, and Slack profile output in `src/slack/slash-command-handler.ts` all reflect parts of that model. Before calibration or rollout work makes sense, Kodiai needs one explicit answer to the question: what should contributor experience actually do, where should it be visible, and what architecture should own that truth?

## User-Visible Outcome

### When this milestone is complete, the user can:

- point to one explicit, shipped contributor-experience contract instead of reverse-engineering behavior from mixed prompt/output heuristics.
- see consistent contributor-experience behavior across all tier-related surfaces that remain in scope after the redesign.

### Entry point / environment

- Entry point: GitHub PR review surfaces, Slack `/kodiai profile`, and the internal contributor-model plumbing that feeds them.
- Environment: local dev plus production-like review behavior verification.
- Live dependencies involved: GitHub PR review flow, Slack slash-command profile flow, contributor profile store, retrieval query shaping.

## Completion Class

- Contract complete means: the target contributor-experience behavior is explicit in code and verification, not implied by old taxonomy names.
- Integration complete means: the chosen architecture is coherent across review prompt shaping, Review Details, retrieval-query hints, Slack profile output, and contributor-model storage.
- Operational complete means: the shipped surfaces no longer present contradictory contributor-experience semantics for the same user.

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- GitHub review behavior and Review Details reflect the chosen contributor-experience contract without mixing incompatible taxonomy semantics.
- Slack profile output and retrieval/query shaping remain consistent with the same contributor model, or are intentionally removed from that contract with explicit proof.
- the system no longer relies on an unexplained dual-taxonomy architecture to decide contributor-experience behavior.

## Risks and Unknowns

- The product answer may be to reduce or narrow contributor-experience adaptation rather than amplify it — the milestone must allow that outcome.
- Prompt tone, Review Details wording, retrieval query hints, and Slack profile output may need different degrees of change; forcing one uniform UX everywhere may be wrong.
- Removing or unifying taxonomy concepts can break caches, tests, or implicit assumptions in review flow code.

## Existing Codebase / Prior Art

- `src/lib/author-classifier.ts` — verified against current codebase state; low-fidelity fallback taxonomy (`first-time / regular / core`).
- `src/contributor/types.ts` and `src/contributor/tier-calculator.ts` — verified against current codebase state; stored contributor profiles use a separate four-tier model (`newcomer / developing / established / senior`) with percentile-based assignment.
- `src/handlers/review.ts` — verified against current codebase state; contributor profile tier is preferred over cache and fallback, and the resolved tier is threaded into prompt/output behavior.
- `src/execution/review-prompt.ts` — verified against current codebase state; `buildAuthorExperienceSection()` changes review instructions materially by tier.
- `src/lib/review-utils.ts` — verified against current codebase state; Review Details prints author tier plus a tone label.
- `src/knowledge/retrieval-query.ts` and `src/knowledge/multi-query-retrieval.ts` — verified against current codebase state; author tier is injected into retrieval query construction.
- `src/slack/slash-command-handler.ts` — verified against current codebase state; contributor tier is exposed directly on the Slack profile surface.

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R046 — this milestone defines and implements the contributor-experience contract across tier-related surfaces.

## Scope

### In Scope

- decide the intended product role of contributor experience across all tier-related surfaces.
- remove or unify contradictory taxonomy/architecture seams where the current dual model causes drift or reasoning complexity.
- update review prompt/output, Slack profile display, retrieval query shaping, and supporting contributor-model plumbing to match the chosen contract.
- add proof surfaces and tests that make the chosen behavior explicit.

### Out of Scope / Non-Goals

- recalibrating score weights, percentile bands, or sample fixtures beyond what is minimally needed to express the new architecture.
- broad repo-wide contributor sampling as the primary work product — that belongs to the calibration milestone.
- speculative redesign unrelated to contributor-experience behavior.

## Technical Constraints

- All tier-related surfaces are in scope, not GitHub review alone.
- `xbmc/xbmc` is the first truth set, but the architecture should not hardcode xbmc-only assumptions if they are avoidable.
- The milestone must tolerate the possibility that the right product answer is less contributor-experience adaptation, not more.

## Integration Points

- GitHub review prompt/output — contributor-experience tone and visibility.
- Slack profile surface — contributor profile visibility and semantics.
- Retrieval query shaping — author tier input to retrieval formulation.
- Contributor profile store / tier calculation — persistent source of truth.

## Open Questions

- Should contributor experience remain visible in Review Details, prompt shaping only, or both? — Current thinking: open until design work resolves the product contract, but it must be explicit.
- Should fallback taxonomy survive at all, or be replaced by a unified model contract? — Current thinking: likely unify or sharply constrain it.
- How much explanation-depth variation is desirable versus how much becomes patronizing or noisy? — Current thinking: this milestone must answer that in shipped behavior, not comments alone.
