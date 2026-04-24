# M062/S02 — Research

**Date:** 2026-04-23

## Summary

S02 is targeted follow-on work on top of S01, not a new architecture problem. S01 already established the normalized constrained-review payload in `src/lib/review-first-pass.ts`; S02’s job is to make every visible surface describe that payload coherently for requirement `R064`. Right now the public bounded comment and the Review Details block both consume the same payload, but they still express different contracts: the summary line says "Bounded first-pass review" while Review Details says "Continuation state: pending follow-up review" and, on timeout, the handler can swap in `timeoutProgress` lines that bypass the first-pass wording entirely. That is the main drift seam.

The planner should treat this slice as a visible-contract consolidation pass centered on formatter/renderer boundaries, not handler control-flow redesign. The natural seam is: keep `normalizeReviewFirstPass()` as the single state source, then introduce one wording contract shared by `formatPartialReviewComment()` and `formatReviewDetailsSummary()` so both surfaces state covered scope, remaining scope, and continuation state the same way. Handler work should stay thin: pass the same structured state through all publication paths, including timeout partial publication, retry merge updates, and exhausted-`max_turns` fallback.

## Recommendation

Build around one reusable visible-state description layer in `src/lib/review-utils.ts` (or a neighboring formatter helper if extraction becomes clearer), and make both the bounded comment and Review Details consume it. Do **not** hand-roll a second coverage/state summary in `src/handlers/review.ts`; that would recreate the exact drift S02 is meant to remove.

Follow the existing S01 pattern: machine state first, visible rendering second. The safest sequence is (1) lock the wording contract with formatter tests, (2) wire Review Details and partial-comment rendering to that contract, then (3) update handler tests for the concrete publication paths. This matches the loaded `write-docs` skill guidance to write for a cold reader and the project rule to preserve one stable visible surface without implying exhaustiveness.

## Implementation Landscape

### Key Files

- `src/lib/review-first-pass.ts` — authoritative normalized first-pass payload. Already carries `coveredScope`, `remainingScope`, `publication`, `continuationPending`, and zero-evidence failure state. S02 should not change its semantics unless a visible-state gap forces a payload addition.
- `src/lib/review-utils.ts` — current rendering hub. `describeReviewFirstPass()` generates the bounded summary clause and Review Details bullets. `formatReviewDetailsSummary()` decides whether to render `timeoutProgress`, `reviewFirstPass`, or generic findings. This is the primary S02 seam.
- `src/lib/partial-review-formatter.ts` — builds the public bounded first-pass comment. Today it prints the top-line summary from `describeReviewFirstPass()` and then appends retry notes; likely needs wording updates once the coherent contract is defined.
- `src/handlers/review.ts` — publication/orchestration only. Key paths are:
  - timeout partial publication around `timeoutFirstPass` + `buildReviewDetailsBody()`
  - retry merge update around `mergedFirstPass`
  - exhausted-`max_turns` failure fallback around `failureFirstPass`
  - deterministic Review Details publication via `buildReviewDetailsBody()` and append/upsert helpers
- `src/lib/review-utils.test.ts` — best place to lock the visible-state contract at unit level. Already asserts bounded first-pass bullets and zero-evidence wording.
- `src/lib/partial-review-formatter.test.ts` — locks the public bounded comment line. Existing tests only cover coverage counts/retry notes, not a fuller continuation-state contract.
- `src/handlers/review.test.ts` — integration proof for GitHub-visible outcomes. Existing timeout and bounded-review tests already inspect the created partial comment and Review Details body.
- `scripts/verify-m062-s01.ts` — machine proof from S01. Useful as input/reference, but it does not yet verify visible wording drift; S03 should build on this after S02 defines the rendering contract.

### Natural Seams

1. **State normalization vs rendering**
   - Keep `normalizeReviewFirstPass()` authoritative.
   - Put all user-facing phrasing behind shared helpers.

2. **Shared wording vs surface-specific framing**
   - Shared content: covered scope, remaining scope, continuation state, bounded reason, zero-evidence failure.
   - Surface-specific content: blockquote/header style in `formatPartialReviewComment()` and details-list formatting in `formatReviewDetailsSummary()`.

3. **Handler publication paths**
   - Timeout, retry-merge, and `max_turns` fallback all already build a `ReviewFirstPassPayload`; they should only need small wiring updates once the render contract is unified.

### Build Order

1. **Define the coherent visible-state contract in formatter tests first.**
   Prove exactly how bounded-first-pass, remaining scope, and continuation state should read on both surfaces, including zero-evidence failure. This is the highest-value step because it freezes the product contract before touching handler flow.

2. **Refactor shared rendering in `src/lib/review-utils.ts`.**
   Either enrich `describeReviewFirstPass()` or extract a new helper that returns normalized visible-state lines/phrases for both the summary comment and Review Details. This unblocks all downstream wiring.

3. **Update `formatPartialReviewComment()` and `formatReviewDetailsSummary()`.**
   Make both surfaces consume the same contract. Pay special attention to the current `timeoutProgress` branch in `formatReviewDetailsSummary()` — it can bypass `reviewFirstPass` and therefore drift from the bounded comment. Planner should decide whether to remove that branch or make it explicitly compose the same first-pass wording plus retry-state detail.

4. **Touch `src/handlers/review.ts` only after render helpers are stable.**
   Ensure timeout publication, retry merge, deterministic Review Details publication, and exhausted-`max_turns` fallback all pass the right structured state and do not introduce ad hoc prose.

5. **Close with handler integration tests.**
   Verify one coherent comment contract across the actual publication paths, especially timeout partial publication and large-PR bounded publication.

### Verification Approach

- `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts`
  - unit proof that the shared wording contract is stable
- `bun test ./src/handlers/review.test.ts`
  - integration proof that timeout / bounded-review publication paths emit the expected visible text
- `bun run tsc --noEmit`
  - required compile gate; S01 restored this and downstream slices should keep it green
- Optional spot-check during execution: run only the bounded-review related handler tests by name if iteration speed matters, then finish with the full file

## Constraints

- The milestone decision is one stable public review identity that evolves in place; S02 must not introduce extra public-comment surfaces.
- Visible wording must stay truthful: sufficient-but-bounded, never exhaustive. Any phrasing that implies completion without remaining scope disclosure would violate `R064`.
- `src/handlers/review.ts` has multiple publication branches. If any branch keeps bespoke prose, the visible contract will drift again.
- `formatReviewDetailsSummary()` currently prefers `timeoutProgress` over `reviewFirstPass`; that precedence can hide the normalized first-pass wording unless intentionally reconciled.

## Common Pitfalls

- **Letting handler prose fork from formatter prose** — keep wording generation in formatter helpers, not inline string arrays in `src/handlers/review.ts`.
- **Treating timeout progress as a separate contract** — timeout-specific retry metadata is fine, but coverage/remaining/continuation truth should still come from the same first-pass state.
- **Overloading Review Details with operational noise** — S02 needs coherent state wording, not more telemetry bullets. Keep the product contract concise and let existing telemetry lines remain secondary.

## Open Risks

- The current summary comment and nested Review Details may still feel like two contracts even if wording is aligned, because one is a blockquote summary and the other is a diagnostics list. Execution should watch for duplicated or contradictory continuation language.
- Any change to `formatReviewDetailsSummary()` can affect unrelated existing details output (usage, prioritization, structural impact, contributor experience), so formatter tests should stay focused on preserving those sections while changing the first-pass portion only.
