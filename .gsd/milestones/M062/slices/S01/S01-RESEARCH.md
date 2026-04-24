# M062/S01 — Research

**Date:** 2026-04-23

## Summary

S01 is not a greenfield feature. The codebase already has three partial ingredients of the desired contract: (1) bounded-review disclosure shaping in `src/lib/review-boundedness.ts`, (2) timeout checkpoint preservation plus partial-review publication in `src/handlers/review.ts` / `src/execution/mcp/checkpoint-server.ts`, and (3) one stable publication identity via `reviewOutputKey` in `src/handlers/review-idempotency.ts`. The gap is that these pieces do not currently converge on one normalized first-pass state. Large-PR timeout paths can publish a partial review, but the hard failure branch for `max_turns` in `src/handlers/review.ts` still posts a dead-end fallback comment, which is exactly the user-visible failure mode R061 is trying to retire.

The clean seam is to promote “bounded first pass” from scattered formatting logic into an explicit state object produced before publication. Today `ReviewBoundednessContract` only captures requested/effective profile plus large-PR/timeout disclosure. It does not model covered scope, remaining scope, bounded reason, or whether deeper review is still pending. The planner should treat S01 as a contract-extraction slice: define a normalized bounded first-pass payload in lib code, map both timeout and `max_turns`/publishless failure paths into it, then publish from that shared contract. Keep `reviewOutputKey` as the public identity seam; do not add another public comment surface.

## Recommendation

Extend the existing boundedness seam rather than inventing a parallel “partial review” subsystem. The least risky path is:

1. keep `resolveReviewBoundedness(...)` as the source for requested/effective/large-PR truth,
2. add a second normalized first-pass state projection that combines boundedness + execution outcome + checkpoint evidence,
3. make the handler publish from that state for constrained runs instead of branching into special-case timeout text vs dead-end `max_turns` text.

Why this path: it preserves current truthful inputs that already exist in the handler, keeps contract logic testable outside GitHub I/O, and sets up S02 to render one coherent visible surface from a stable payload instead of from multiple ad hoc strings. It also matches project rules already loaded in context: root-cause-first means removing the dead-end failure mode itself, not just tweaking wording, and evidence-before-claims means the contract must be mechanically derivable from checkpoint/progress inputs rather than inferred from prose.

## Implementation Landscape

### Key Files

- `src/handlers/review.ts` — primary orchestration seam. It computes `reviewBoundedness`, threads it into the prompt and Review Details, publishes timeout partial reviews from checkpoint evidence, and still has the old dead-end `max_turns` fallback at the `result.conclusion === "failure" && !result.published` branch (~5345).
- `src/lib/review-boundedness.ts` — current bounded-review contract. Good base for requested/effective profile truth and exact disclosure sentence, but currently lacks first-pass state fields like covered scope, remaining scope, bounded reason, and continuation-pending state.
- `src/lib/partial-review-formatter.ts` — current timeout-only visible partial wording. This is the clearest candidate to either absorb a richer normalized state input or be replaced by a more general bounded-first-pass formatter.
- `src/lib/review-utils.ts` — Review Details formatter. Already exposes truthful ingredients (`timeoutProgress`, bounded large-PR counts, retry state, reviewed/not-reviewed counts), but today it renders from multiple independent inputs rather than one normalized first-pass payload.
- `src/execution/review-prompt.ts` — prompt contract seam. It already injects one exact bounded-review disclosure sentence into `## What Changed` and instructs the model to call `save_review_checkpoint` every 3–5 files when checkpointing is enabled.
- `src/execution/mcp/checkpoint-server.ts` — checkpoint tool contract. Saves `filesReviewed`, `findingCount`, `summaryDraft`, and `totalFiles`; these fields are sufficient to seed truthful covered-scope accounting.
- `src/knowledge/types.ts` / `src/knowledge/store.ts` — durable checkpoint shape (`CheckpointRecord`) and persistence. Important because S01’s truthful first-pass contract should derive from persisted evidence, not from best-effort prose.
- `src/handlers/review-idempotency.ts` — stable `reviewOutputKey` and marker parsing. This is the identity seam that lets S01/S02 keep one public review surface instead of introducing new comments.
- `src/lib/errors.ts` — current error taxonomy still treats timeout vs timeout_partial as error categories. Useful context, but S01 should avoid routing bounded first-pass output through the same user-visible dead-end error semantics.
- `scripts/verify-m048-s01.ts` and `scripts/verify-m048-s02.ts` — prior-art verifier pattern. They classify outcome classes from truthful evidence (`success` / `timeout` / `timeout_partial` / `failure`) and are the best template for M062’s deterministic proof surface.

### Natural Seams

1. **Contract shaping seam** — lib-level pure function(s) that take execution outcome + boundedness + checkpoint evidence and return a normalized bounded first-pass state.
2. **Publication seam** — `src/handlers/review.ts` branches that currently emit timeout partial comments or `max_turns` failure comments.
3. **Rendering seam** — visible summary/partial wording in `src/lib/partial-review-formatter.ts` and Review Details output in `src/lib/review-utils.ts`.
4. **Verifier seam** — new M062 script(s) should classify old dead-end vs bounded-first-pass outcome using the same evidence-first pattern as M048 verifiers.

### Build Order

1. **Define the normalized first-pass contract first.** This is the highest-risk ambiguity and unblocks everything else. Without a shared payload, the handler will keep drifting between timeout, large-PR, and `max_turns` branches.
2. **Map current constrained outcomes into that contract in `src/handlers/review.ts`.** The critical proof is retiring the publishless `max_turns` dead-end path in favor of bounded first-pass output when truthful evidence exists.
3. **Only then update rendering surfaces.** Once the state shape is stable, S02 can refine the visible wording without changing semantics. For S01, render just enough to make the bounded-first-pass contract truthful and non-dead-end.
4. **Add deterministic proof last, using the M048 verifier pattern.** The verifier should codify “old dead-end path versus new bounded-first-pass contract” so later continuation work has a stable baseline.

### Verification Approach

- Unit tests around the contract seam:
  - `src/lib/review-boundedness.test.ts`
  - likely new tests beside `src/lib/partial-review-formatter.test.ts` or a new first-pass contract module
- Handler regression tests in `src/handlers/review.test.ts` for:
  - large PR bounded publication with one exact disclosure sentence,
  - timeout publication using checkpoint-backed coverage,
  - retiring the `max_turns` dead-end fallback in favor of bounded first-pass output,
  - preserving `reviewOutputKey`/single-surface publication behavior.
- Review Details checks in `src/lib/review-utils.test.ts` to prove covered/remaining scope fields stay truthful.
- Deterministic verifier patterned after `scripts/verify-m048-s01.ts`; likely a new `scripts/verify-m062-s01.ts` that classifies “dead-end failure” vs “bounded first-pass published” from machine evidence.
- Expected local command set:
  - `bun test src/lib/review-boundedness.test.ts src/lib/partial-review-formatter.test.ts src/lib/review-utils.test.ts src/handlers/review.test.ts`
  - plus the new M062 verifier once added.

## Constraints

- `reviewOutputKey` is already the stable public identity seam; S01 should preserve it rather than introducing multi-comment public continuation behavior.
- `src/execution/mcp/comment-server.ts` enforces strict summary structure (`## What Changed`, `## Observations`, `## Verdict`, canonical ordering). Any bounded-first-pass summary wording must fit that validator.
- Prompt-side bounded disclosure in `src/execution/review-prompt.ts` is standard-mode only and expects one exact sentence in `## What Changed`; do not create a second independent disclosure mechanism with different truth semantics.
- Checkpoint truth is file-list/count based (`filesReviewed`, `findingCount`, `totalFiles`), not exhaustive semantic coverage. S01 should report covered scope truthfully at that granularity instead of implying full review completeness.

## Common Pitfalls

- **Keeping timeout and `max_turns` as separate visible contracts** — that preserves the current dead-end path. Both need to project into the same bounded first-pass state, even if their internal causes differ.
- **Recomputing truth from summary prose** — avoid deriving covered/remaining scope from strings. The checkpoint store and triage counts already provide structured inputs.
- **Adding a second public surface for constrained runs** — violates the stable-identity direction already established by M062 decisions and `reviewOutputKey` plumbing.
- **Letting Review Details and summary diverge** — `src/lib/review-utils.ts` and summary publication must consume the same normalized state or S02 will inherit inconsistent semantics.

## Open Risks

- The current checkpoint tool only records fully reviewed file paths and finding totals. If the desired “remaining scope” needs file lists rather than counts, S01 may need to define a conservative representation (counts first, file lists optional) to avoid overclaiming.
- The current publishless `max_turns` branch may fire in cases with zero truthful evidence. The contract should distinguish “bounded first pass with explicit covered scope” from “run failed before any useful review evidence existed” instead of forcing a false partial-review claim.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| GitHub review/comment publication surfaces | `github-bot` | available |
| Agent-facing failure-state telemetry / verifier evidence | `observability` | available |

## Sources

- Existing bounded-review contract and exact disclosure sentence come from `src/lib/review-boundedness.ts` and are already enforced in handler tests for one-sentence insertion.
- Timeout partial publication, checkpoint hydration, retry-state wording, and the still-live `max_turns` dead-end fallback all live in `src/handlers/review.ts`.
- Summary structure constraints come from `src/execution/mcp/comment-server.ts`.
- Prior deterministic proof shape comes from `scripts/verify-m048-s01.ts` / `scripts/verify-m048-s02.ts`.
