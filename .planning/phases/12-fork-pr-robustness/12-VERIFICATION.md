---
phase: 12-fork-pr-robustness
verified: 2026-02-10T03:30:19Z
status: human_needed
score: 6/6 must-haves verified
human_verification:
  - test: "Fork PR review end-to-end (GitHub App token)"
    expected: "Workspace clones base repo at base ref, then fetches refs/pull/<n>/head; review comments anchor correctly"
    why_human: "Requires real GitHub network + permissions; cannot fully validate ref availability and comment anchoring from static code"
  - test: "Fork PR mention in inline review comment"
    expected: "Mention job uses base-clone + pull/<n>/head checkout and reply includes inline file/line/diff hunk context"
    why_human: "Depends on webhook payload shapes + GitHub reply APIs + real PR diff context"
  - test: "Scale behavior on huge PR/thread"
    expected: "Prompts include '## Scale Notes' when caps hit; list endpoints paginate; auto-approval is skipped with explicit log when scan caps hit"
    why_human: "Needs large real-world data volume to exercise pagination/cap branches"
---

# Phase 12: Fork PR Robustness Verification Report

**Phase Goal:** Fork PR robustness for reviews and mention contexts: base-clone + pull/<n>/head strategy, plus pagination/caps and explicit scale degradation.
**Verified:** 2026-02-10T03:30:19Z
**Status:** human_needed
**Re-verification:** No (initial verification)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Fork PR reviews do not rely on cloning the contributor's fork | ✓ VERIFIED | `src/handlers/review.ts:188` selects base clone for fork/deleted-fork; tests assert base clone + pull ref checkout in `src/handlers/review.test.ts:592` |
| 2 | Review workspace is built by cloning base repo and fetching `pull/<n>/head` | ✓ VERIFIED | `src/jobs/workspace.ts:108` implements `git fetch origin pull/<n>/head:pr-review`; invoked by `src/handlers/review.ts:240` |
| 3 | PR mention workspaces use the same PR-ref strategy (fork-safe) | ✓ VERIFIED | `src/handlers/mention.ts:142` forces base clone + PR ref; checkout via `src/handlers/mention.ts:184`; regression test `src/handlers/mention.test.ts:96` |
| 4 | Mention context includes PR + inline diff/file context when available | ✓ VERIFIED | `src/execution/mention-context.ts:270` adds PR context; `src/execution/mention-context.ts:299` adds inline diff/file/line; tested in `src/execution/mention-context.test.ts:232` |
| 5 | Large PRs/threads do not cause unbounded prompt growth; truncation is explicit | ✓ VERIFIED | Mention caps + explicit `## Scale Notes`: `src/execution/mention-context.ts:21` and `src/execution/mention-context.ts:316`; review prompt caps + `## Scale Notes`: `src/execution/review-prompt.ts:3` and `src/execution/review-prompt.ts:68` |
| 6 | Pagination is used for relevant GitHub list APIs, with bounded caps and safe degradation | ✓ VERIFIED | Issue comments pagination: `src/execution/mention-context.ts:88`; idempotency scans paginate: `src/handlers/review-idempotency.ts:88`; review comment scan paginates and skips auto-approval on cap: `src/handlers/review.ts:453` and `src/handlers/review.ts:480` |

**Score:** 6/6 truths verified

### Required Artifacts (Plan 12-01 .. 12-03 must_haves)

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/handlers/review.ts` | Fork-safe workspace strategy + scale guardrails | ✓ VERIFIED | Fork/deleted-fork uses base clone + PR ref fetch (`src/handlers/review.ts:188`, `src/handlers/review.ts:239`); paginated scan + safe degradation (`src/handlers/review.ts:445`) |
| `src/jobs/workspace.ts` | Helper to fetch+checkout `pull/<n>/head` | ✓ VERIFIED | `fetchAndCheckoutPullRequestHeadRef()` with PR number + branch validation (`src/jobs/workspace.ts:96`, `src/jobs/workspace.ts:108`) |
| `src/handlers/mention.ts` | Mention handler uses PR-ref workspace strategy | ✓ VERIFIED | PR mentions always use base ref clone + PR ref checkout (`src/handlers/mention.ts:142`, `src/handlers/mention.ts:183`) |
| `src/execution/mention-context.ts` | Bounded, sanitized mention context with pagination | ✓ VERIFIED | Hard caps + `per_page/page` pagination + explicit Scale Notes (`src/execution/mention-context.ts:21`, `src/execution/mention-context.ts:88`, `src/execution/mention-context.ts:315`) |
| `src/execution/review-prompt.ts` | Bounded review prompt with explicit Scale Notes | ✓ VERIFIED | Title/body/files caps + Scale Notes (`src/execution/review-prompt.ts:3`, `src/execution/review-prompt.ts:68`) |
| `src/handlers/review-idempotency.ts` | Idempotency marker scanning paginates (cap-aware) | ✓ VERIFIED | Paged scan of review comments, issue comments, and reviews (`src/handlers/review-idempotency.ts:25`, `src/handlers/review-idempotency.ts:88`) |
| `docs/runbooks/scale.md` | Operator runbook includes pagination + caps guidance | ✓ VERIFIED | Includes pagination/caps pointers + concrete `gh api --paginate` checks (`docs/runbooks/scale.md:31`, `docs/runbooks/scale.md:48`) |

### Key Link Verification (Wiring)

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `src/handlers/review.ts` | `src/jobs/workspace.ts` | `fetchAndCheckoutPullRequestHeadRef()` | WIRED | Imported + called for fork/deleted-fork PRs (`src/handlers/review.ts:19`, `src/handlers/review.ts:240`) |
| `src/handlers/mention.ts` | `src/jobs/workspace.ts` | `fetchAndCheckoutPullRequestHeadRef()` | WIRED | Imported + called for PR mentions (`src/handlers/mention.ts:13`, `src/handlers/mention.ts:184`) |
| `src/execution/mention-context.ts` | GitHub list APIs | `issues.listComments` with `per_page/page` + caps | WIRED | Bounded pagination loop (`src/execution/mention-context.ts:88`) |
| `src/handlers/review-idempotency.ts` | GitHub list APIs | paged scan for markers | WIRED | `pulls.listReviewComments`, `issues.listComments`, `pulls.listReviews` all pass `per_page/page` (`src/handlers/review-idempotency.ts:88`) |
| `src/handlers/review.ts` | GitHub list APIs | paged scan before auto-approval | WIRED | `pulls.listReviewComments` includes `per_page/page`, bounded by maxPages/maxScanItems; safe skip on cap (`src/handlers/review.ts:453`) |

### Requirements Coverage

No `.planning/REQUIREMENTS.md` found in this repo; coverage assessed directly against plan must_haves and the provided phase goal.

### Anti-Patterns Found

No obvious stubs found in the phase-critical files (no placeholder returns, no TODO/FIXME markers, no console-only handlers detected in the reviewed paths).

### Human Verification Required

1. Fork PR review end-to-end (GitHub App token)

**Test:** Open a fork PR against a repo installed with the GitHub App; trigger review (opened/ready_for_review/review_requested).
**Expected:** Logs indicate `workspaceStrategy=base-clone+pull-ref-fetch`; no fork clone attempted; inline comments (if any) anchor to correct files/lines.
**Why human:** Requires real GitHub permissions + refs/pull availability and comment anchoring behavior.

2. Fork PR mention in inline review comment

**Test:** Create an inline diff comment in a fork PR and mention `@kodiai`.
**Expected:** Handler fetches/checkout `pull/<n>/head` into `pr-mention`; reply is posted in-thread and includes file/line/diff hunk context.
**Why human:** Depends on webhook + GitHub reply APIs and real diff-hunk context.

3. Scale behavior on huge PR/thread

**Test:** Use a PR with >100 issue comments and/or thousands of changed files; trigger mention + review.
**Expected:** Prompts include `## Scale Notes` when caps are hit; behavior is deterministic; auto-approval is skipped with explicit log when scan caps are hit.
**Why human:** Needs large data volume and live API pagination behavior.

---

_Verified: 2026-02-10T03:30:19Z_
_Verifier: Claude (gsd-verifier)_
