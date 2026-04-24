# S03: Large-PR baseline proof harness — Research

## Summary

S03 is targeted, not broad. The core implementation seam already exists in `scripts/verify-m062-s01.ts`: it proves the normalized first-pass contract and emits stable machine-readable fields (`boundedReason`, `evidenceSource`, `publicationEligible`, `hasPublishedOutput`, coverage counts, scenario classification). S02 already unified the user-visible wording contract in `src/lib/review-utils.ts` and `src/lib/partial-review-formatter.ts`, with handler integration tests proving timeout, retry-merge, and bounded `max_turns` publication all render through the same contract.

So S03 should **not** invent a second truth model. It should build a milestone-level verifier that composes the existing S01 scenario matrix with the existing S02 wording/rendering helpers and asserts the combined baseline stays truthful. The natural output is a new script like `scripts/verify-m062-s03.ts` plus tests, wired in `package.json` as `verify:m062:s03`.

The slice mainly supports the milestone’s final acceptance and the operational proof surfaces in active requirements **R049** and **R050**. R061 and R064 are already validated by S01/S02; S03’s job is to lock those contracts into a deterministic regression harness before continuation work starts.

## Recommendation

Build **one verifier module** that operates entirely on deterministic fixtures, reusing production functions rather than duplicating handler logic:

1. Import the S01 verifier scenario matrix / evaluator instead of re-describing constrained outcomes.
2. For each scenario, render both visible surfaces from the same `reviewFirstPass` payload:
   - public bounded comment via `formatPartialReviewComment`
   - Review Details via `formatReviewDetailsSummary`
3. Add milestone-level checks that prove:
   - bounded scenarios never read as exhaustive
   - zero-evidence failure never renders as bounded success
   - both visible surfaces agree on covered scope, remaining scope, and continuation state
   - large-PR boundedness still carries truthful coverage wording even when evidence comes from `boundedness` rather than `checkpoint`
4. Keep the harness deterministic and auth-free; do **not** make this a live GitHub/Azure verifier.

That is the lowest-risk path because it reuses the exact seams S01/S02 introduced and keeps S03 as proof composition, not more product behavior.

## Implementation Landscape

### Existing proof seam: `scripts/verify-m062-s01.ts`

- Already exports reusable pieces:
  - `getDefaultScenarioMatrix()`
  - `evaluateScenario()`
  - `evaluateM062S01()`
  - `renderM062S01Report()`
- The scenario matrix already covers the four baseline states S03 cares about:
  - `timeout-checkpoint`
  - `max-turns-checkpoint`
  - `large-pr-bounded`
  - `zero-evidence-failure`
- Important: S01 validates identity and payload consistency, but it **does not** verify visible wording parity. That is the exact gap S03 should close.

### Shared visible wording seam: `src/lib/review-utils.ts`

Key helpers already centralize the contract:

- `buildReviewFirstPassPublicSummary(firstPass, timedOutAfterSeconds?)`
- `describeReviewFirstPass(firstPass)`
- `formatReviewDetailsSummary({... reviewFirstPass ...})`

Important contract details already encoded here:

- missing remaining scope degrades to `remaining scope is not confirmed from structured evidence`
- continuation pending is explicit
- zero-evidence failure uses a distinct hard-failure wording path
- bounded large-PR reason renders as `large-PR triage`

Planner implication: any S03 verifier should assert against these helpers, not hardcoded duplicate strings where avoidable.

### Shared public bounded comment seam: `src/lib/partial-review-formatter.ts`

- `formatPartialReviewComment()` is thin by design and already delegates summary wording to `buildReviewFirstPassPublicSummary()`.
- It throws when `firstPass.state !== "bounded-first-pass"`, which is useful for S03: the verifier can assert zero-evidence scenarios are ineligible for this surface.

### Handler integration proof already exists: `src/handlers/review.test.ts`

Relevant tests already prove the production paths publish correctly:

- bounded first-pass output for `max_turns` with checkpoint evidence
- bounded first-pass Review Details for `max_turns`
- timeout publication and retry merge updates

S03 should **not** re-test handler orchestration broadly. It should stay at the deterministic proof-harness layer and consume these tests as boundary confidence.

### Existing review-output audit utilities are probably unnecessary

`src/review-audit/review-output-artifacts.ts` is for live GitHub artifact collection / exact-surface proof of explicit approve reviews. It is a different verifier pattern than this slice needs. Useful reference for report shape discipline, but probably the wrong dependency for S03 because:

- it is live/auth-dependent
- it targets explicit mention-review approval bodies, not bounded first-pass review surfaces
- S03 acceptance is about deterministic large-PR truthfulness before continuation redesign

## What To Build

### 1. New milestone verifier script

Likely file: `scripts/verify-m062-s03.ts`

Suggested responsibilities:

- export a small typed report shape, similar to S01 style
- evaluate all four S01 scenarios
- for bounded-first-pass scenarios:
  - render public bounded comment
  - render Review Details
  - assert both surfaces tell the same story about:
    - bounded reason
    - covered scope
    - remaining scope / uncertainty
    - continuation pending
- for zero-evidence scenario:
  - assert it remains a dead-end failure classification
  - assert no bounded public comment is rendered
  - optionally render Review Details and assert the hard-failure wording stays explicit
- emit both machine-readable JSON and human-readable text

### 2. New verifier tests

Likely file: `scripts/verify-m062-s03.test.ts`

This should be the primary regression surface for S03. It should cover:

- default matrix success
- single-scenario targeting if the CLI supports `--scenario`
- parity checks between public summary and Review Details
- large-PR boundedness scenario uses boundedness-derived coverage truthfully
- zero-evidence scenario cannot masquerade as bounded first-pass output
- `package.json` wiring for `verify:m062:s03`

### 3. `package.json` script wiring

Add:

- `"verify:m062:s03": "bun scripts/verify-m062-s03.ts"`

This matches the established verifier pattern in this repo.

## Natural Task Split

### Task A — Build verifier core

Files:
- `scripts/verify-m062-s03.ts`

Focus:
- define report/check shapes
- compose S01 scenarios with S02 rendering helpers
- keep report deterministic and small

### Task B — Add verifier tests and script wiring

Files:
- `scripts/verify-m062-s03.test.ts`
- `package.json`

Focus:
- lock the matrix/check behavior
- assert CLI + JSON output + package wiring

### Task C — Final verification sweep

Likely commands:
- `bun test ./scripts/verify-m062-s03.test.ts ./scripts/verify-m062-s01.test.ts`
- `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts`
- `bun run verify:m062:s01 -- --json`
- `bun run verify:m062:s03 -- --json`
- `bun run tsc --noEmit`

Task C is sequential and should happen after A/B.

## Verification Contract

Fresh evidence gathered during research:

- `bun test ./scripts/verify-m062-s01.test.ts ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts` → pass (170 tests)
- `bun run verify:m062:s01 -- --json` → pass with 4 expected scenarios and stable fields

S03 completion should add a new milestone-level gate, not replace these.

Recommended final slice verification:

```bash
bun test ./scripts/verify-m062-s03.test.ts ./scripts/verify-m062-s01.test.ts
bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts
bun run verify:m062:s01 -- --json
bun run verify:m062:s03 -- --json
bun run tsc --noEmit
```

## Constraints and Gotchas

### Reuse S01’s normalized payload directly

Do not reconstruct bounded first-pass payloads by hand in the S03 verifier except in narrowly-scoped negative tests. The point is to catch drift between normalization and rendering, so the verifier must consume the same `ReviewFirstPassPayload` path production uses.

### Do not create a second wording contract

`formatReviewDetailsSummary()` and `formatPartialReviewComment()` already share `buildReviewFirstPassPublicSummary()` for the public line and `describeReviewFirstPass()` for details wording. S03 should assert these contracts, not introduce alternate prose generation inside the verifier.

### Zero-evidence failure is a first-class negative case

`formatPartialReviewComment()` rejects non-`bounded-first-pass` payloads. Preserve that. The verifier should treat this as evidence that zero-evidence runs cannot accidentally publish bounded-success wording.

### Coverage assertions should be semantic, not brittle full-body snapshots

The M028 research history in `.gsd` shows how shallow string checks can miss real drift. For S03, assert the contract-critical lines/clauses:

- covered scope counts
n- remaining scope counts or explicit uncertainty
- continuation pending wording
- bounded reason wording

Full-body snapshot tests are optional; semantic assertions are the important guard.

### Keep it deterministic and local

No GitHub, Azure, or env-gated live proof should enter this slice. The milestone roadmap explicitly asks for a deterministic verifier operators can run before continuation redesign.

## Skill Discovery Notes

Per `using-superpowers`, I checked for applicable skills first.

Directly relevant installed skills are limited. `github-bot`/`gh` exist but are aimed at live GitHub operations, not this local deterministic verifier. No installed skill is a better fit than the repo’s established verifier-script pattern.

Potential external skills discovered but **not recommended as necessary** for this slice:

- `npx skills add secondsky/claude-skills@bun-test-basics` — highest-signal Bun testing skill found; relevant only if the team wants extra Bun-specific test guidance.
- `npx skills add vercel-labs/emulate@github` — GitHub automation oriented, but S03 should remain auth-free/local, so this is not core to the work.

## Sources

Code read:
- `scripts/verify-m062-s01.ts`
- `scripts/verify-m062-s01.test.ts`
- `src/lib/review-first-pass.ts`
- `src/lib/review-utils.ts`
- `src/lib/review-utils.test.ts`
- `src/lib/partial-review-formatter.ts`
- `src/lib/partial-review-formatter.test.ts`
- `src/handlers/review.test.ts`
- `src/review-audit/review-output-artifacts.ts`
- `src/review-audit/review-output-artifacts.test.ts`
- `src/handlers/review-idempotency.ts`
- `package.json`

Commands run:
- `rg -n "verify:m062|verify-m062|reviewFirstPass|bounded first-pass|bounded-review|Review Details|reviewOutputKey|partial-review" src scripts package.json`
- `rg -n "M062|S03|verify:m062:s03|large-PR baseline proof harness|truth baseline" .gsd src scripts`
- `bun test ./scripts/verify-m062-s01.test.ts ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts`
- `bun run verify:m062:s01 -- --json`
- `npx -y skills find "octokit github api"`
- `npx -y skills find "bun typescript testing"`
