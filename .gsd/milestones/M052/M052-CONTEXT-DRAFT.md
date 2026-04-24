# M052: Review system redesign for large PR handling — Context Draft

## Vision seed
Kodiai needs to handle large PRs better and avoid hitting `max_turns` during review. The user is open to a review system redesign rather than a narrow patch, and is comfortable with multiple milestones if needed.

## Work type
Primarily review-system / infrastructure-platform work, with product-contract changes around what Kodiai truthfully promises on oversized PRs.

## Confirmed reflection
- This is not just a threshold-tuning patch.
- Multi-milestone work is acceptable if that is what the redesign actually needs.
- The target is the real GitHub PR review flow.

## Current working milestone sequence
1. M052 — Large-PR review truth and telemetry baseline
2. M053 — Review execution redesign for large PRs
3. M054 — Continuation / recovery path for oversized reviews
4. M055 — Live hardening and config contract

## Confirmed Layer 1 — Scope
### In scope
- redesigning large-PR review behavior rather than just tuning thresholds
- a hybrid review contract:
  - a useful bounded review quickly
  - explicit disclosure of what was covered vs not covered
  - real continuation to deepen coverage
- automatic background continuation when the first pass was bounded by system limits
- updating the same visible review comment/surface rather than posting new comments
- stopping once enough high-risk ground has been covered, not requiring exhaustive eventual coverage
- truthful state reporting throughout

### Out of scope / not primary path
- manual follow-up commands as the primary continuation trigger
- noisy multi-comment continuation behavior
- pretending a bounded review was exhaustive

### Deferred / likely later
- config polish and operator knobs
- live rollout hardening and real-traffic proof
- unrelated rewrite of all review modes

## Confirmed Layer 2 — Architecture
### Chosen architecture
- External contract: **one stable public review identity that evolves in place**
- Execution contract: bounded first pass + automatic continuation
- Completion target: truthful sufficiency, not exhaustive eventual coverage
- Finding lifecycle: findings may be revised later, but revisions must be explicit, not silent

### Why
- Matches the user's explicit requirement to update the existing comment rather than create another one.
- Fits existing codebase primitives: `reviewOutputKey`, marker-based identity, append/upsert patterns, and publish-rights/supersession logic.
- Keeps the product quiet while allowing deeper background work.

### Alternatives considered
- Multiple public comments per continuation pass — rejected as too noisy
- Separate deep-review sidecar surface — rejected as drifting from the desired product contract
- Immutable early findings — rejected because shallow first-pass mistakes need a truthful revision path

## Confirmed Layer 3 — Error-handling defaults
- `max_turns` / timeout on first pass: publish truthful bounded result, mark continuation in progress, resume from persisted state
- continuation failure: no new public comment; keep last truthful visible state; bounded retries if safe; otherwise leave explicit partial/incomplete state
- new commit during continuation: supersede stale work and restart against new head state rather than let stale continuation win
- publish-rights loss: no spray/fallback comments; keep internal truth, do not overclaim visible refresh
- overturned findings: revise explicitly in the same comment, never silently
- state corruption / missing checkpoint: fail safe to bounded partial result instead of risking duplicate findings or false coverage claims

### User-visible states
- bounded review complete
- continuation in progress
- continuation stopped after sufficient high-risk coverage
- continuation interrupted / superseded
- partial review retained because deeper continuation failed

## Codebase findings influencing discussion
- Repo already has large-PR triage (`largePR.fileThreshold`, `fullReviewCount`, `abbreviatedCount`).
- Repo already has timeout-risk estimation and auto scope reduction.
- `.kodiai.yml` currently sets `timeoutSeconds: 1800`.
- Tests already cover `max_turns` failure handling, implying the current system treats it as a terminal mode rather than a first-class continuation path.
- Review publication already uses stable identity markers (`reviewOutputKey`, review-details marker) and existing append/upsert behavior.
- The codebase already has supersession logic for competing review work.

## Open questions still unresolved
- What exact acceptance criteria define the first bounded pass as “good enough”?
- How should the evolving single comment present coverage, revised findings, and settled state without becoming noisy?
- What verification bar proves the redesign worked on large PRs rather than only in unit tests?
- What non-functional limits (latency, attempt count, comment size, cost) should constrain continuation?
