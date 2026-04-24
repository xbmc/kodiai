# Requirements

This file is the explicit capability and coverage contract for the project.

## Active

### R061 — Large PRs return a truthful bounded first review instead of ending as a dead max_turns failure with no useful outcome
- Class: core-capability
- Status: active
- Description: Large PRs return a truthful bounded first review instead of ending as a dead max_turns failure with no useful outcome.
- Why it matters: Large PR review is currently untrustworthy if the system burns turns and leaves maintainers without a useful review contract.
- Source: user
- Primary owning slice: M052/S01
- Supporting slices: none
- Validation: mapped
- Notes: First-pass contract for the redesign track. This is about useful bounded output, not yet automatic continuation.

### R062 — When a large-PR review is bounded, Kodiai automatically continues review work in the background without requiring a manual follow-up command
- Class: continuity
- Status: active
- Description: When a large-PR review is bounded, Kodiai automatically continues review work in the background without requiring a manual follow-up command.
- Why it matters: The large-PR experience should not depend on humans remembering to ask for deeper review after the first bounded pass.
- Source: user
- Primary owning slice: M053/S01
- Supporting slices: none
- Validation: mapped
- Notes: Automatic continuation is the default path once the bounded first-pass contract exists.

### R063 — Automatic continuation updates the same visible review surface in place and must not create an additional public comment for the same review lifecycle
- Class: continuity
- Status: active
- Description: Automatic continuation updates the same visible review surface in place and must not create an additional public comment for the same review lifecycle.
- Why it matters: The user experience should stay quiet and legible on GitHub rather than turning one review lifecycle into comment spam.
- Source: user
- Primary owning slice: M053/S02
- Supporting slices: none
- Validation: mapped
- Notes: One stable public review identity across first pass and continuation.

### R064 — The visible review must report truthful coverage state, including what was reviewed, what remains, and whether continuation is still in progress or has stopped
- Class: failure-visibility
- Status: active
- Description: The visible review must report truthful coverage state, including what was reviewed, what remains, and whether continuation is still in progress or has stopped.
- Why it matters: Bounded review is only trustworthy if the visible output tells maintainers what Kodiai actually covered and what remains.
- Source: user
- Primary owning slice: M052/S02
- Supporting slices: M053/S02
- Validation: mapped
- Notes: Coverage/accounting surface for the large-PR redesign.

### R065 — Kodiai may revise earlier findings during continuation, but every revision must be explicit rather than a silent rewrite of previously visible conclusions
- Class: correctness
- Status: active
- Description: Kodiai may revise earlier findings during continuation, but every revision must be explicit rather than a silent rewrite of previously visible conclusions.
- Why it matters: A bounded first pass can be incomplete, but later correction must remain legible to users and operators.
- Source: user
- Primary owning slice: M053/S02
- Supporting slices: none
- Validation: mapped
- Notes: Revisions are allowed; silent mutation is not.

### R066 — Continuation stops after sufficient high-risk coverage is achieved and must disclose that the review is sufficient-but-bounded rather than exhaustive
- Class: constraint
- Status: active
- Description: Continuation stops after sufficient high-risk coverage is achieved and must disclose that the review is sufficient-but-bounded rather than exhaustive.
- Why it matters: The redesign should optimize for truthful sufficiency rather than pretending exhaustive eventual coverage is always practical.
- Source: user
- Primary owning slice: M053/S03
- Supporting slices: M055/S02
- Validation: mapped
- Notes: The stopping contract is explicitly non-exhaustive.

### R067 — New commits supersede stale continuation work cleanly so old background review attempts cannot overwrite or misrepresent the latest PR state
- Class: continuity
- Status: active
- Description: New commits supersede stale continuation work cleanly so old background review attempts cannot overwrite or misrepresent the latest PR state.
- Why it matters: Automatic continuation is unsafe unless stale work yields to newer PR state deterministically.
- Source: inferred
- Primary owning slice: M054/S01
- Supporting slices: none
- Validation: mapped
- Notes: Supersession must be first-class in the continuation lifecycle.

### R068 — Large-PR continuation and comment evolution are backed by durable operator evidence so maintainers can tell why continuation progressed, stopped, failed, or was superseded
- Class: operability
- Status: active
- Description: Large-PR continuation and comment evolution are backed by durable operator evidence so maintainers can tell why continuation progressed, stopped, failed, or was superseded.
- Why it matters: Operators need attributable lifecycle evidence instead of guessing from GitHub-visible output alone.
- Source: inferred
- Primary owning slice: M054/S02
- Supporting slices: M055/S02
- Validation: mapped
- Notes: Operator-visible evidence surface for the evolving review lifecycle.

### R069 — The redesign must preserve small and normal PR behavior and avoid regressing review latency, noise, or publication semantics on non-large PRs
- Class: quality-attribute
- Status: active
- Description: The redesign must preserve small and normal PR behavior and avoid regressing review latency, noise, or publication semantics on non-large PRs.
- Why it matters: Large-PR improvements are not acceptable if they make standard reviews slower, noisier, or less trustworthy.
- Source: inferred
- Primary owning slice: M055/S01
- Supporting slices: none
- Validation: mapped
- Notes: Regression guard across the rest of the review path.

### R070 — The redesigned large-PR lifecycle is proven on at least one real large PR with bounded first pass, automatic continuation, and in-place visible comment updates
- Class: launchability
- Status: active
- Description: The redesigned large-PR lifecycle is proven on at least one real large PR with bounded first pass, automatic continuation, and in-place visible comment updates.
- Why it matters: This redesign changes the public review contract and should not be considered done on test fixtures alone.
- Source: user
- Primary owning slice: M055/S02
- Supporting slices: none
- Validation: mapped
- Notes: Live proof requirement for the redesign track.

## Deferred

### R071 — Operators can tune continuation aggressiveness, stopping thresholds, and attempt budgets per repo via explicit config
- Class: operability
- Status: deferred
- Description: Operators can tune continuation aggressiveness, stopping thresholds, and attempt budgets per repo via explicit config.
- Why it matters: Useful later once the core continuation contract is proven.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Deferred until the default lifecycle is proven.

### R072 — Users can manually request an extra deepening pass after automatic continuation settles
- Class: admin/support
- Status: deferred
- Description: Users can manually request an extra deepening pass after automatic continuation settles.
- Why it matters: Useful later, but not part of the default continuation contract.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Deferred in favor of automatic continuation as the primary path.

### R073 — The evolving review surface exposes a richer structured lifecycle view beyond the concise default GitHub comment
- Class: admin/support
- Status: deferred
- Description: The evolving review surface exposes a richer structured lifecycle view beyond the concise default GitHub comment.
- Why it matters: Might help later, but current direction is to keep the public review concise.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Deferred because the current product contract prefers quiet public output.

## Out of Scope

### R074 — Large PR review must always reach exhaustive eventual coverage across every changed file before Kodiai stops
- Class: constraint
- Status: out-of-scope
- Description: Large PR review must always reach exhaustive eventual coverage across every changed file before Kodiai stops.
- Why it matters: Prevents scope drift toward a false exhaustiveness requirement the user rejected.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Explicitly excluded.

### R075 — Continuation should post a new public comment for each pass so users can watch progress as a thread
- Class: anti-feature
- Status: out-of-scope
- Description: Continuation should post a new public comment for each pass so users can watch progress as a thread.
- Why it matters: Prevents comment spam and preserves one stable public review identity.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Explicitly excluded.

### R076 — Manual follow-up commands are the primary mechanism for deepening large-PR review
- Class: anti-feature
- Status: out-of-scope
- Description: Manual follow-up commands are the primary mechanism for deepening large-PR review.
- Why it matters: Prevents the redesign from drifting away from automatic continuation as the default path.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Explicitly excluded.

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
|---|---|---|---|---|---|
| R061 | core-capability | active | M052/S01 | none | mapped |
| R062 | continuity | active | M053/S01 | none | mapped |
| R063 | continuity | active | M053/S02 | none | mapped |
| R064 | failure-visibility | active | M052/S02 | M053/S02 | mapped |
| R065 | correctness | active | M053/S02 | none | mapped |
| R066 | constraint | active | M053/S03 | M055/S02 | mapped |
| R067 | continuity | active | M054/S01 | none | mapped |
| R068 | operability | active | M054/S02 | M055/S02 | mapped |
| R069 | quality-attribute | active | M055/S01 | none | mapped |
| R070 | launchability | active | M055/S02 | none | mapped |
| R071 | operability | deferred | none | none | unmapped |
| R072 | admin/support | deferred | none | none | unmapped |
| R073 | admin/support | deferred | none | none | unmapped |
| R074 | constraint | out-of-scope | none | none | n/a |
| R075 | anti-feature | out-of-scope | none | none | n/a |
| R076 | anti-feature | out-of-scope | none | none | n/a |

## Coverage Summary

- Active requirements: 10
- Mapped to slices: 10
- Validated: 0
- Unmapped active requirements: 0
