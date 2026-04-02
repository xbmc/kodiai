# Requirements

This file is the explicit capability and coverage contract for the project.

## Active

### R001 — Claude Code usage limit visible in Review Details
- Class: primary-user-loop
- Status: active
- Description: After each agent execution, the % of weekly Claude Code usage limit consumed (and time until reset) appears in the Review Details collapsible on the GitHub PR comment.
- Why it matters: Operators need to know how much of their Claude Code plan they are consuming per review without leaving GitHub or opening a separate dashboard.
- Source: user
- Primary owning slice: M034/S01
- Supporting slices: M034/S02
- Validation: unmapped
- Notes: Sourced from `SDKRateLimitEvent.rate_limit_info.utilization` and `resetsAt`; absent when using API key auth (not OAuth/subscription) — must degrade gracefully.

### R002 — Token counts visible in Review Details
- Class: primary-user-loop
- Status: active
- Description: Input tokens, output tokens, cache read tokens, and estimated cost appear in the Review Details block for each review execution.
- Why it matters: Complements the usage-limit percentage with raw token detail for cost-conscious operators.
- Source: user
- Primary owning slice: M034/S02
- Supporting slices: none
- Validation: unmapped
- Notes: Token data already flows through ExecutionResult — this is a formatting/wiring task. The cost field is already present but not surfaced in the Review Details comment body.

## Deferred

### R003 — Usage visible in Slack assistant responses
- Class: integration
- Status: deferred
- Description: When a user asks the Slack assistant about usage or runs a usage-related slash command, it responds with current utilization % and reset time.
- Why it matters: Centralizes usage visibility in the operator's primary communication channel.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Deferred — the rate-limit event only fires during active agent runs; a Slack surface needs a persistent store of the last seen value. Revisit after R001/R002 are proven.

## Validated

(All prior milestone requirements — see historical milestone summaries)

## Out of Scope

### R004 — Usage dashboard / web UI
- Class: anti-feature
- Status: out-of-scope
- Description: No standalone usage dashboard; the GitHub comment and eventually Slack are the surfaces.
- Why it matters: Prevents scope expansion beyond the stated intent.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: User explicitly said "under details of the gh comment … eventually see it from slack/etc" — no mention of a web UI.

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
|---|---|---|---|---|---|
| R001 | primary-user-loop | active | M034/S01 | M034/S02 | unmapped |
| R002 | primary-user-loop | active | M034/S02 | none | unmapped |
| R003 | integration | deferred | none | none | unmapped |
| R004 | anti-feature | out-of-scope | none | none | n/a |

## Coverage Summary

- Active requirements: 2
- Mapped to slices: 2
- Validated: 0
- Unmapped active requirements: 0
