# Small-Diff Review Fast Path Design

Date: 2026-04-28

## Goal

Prevent tiny pull requests from consuming the full `review.full` turn budget, while improving observability for future max-turn failures and making retry failures easier to diagnose.

Primary motivating incident:
- `xbmc/xbmc#28239` changed 1 file and 2 lines, but the initial review still exhausted the 25-turn `review.full` budget and fell back to a zero-evidence max-turn comment.
- The reduced-scope retry then failed separately with MCP startup failures and ACA timeout, leaving no actionable output.

## Problem Statement

The current review pipeline already detects when a PR is tiny and low risk, but that signal is not used to change the remote review-agent execution contract.

Today, even a one-line PR can still receive:
- the heavyweight `review.full` prompt,
- the full review tool surface,
- the normal `maxTurns` budget,
- full-review behavioral expectations (triage, broad inspection, citation-heavy reasoning).

That is structurally mismatched to tiny diffs. Raising `maxTurns` globally would mask the problem and increase cost. The root issue is that the remote agent lacks a small-diff fast path.

## Non-Goals

This change does **not** attempt to:
- redesign normal large/medium PR review behavior,
- redesign the visible zero-evidence max-turn fallback comment UI,
- guarantee retry success in every infrastructure failure mode,
- change review severity policy or publication semantics.

## User-Facing Outcome

For very small PRs, Kodiai should:
- inspect the diff quickly,
- read only obviously relevant surrounding code,
- publish findings or approval without spending 20+ turns on broad exploration,
- fail with better diagnostics if something still goes wrong.

This applies to both:
- automatic PR reviews, and
- explicit `@kodiai review` requests,
when the run is still a `review.full`-class code review and the diff is tiny.

## Recommended Approach

Implement a dedicated **small-diff review mode** rather than tuning the existing full-review prompt with softer instructions.

Reasoning:
- Prompt-only steering has already proven insufficient.
- A separate execution mode gives clear routing, telemetry, and test boundaries.
- The cost/risk profile of tiny diffs is materially different from standard reviews.

## Design Overview

### 1. Introduce a new task type: `review.small-diff`

When a review would normally run as `review.full`, route it to `review.small-diff` if the diff qualifies as tiny.

Initial eligibility rule:
- changed files <= 2
- total changed lines <= 20
- no bounded-review escalation already in force
- no explicit signals that require broader scope (for example, future structural-impact or high-risk overrides)

This should apply consistently to:
- `pull_request.opened`
- `pull_request.synchronize`
- `pull_request.review_requested`
- explicit `@kodiai review`

If a run is not eligible, keep the existing `review.full` behavior unchanged.

### 2. Give `review.small-diff` a narrower execution contract

#### Max turns
Use a lower cap than the repo-wide default.

Initial target:
- `maxTurns = 8`

Rationale:
- enough room for `git diff`, one or two file reads, one grep, and publication,
- low enough to prevent endless inspection loops on tiny changes.

#### Tool surface
Restrict the tool contract to the minimum useful review set:
- `Read`
- `Grep`
- `Glob`
- `Bash(git diff:*)`
- `Bash(git show:*)`
- review publication MCP tools already used in normal review paths

Avoid broad repo-inspection affordances unless they are already necessary for normal review publication.

#### Prompt contract
Create a small-diff-specific prompt path with these hard instructions:
- inspect the diff first,
- read only the changed file and directly adjacent context,
- broaden scope only if the diff itself proves ambiguity,
- do not do generalized architecture exploration,
- produce a merge decision quickly,
- if no actionable issue exists, end without additional exploratory turns.

The prompt should preserve existing review correctness rules, publication rules, severity rules, and security rules. The change is scope discipline, not review standards.

### 3. Add small-diff routing telemetry

When a review is eligible for the fast path, log that explicitly.

Suggested fields:
- `gate: review-routing`
- `taskType: review.small-diff`
- `routingReason: tiny-diff`
- `changedFiles`
- `linesChanged`
- `maxTurns`

This makes it easy to distinguish “agent routed correctly but still failed” from “agent never took the fast path.”

### 4. Improve per-turn diagnostics

Current diagnostics are too coarse: they only show that tools like `Bash`, `Read`, `Grep`, `Glob` were used.

Add lightweight per-turn trace lines to `agent-diagnostics.log`:
- turn number
- tool name
- compact target summary

Examples:
- `turn=1 tool=Bash target="git diff origin/main...HEAD"`
- `turn=2 tool=Read target="xbmc/platform/android/activity/JNIXBMCNsdManagerDiscoveryListener.cpp"`
- `turn=3 tool=Grep target="ClassPathToName"`

This must stay concise and secret-safe. Do not log arbitrary command output or prompt text. Log only the normalized action target.

Purpose:
- explain future max-turn failures quickly,
- detect tool loops,
- prove whether the small-diff contract is being followed.

### 5. Improve retry failure classification

The retry for `#28239` failed with:
- MCP servers unavailable in the retry agent startup path,
- ACA timeout,
- generic `retryConclusion: error`.

That is too vague.

Improve retry result classification so logs and result handling can distinguish at least:
- retry publish tooling unavailable / MCP startup failure,
- retry remote timeout,
- retry max-turn exhaustion,
- retry generic execution error.

This does **not** need to solve all retry infrastructure issues in the first pass. It needs to make them diagnosable and truthfully surfaced.

## Component-Level Changes

### `src/handlers/review.ts`

Add routing logic that decides between:
- `review.full`
- `review.small-diff`

Use already-computed diff metrics rather than recomputing a second classifier.

Thread the chosen task type and max-turn override into executor launch and retry launch paths.

### `src/execution/review-prompt.ts`

Add a small-diff prompt builder or conditional path for `review.small-diff`.

The new path should reuse existing correctness/security/publication rules where possible, but replace the broad review instructions with a constrained tiny-diff contract.

### `src/execution/executor.ts`

Support task-type-specific turn/tool routing for `review.small-diff`.

If task-type-specific model overrides already exist generically, this should plug into the same routing layer rather than special-casing too much in the executor.

### `src/execution/agent-entrypoint.ts`

Extend `agent-diagnostics.log` emission with compact per-turn tool-target trace lines.

This should be additive and must not expose secret values.

### Retry path (`src/handlers/review.ts` + related execution result handling)

Preserve the existing retry behavior, but classify retry failures more precisely and log the category explicitly.

## Testing Strategy

### Unit tests

Add targeted tests for:

1. **Routing eligibility**
- tiny diff routes to `review.small-diff`
- larger diff stays on `review.full`
- explicit `@kodiai review` on tiny diff also routes to `review.small-diff`

2. **Execution contract**
- `review.small-diff` uses the reduced max-turn value
- `review.small-diff` gets the reduced tool set
- `review.full` remains unchanged

3. **Prompt contract**
- small-diff prompt contains the “inspect diff first / no broad exploration” constraints
- full-review prompt remains unchanged for non-tiny diffs

4. **Diagnostics**
- per-turn tool trace lines are written in compact form
- traces do not require raw tool output

5. **Retry classification**
- MCP startup failure maps to a specific retry error category
- timeout maps distinctly from generic error

### Regression tests

Add a regression modeled on the `#28239` shape:
- 1 file, 2 lines, low risk
- verify the handler chooses the small-diff path
- verify the agent config no longer uses the standard 25-turn full-review contract

## Risks and Trade-offs

### Risk: tiny-diff threshold is too aggressive
A small textual diff can still be semantically risky.

Mitigation:
- keep the threshold conservative,
- require both small file count and small line count,
- allow existing boundedness / risk signals to opt out.

### Risk: second review mode increases complexity
True, but the behavior difference is real and already hurting reliability. The routing boundary is clearer than continually patching the single full-review mode.

### Risk: diagnostics grow too noisy
Mitigation:
- log only turn number, tool name, and normalized target summary,
- no command output, no prompt dumps, no secrets.

## Success Criteria

A successful implementation means:
- a PR shaped like `#28239` routes to `review.small-diff`, not the standard `review.full` budget,
- tiny-diff reviews no longer consume the full 25-turn budget under normal conditions,
- if a tiny-diff review still fails, diagnostics clearly show which tools consumed the turns,
- retry failures expose whether the problem was timeout, max-turns, or MCP/tooling startup.

## Open Questions Resolved

### Should the fast path apply only to automatic reviews?
No. It should apply to **all** `review.full`-class runs, including explicit `@kodiai review`, when the diff is tiny.

Reason:
- the failure mode is about diff size and execution contract, not trigger source,
- tiny diffs should behave consistently across automatic and explicit review flows.

## Recommended Implementation Order

1. Add tiny-diff eligibility and routing.
2. Add `review.small-diff` execution contract (prompt, max turns, tools).
3. Add targeted routing and executor tests.
4. Add per-turn diagnostics.
5. Add retry classification improvements.
6. Run focused review-path verification, then broader typecheck/lint.
