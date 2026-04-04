# M039: Review Output Hardening — Intent Parsing + Claude Usage Visibility

**Gathered:** 2026-04-04
**Status:** Queued — pending auto-mode execution

## Project Description

Kodiai already ships two user-visible review-output surfaces that are supposed to be trustworthy: the `Keyword parsing` section in Review Details, and the Claude usage line added in M034. A live xbmc PR exposed regressions in both surfaces:

1. **Keyword parsing false positive** — Review Details showed `breaking change in body` for a PR where the signal appears to come from template/checklist boilerplate rather than author intent.
2. **Claude usage line missing** — Review Details did not show weekly Claude usage information even though M034 previously added that capability.

This milestone hardens both surfaces so Review Details reflects real signals truthfully, not stale or overly-permissive heuristics.

## Why This Milestone

This is already-shipped behavior regressing in production. It should execute before the queued capability-expansion milestones (M036–M038) because those depend on trusting the review output surface. The existing code confirms the two weak points:

- `src/lib/pr-intent-parser.ts` still treats plain PR body prose containing `breaking change` as a signal after only limited template stripping.
- `src/lib/review-utils.ts` only renders the Claude usage line when `usageLimit.utilization` is present.
- `src/execution/agent-entrypoint.ts` only persists `usageLimit` if the SDK emits a `rate_limit_event`, so the display contract is too optimistic unless the fallback behavior is made explicit and truthful.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Trust that `Keyword parsing` only reports breaking-change intent from real title/body/commit signals, not leaked PR-template boilerplate
- See Claude weekly limit information in Review Details as **percent left** when the SDK provides rate-limit data, with truthful fallback behavior when the SDK does not

### Entry point / environment

- Entry point: GitHub PR review flow (`src/handlers/review.ts` → Review Details publication)
- Environment: production
- Live dependencies involved: GitHub webhook review flow, Claude Agent SDK result payloads

## Completion Class

- Contract complete means: parser/body-stripping rules are tightened, Review Details usage rendering changes from percent-used to percent-left, and deterministic regression tests are updated to the new contract
- Integration complete means: a real-world xbmc-style PR fixture no longer emits a false `breaking change in body` signal, and Review Details shows the Claude usage line whenever rate-limit data is available from execution results
- Operational complete means: when the SDK genuinely omits rate-limit data, Review Details degrades truthfully rather than inventing usage numbers; logs/fixtures make that absence diagnosable

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- A regression fixture based on the xbmc PR body/output does **not** render `breaking change in body` in Review Details unless a real author-authored breaking-change signal remains after template stripping
- Review Details renders Claude weekly **percent left** and reset timing when execution results include rate-limit data
- When execution results lack rate-limit data, Review Details follows a truthful fallback contract (omit the usage line or render an explicit unavailable state) rather than silently pretending usage was captured

## Risks and Unknowns

- **PR template stripping is repo-specific** — different repos encode “types of change” and checklists differently, so the parser fix must be broad enough to catch common boilerplate without suppressing genuine body prose
- **SDK signal availability is outside Kodiai’s full control** — if the Claude SDK does not emit a `rate_limit_event` for a run, Kodiai cannot fabricate weekly usage; the milestone must define a truthful fallback contract instead of assuming the signal always exists
- **Contract change vs regression fix** — changing from percent-used to percent-left alters existing M034 wording and tests, so the milestone must deliberately update the contract and proof rather than “just restore old behavior”

## Existing Codebase / Prior Art

- `src/lib/pr-intent-parser.ts` — verified current breaking-change detection path: strips code blocks and limited template boilerplate, still treats plain body prose as a signal
- `src/lib/pr-intent-parser.test.ts` — verified current tests explicitly expect plain body prose to count as breaking-change intent; these tests must be revised carefully, not removed blindly
- `src/lib/review-utils.ts` — verified `formatReviewDetailsSummary()` only prints the Claude usage line when `usageLimit.utilization !== undefined`
- `src/lib/review-utils.test.ts` — verified current contract expects `75% of seven_day limit`; this milestone changes the display contract to percent-left
- `src/execution/agent-entrypoint.ts` — verified `usageLimit` is only persisted when a `rate_limit_event` is seen during streaming
- `src/execution/types.ts` — verified the execution result surface only carries `utilization`, `rateLimitType`, and `resetsAt` today
- `src/handlers/review.ts` — verified Review Details publication path passes `result.usageLimit` into `formatReviewDetailsSummary()` and carries `parsedIntent` into the output surface
- `src/handlers/review.test.ts` — verified existing wiring tests cover Review Details usage rendering and will need updated expectations for the new contract

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- New scope — this milestone introduces a correctness contract for truthful review-output intent parsing and Claude usage visibility

## Scope

### In Scope

- Tighten PR body/template stripping in `src/lib/pr-intent-parser.ts` so template/checklist boilerplate does not surface as `breaking change in body`
- Preserve real breaking-change body detection for genuine prose after stripping
- Change Review Details Claude usage display from **percent used** to **percent left** when rate-limit data is available
- Define and implement a truthful fallback contract when `rate_limit_event` data is absent from the execution result
- Add deterministic regression tests for parser behavior, usage rendering, and handler wiring
- Add a checked-in real-world regression fixture derived from the xbmc PR body/output to lock both failures down

### Out of Scope / Non-Goals

- General AST-based breaking-change inference (that belongs to M038)
- Broader review prompt redesign
- New Claude usage telemetry sources outside the current Agent SDK result path
- Reworking PR intent parsing beyond the specific breaking-change/template-hardening surface

## Technical Constraints

- The parser fix must remain conservative: real title/body/commit signals still count, only boilerplate/template leakage should be removed
- Usage rendering must be truthful: Kodiai cannot display weekly remaining percent unless the execution result carries enough rate-limit information
- The fixture should be minimal and deterministic — enough of the real xbmc case to prove the regression without importing noisy irrelevant metadata

## Integration Points

- `src/lib/pr-intent-parser.ts` — breaking-change signal detection and template stripping
- `src/lib/review-utils.ts` — Review Details formatting contract for Claude usage
- `src/execution/agent-entrypoint.ts` — source of persisted usageLimit data
- `src/handlers/review.ts` — Review Details publication wiring
- `src/lib/pr-intent-parser.test.ts`, `src/lib/review-utils.test.ts`, `src/handlers/review.test.ts` — regression proof surfaces

## Open Questions

- None — scope is clear enough for planning and implementation.
