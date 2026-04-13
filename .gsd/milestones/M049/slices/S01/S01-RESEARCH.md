# M049/S01 Research — Shared clean-approval review body contract

## Executive Summary

This is **targeted research**, not deep discovery. The slice is a focused cross-cut through three existing approval publishers that already share the same `reviewOutputKey`/idempotency contract, but they do **not** yet share the same visible approval body.

The cleanest implementation seam is already present in `src/handlers/review-idempotency.ts`: it owns the marker helpers and the existing approved-review body helper. The actual gap is that only the explicit mention bridge uses that helper today. Automatic review still hand-builds a marker-only approval body, and the approve-via-comment path (`src/execution/mcp/comment-server.ts`) rejects any approved body richer than `Decision: APPROVE` + `Issues: none`.

The highest-risk decision for the planner is **whether the new contract should remain wrapped in `<details>`**. The roadmap/demo language says GitHub should *show* `Decision: APPROVE`, `Issues: none`, and factual evidence lines. The current helper/prompt/comment-server path is still built around a collapsed `<details><summary>kodiai response</summary>...` contract. If the milestone really wants a more visible GitHub review body, S01 must change the helper, the approve-via-comment sanitizer/promotion logic, and the mention prompt together.

Per `superpowers:writing-plans`, the natural decomposition is:
1. canonical approved-body helper + tests,
2. publisher adoption in `mention.ts` and `review.ts`,
3. approve-via-comment validator/prompt alignment.

## Active Requirements / Product Contract

### Active requirement supported by this slice

- **R043** — explicit PR mention review requests must still execute the review lane and publish exactly one visible GitHub outcome. S01 changes the clean approval body on that lane, so the explicit bridge must not regress.

### Important validated/downstream continuity contracts

- **R045** is already validated, but it still matters here because audit/operator tooling depends on the published `reviewOutputKey` marker staying intact.
- **D098** is the real product decision for this slice: use one shared short evidence-backed GitHub review body for clean approvals across explicit mention, automatic review, and approve-via-comment paths; do not add a separate clean-approval issue comment.

### M049/S01 acceptance from the milestone state

Current slice success criteria are:
- Shared builder emits decision/no-issues plus short factual evidence lines and marker.
- Explicit mention bridge uses the shared builder.
- Automatic clean-review lane uses the shared builder.
- Approve-via-comment sanitization accepts the shared approved-review shape without allowing arbitrary prose.

## What Exists Today

### 1) Canonical marker + approval helper already exist

**File:** `src/handlers/review-idempotency.ts`

Relevant seams:
- `buildReviewOutputKey(...)`
- `buildReviewOutputMarker(...)`
- `extractReviewOutputKey(...)`
- `ensureReviewOutputNotPublished(...)`
- `buildApprovedReviewBody(...)` at the existing canonical helper seam

Today `buildApprovedReviewBody(...)` already produces:
- `Decision: APPROVE`
- `Issues: none`
- optional `approvalConfidence`
- the `review-output` marker

But it still wraps the body in `<details>` via `wrapInDetails(...)`, and it does **not** yet model a shared factual evidence block.

This is the right place to keep the contract. Do **not** spread approved-body formatting into each handler.

### 2) Explicit `@kodiai review` bridge already uses the helper

**File:** `src/handlers/mention.ts`

Relevant areas:
- review-output-key creation around the explicit review path
- publish eligibility / idempotency gate around `explicitReviewPublishEligible`
- approval publish at `pulls.createReview({ event: "APPROVE", ... })`

Current behavior:
- explicit mention review runs `taskType: "review.full"`
- gate requires `result.conclusion === "success"`
- gate requires `usedRepoInspectionTools === true`
- gate suppresses bridge publication when blocking/finding-shaped text is detected
- on clean success, it publishes an approval review using `buildApprovedReviewBody({ reviewOutputKey })`

Important detail: this path already computes `explicitReviewPromptFileCount`, so it has a cheap deterministic fact available if the shared body wants an evidence line like reviewed-file count.

### 3) Automatic review clean approvals bypass the helper today

**File:** `src/handlers/review.ts`

Relevant areas:
- Review Details publication path around `buildReviewDetailsBody()` / `upsertReviewDetailsComment(...)`
- clean auto-approval publish at the final `pulls.createReview({ event: "APPROVE" ... })`

Current clean-approval body is hand-built and minimal:
- marker only
- optional `renderApprovalConfidence(...)` line for dep-bump reviews
- **no** `Decision: APPROVE`
- **no** `Issues: none`
- **no** shared evidence block

So S01’s main product change on the automatic lane is straightforward: stop hand-building this body and route through the same helper contract as the explicit bridge.

Important boundary: `review.ts` also publishes standalone **Review Details** when `result.published === false`. That logic is separate from the approval body contract. It lives earlier in the handler and is not required to make S01’s shared body contract work.

### 4) Approve-via-comment is the strictest blocker

**File:** `src/execution/mcp/comment-server.ts`

This is the most constraining seam for S01.

Current behavior:
- `sanitizeKodiaiDecisionResponse(...)` only enforces the approval/rejection structure when the body contains `<summary>kodiai response</summary>`.
- For `APPROVE`, it currently requires:
  - `Decision: APPROVE`
  - `Issues: none`
  - **nothing else** besides those lines.
- Later, PR approval promotion only fires when the sanitized body still contains:
  - `<summary>kodiai response</summary>`
  - `Decision: APPROVE`
  - `Issues: none`

So today the approve-via-comment path is coupled to **both**:
- the wrapped `<details>` response shape, and
- the two-line approval contract.

If the milestone wants factual evidence lines and a visible GitHub review body, this file must change in tandem with the helper and prompt.

### 5) The approve-via-comment prompt still instructs the old contract

**File:** `src/execution/mention-prompt.ts`

Current prompt rules say:
- always wrap the entire response in `<details>`
- for PR review/approval decisions, use the wrapped `kodiai response` block
- if approve: keep it to 1–2 lines and set `Issues: none`
- if not approved: only Decision + Issues

This is the prompt-side source of the current approve-via-comment body shape. If the desired contract changes, this prompt must be updated in the same slice as `comment-server.ts`, otherwise the agent will keep producing the old body.

### 6) Audit correlation is marker-based, not body-text-based

**File:** `src/review-audit/recent-review-sample.ts`

Important downstream safety check:
- audit artifact collection extracts `reviewOutputKey` from bodies via `extractReviewOutputKey(...)`
- it scans review comments, issue comments, and reviews
- it does **not** parse or depend on the exact approval text contract

That means S01 does **not** need audit-code changes as long as the final published review still includes the existing marker.

### 7) The shared summary/inline idempotency defect is already retired

**File:** `.gsd/milestones/M049/M049-ASSESSMENT.md`

This assessment proves the earlier summary-vs-inline idempotency collision is already fixed in production via the shared publication gate. That is separate from S01. Do **not** reopen idempotency-gate design unless the body-contract work accidentally breaks it.

## Key Constraints / Surprises

### A) The real product choice is visibility, not just string reuse

The existing helper already gives some reuse. The actual product upgrade in D098 is GitHub-visible trust.

If the planner keeps the `<details>` wrapper, implementation churn is lower, but the result may still under-deliver on “show a short GitHub review body with `Decision: APPROVE`, `Issues: none`, factual evidence lines.”

### B) Approve-via-comment cannot generate the marker itself — but it doesn’t need to

`createCommentServer(...)` already stamps the marker through `maybeStampMarker(...)` when a `reviewOutputKey` is present. That means the prompt does **not** need to teach the model to emit HTML markers. The prompt only needs to teach the visible approval-body structure.

This is useful because it keeps marker continuity deterministic and out of the LLM-authored content.

### C) The strict validator is both the safety mechanism and the main migration cost

S01 cannot just “allow more text” in `comment-server.ts`. The state contract explicitly says approve-via-comment sanitization must accept the shared approved-review shape **without allowing arbitrary prose**.

That means the validator should stay narrow. The safest way is to define one approved-body grammar and validate it explicitly.

### D) `review-comment-thread-server.ts` is not part of the approval-publisher set

It only replies in inline review threads. It mirrors some decision validation, but it is not one of the clean approval publishers called out by the milestone. Avoid widening S01 scope into review-thread reply formatting.

## Recommendation

### Recommended contract

Adopt a **single narrow approved-review grammar** that all clean publishers can emit or accept:

```md
Decision: APPROVE
Issues: none
Evidence:
- <factual line 1>
- <factual line 2>
<!-- kodiai:review-output-key:... -->
```

Why this shape works:
- easy to validate in `comment-server.ts`
- clearly distinct from NOT APPROVED bodies
- supports “factual evidence lines” without allowing arbitrary paragraphs
- compatible with marker-based audit correlation
- flexible enough for lane-specific facts

### Strong recommendation on wrapper choice

I recommend making the **approved review body visible plain markdown, not `<details>`-wrapped**, because the roadmap/demo language is about what GitHub should visibly show on a clean approval.

If the planner intentionally keeps the wrapper for S01 to minimize churn, that should be treated as a conscious tradeoff/risk against the milestone wording.

### Evidence-line strategy

Do **not** make the validator depend on exact wording. Make it depend on shape:
- `Decision: APPROVE`
- `Issues: none`
- `Evidence:` header
- 1–3 bullet lines
- no extra prose/sections

Then let the helper build deterministic lane-specific evidence lines from facts already in hand.

Practical facts already available without new APIs:
- explicit mention lane: repo inspection used, prompt-reviewed file count
- automatic review lane: changed-file count, optional dep-bump merge confidence
- approve-via-comment lane: prompt-guided facts from repo inspection / files reviewed / CI context, with server-side marker stamping

### Keep S01 scoped

Do **not** pull S02’s broader operator/noise cleanup into S01 unless the implementation becomes trivial after the helper change.

Specifically, the standalone clean-review `Review Details` behavior in `review.ts` is adjacent but separable. The slice success criteria for S01 are about the shared clean approval body contract, not the full “no separate clean-approval PR comment” milestone closure.

## Natural Task Seams for the Planner

### Seam 1 — Canonical helper + contract tests

**Files:**
- Modify: `src/handlers/review-idempotency.ts`
- Modify: `src/handlers/review-idempotency.test.ts`
- Possibly read-only reference: `src/lib/formatting.ts`

Goal:
- make one canonical approved-body builder own the contract
- add evidence-line support
- preserve marker continuity
- decide whether `<details>` stays or goes

This is the best first task because it creates the contract every other task consumes.

### Seam 2 — Publisher adoption in the two handler lanes

**Files:**
- Modify: `src/handlers/mention.ts`
- Modify: `src/handlers/mention.test.ts`
- Modify: `src/handlers/review.ts`
- Modify: `src/handlers/review.test.ts`
- Reference only: `src/lib/review-utils.ts`

Goal:
- explicit mention bridge uses the shared builder
- automatic clean-review lane uses the shared builder
- preserve existing idempotency / publish-resolution / approval gating behavior
- preserve dep-bump approval-confidence behavior by threading it through the new builder shape rather than losing it

This seam is reasonably independent once the helper shape is settled.

### Seam 3 — Approve-via-comment acceptance + prompt alignment

**Files:**
- Modify: `src/execution/mcp/comment-server.ts`
- Modify: `src/execution/mcp/comment-server.test.ts`
- Modify: `src/execution/mention-prompt.ts`
- Modify: `src/execution/mention-prompt.test.ts`
- Reference only: `src/execution/mcp/index.ts`

Goal:
- validator accepts the new approved-review shape and still rejects arbitrary prose
- PR promotion to `pulls.createReview({ event: "APPROVE" })` still fires for the new approved shape
- prompt exception is clear enough that PR approval decisions do not keep following the old “always wrap in `<details>`” rule if the contract becomes visible/plain

This is the most behavior-sensitive seam, so it should probably land after the helper is defined and before any live proof work.

## Verification

### Best focused regression command for S01

```bash
bun test ./src/handlers/review-idempotency.test.ts ./src/handlers/mention.test.ts ./src/handlers/review.test.ts ./src/execution/mcp/comment-server.test.ts ./src/execution/mention-prompt.test.ts
```

What this should prove:
- canonical approved-review builder emits the new shared shape
- explicit mention bridge publishes that shape on clean approvals
- automatic review publishes that shape on clean approvals
- approve-via-comment still promotes clean approvals to GitHub `APPROVE` reviews
- validator accepts the new shape but rejects extra prose

### Type safety / drift check

```bash
bun run tsc --noEmit
```

### High-value assertions to add/update

- explicit mention clean approval body contains:
  - `Decision: APPROVE`
  - `Issues: none`
  - evidence header/lines
  - `kodiai:review-output-key`
- automatic clean approval body contains the same shared structure
- replay/idempotency test still proves only one clean approval review is created
- comment-server PR approval test proves the new approved shape still becomes `event: "APPROVE"`
- comment-server adds/keeps the review-output marker on publish
- comment-server rejects approved bodies with extra paragraphs/headings outside the allowed grammar
- mention prompt test proves PR approval guidance matches the new shared contract

## Forward Intelligence

- The production idempotency preflight fix is already proven in `.gsd/milestones/M049/M049-ASSESSMENT.md`. Stay off that path unless body-contract edits break something.
- The canonical seam for this slice is **not** `src/lib/review-utils.ts`; it is `src/handlers/review-idempotency.ts`, because that file already owns the marker/build/scan contract.
- If the helper moves away from `<details>`, `comment-server.ts` and `mention-prompt.ts` must change in the **same slice**. Otherwise approve-via-comment will silently keep using the old wrapped format and diverge from the shared contract.
- Audit code is already marker-based. S01 should preserve the marker and avoid spending time on `src/review-audit/*` until S02.

## Skill Discovery

Relevant installed skill already present:
- `github-bot` — GitHub API operations, but not needed for this local TypeScript implementation slice.

External skill search results:
- `npx skills find "GitHub Apps"` surfaced `joelhooks/joelclaw@github-bot` and `phrazzld/claude-config@github-app-scaffold` as the closest matches.
- `npx skills find "Octokit"` returned no skill.

Recommendation: **do not install any new skill for S01**. The work is straightforward local TypeScript/Octokit code in an established subsystem.
