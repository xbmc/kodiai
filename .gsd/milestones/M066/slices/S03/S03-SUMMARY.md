---
id: S03
parent: M066
milestone: M066
provides:
  - S04 can publish safe formatter suggestions by calling `publishFormatterSuggestionReview()` with S02 payloads, repo/PR identity, PR head `commitId`, and formatter-specific `reviewOutputKey`.
  - S04 can use the returned result shape to distinguish no-op, duplicate, blocked, failed, and posted formatter-suggestion outcomes without parsing GitHub errors itself.
  - S05 has a bounded publisher contract to exercise in live smoke proof without adding branch writes, bot commits, new PRs, or standalone comment fallback.
requires:
  - slice: S01
    provides: Formatter config and explicit/combined mention intent contract that S04 will use when invoking the publisher.
  - slice: S02
    provides: Formatter command result, safe suggestion payloads, skipped hunk diagnostics, and max suggestion cap consumed by the publisher.
affects:
  - S04
  - S05
key_files:
  - src/execution/formatter-suggestion-publisher.ts
  - src/execution/formatter-suggestion-publisher.test.ts
  - .gsd/PROJECT.md
  - .gsd/REQUIREMENTS.md
key_decisions:
  - Defined a narrow `FormatterSuggestionPublisherOctokit` port around `rest.pulls.createReview` so tests and S04 callers depend only on the one GitHub operation this publisher is allowed to perform.
  - Converted publication-gate resolution failures to structured failed publisher results instead of allowing exceptions or publishing without idempotency confirmation.
  - Preserved the review-output idempotency marker by avoiding the full inbound sanitizeContent pipeline on outgoing review bodies; outgoing protection uses raw secret scanning plus targeted bot mention sanitization instead.
  - Blocked review-body secret results omit reviewOutput marker/key metadata to avoid leaking unsafe generated body content, while comment-secret blocks can retain safe idempotency metadata.
patterns_established:
  - Publisher accepts S2 `FormatterSuggestionPayload[]` directly and never reparses formatter diffs.
  - One formatter publication attempt maps to one GitHub `pulls.createReview` call; no per-comment API loops or fallback publication modes are introduced.
  - All publication outcomes are structured and all-or-nothing: `posted`, `skipped`, `no-suggestions`, `blocked`, or `failed`.
  - Outgoing untrusted formatter markdown is scanned for secrets before writing and has bot mentions sanitized after the idempotency decision but before GitHub publication.
observability_surfaces:
  - Publisher result status, posted/skipped counts, review id/url, review-output idempotency metadata, skipped S02 diagnostics, blocked pattern/location, rejection status/message, and optional best-effort logger warnings/errors.
drill_down_paths:
  - .gsd/milestones/M066/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M066/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M066/slices/S03/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-05-05T00:53:56.943Z
blocker_discovered: false
---

# S03: Batched same-PR suggestion review publisher

**S03 delivered a deterministic formatter suggestion publisher that creates one same-PR GitHub Pull Request Review with multiple inline suggested-change comments, idempotency markers, outgoing safety checks, and truthful all-or-nothing failure results.**

## What Happened

S03 added `src/execution/formatter-suggestion-publisher.ts` and its targeted test suite as the publisher boundary between S02's safe `FormatterSuggestionPayload[]` mapper and S04's upcoming mention orchestration. The exported `publishFormatterSuggestionReview()` accepts repo/PR identity, the caller-provided PR head `commitId`, optional `reviewOutputKey`, optional `botHandles`, optional logger, optional `ReviewOutputPublicationGate`, S02 skipped diagnostics, and the suggestions to publish. For a non-empty, non-duplicate safe batch it builds one Pull Request Review body, includes `buildReviewOutputMarker(reviewOutputKey)` when keyed, maps each S02 payload to GitHub inline review-comment fields (`path`, `line`, `side`, optional `start_line`, optional `start_side`, and `body`), and calls `octokit.rest.pulls.createReview` exactly once with `event: "COMMENT"` and the provided `commit_id`.

The slice also closed retry/idempotency and no-op behavior needed by S04. Empty suggestion batches now return `status: "no-suggestions"`, `posted: 0`, and preserved S02 skip diagnostics without resolving the publication gate or writing to GitHub. Keyed non-empty batches resolve either an injected gate or `createReviewOutputPublicationGate({ owner, repo, prNumber, reviewOutputKey })`; duplicate marker decisions return `status: "skipped"` with publication state, existing location, idempotency decision, and scan stats without calling `createReview`. Gate resolution errors return `status: "failed"` with `posted: 0` rather than publishing blindly.

The highest-risk publication path now treats repository-derived formatter output as untrusted outgoing markdown. Raw review and suggestion bodies are scanned with `scanOutgoingForSecrets()` before any GitHub write; blocked results expose only the matched pattern name and location (`review-body` or `comment`) and never echo secret values. Configured bot handles are sanitized from the review body and inline suggestion bodies with `sanitizeOutgoingMentions()` while preserving GitHub suggestion fences and the HTML-comment idempotency marker. GitHub validation/rejection errors from `createReview` are caught as whole-batch failures with `posted: 0`, `failed: true`, bounded/redacted rejection status/message, and no fallback to `createReviewComment`, issue comments, branch pushes, commits, or separate PRs.

This slice validates the S03 boundary for S04: orchestration can now invoke the publisher once with S02 payloads and surface the returned `posted`, `skipped`, `no-suggestions`, `blocked`, or `failed` result honestly. Live GitHub acceptance/rendering proof remains explicitly scoped to S05.

## Verification

Fresh slice verification passed after the final code changes:

1. `bun test ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` — exit 0; 34 tests passed, 0 failed, 117 assertions. This covers S02 mapper compatibility plus S03 publisher payload mapping, no-op, idempotency skip, default gate scan, gate rejection, mention sanitization, secret blocking, and GitHub 422 rejection handling.
2. `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` — exit 0; 279 tests passed, 0 failed, 1289 assertions. This confirms S01/S02 mention/config/formatter regressions still pass with the S03 publisher contract.

Observability/diagnostic surfaces verified by tests: structured result statuses (`posted`, `skipped`, `no-suggestions`, `blocked`, `failed`), posted/skipped counts, review id/url on success, review-output marker/idempotency fields, S2 skipped diagnostics preservation, blocked pattern/location without secret values, and bounded/redacted GitHub rejection details. Optional logger paths are best-effort and tested indirectly through safe non-throwing behavior assumptions in implementation.

## Requirements Advanced

- R077 — S03 advances same-PR committable-suggestion implementation by using GitHub Pull Request Review inline suggestion comments only; live committability proof remains S05.
- R080 — S03 provides the formatter-publisher subflow boundary required for combined request orchestration, but S04 must still wire combined-mode execution.
- R084 — S03 proves formatter-publication no-op, duplicate, secret-blocked, gate-failed, and GitHub-rejected outcomes are structured and visible; combined-mode independent failure handling remains S04.

## Requirements Validated

- R081 — M066/S03 verification passed with 34 targeted S02/S03 tests and 279 regression tests; publisher tests prove one `pulls.createReview` call carries multiple inline suggestion comments and idempotency markers without standalone comment fallback.

## New Requirements Surfaced

- None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

None from the slice plan. Memory capture attempts failed because the GSD memory store returned errors; reusable decisions/gotchas were therefore recorded in task summaries and this slice summary instead of durable memory.

## Known Limitations

S03 uses fake Octokit/contract tests only. It does not prove live GitHub rendering or committability; S05 remains responsible for that smoke proof. S03 also does not wire explicit or combined mention flows; S04 must supply formatter payloads, review-output key, PR head commit id, and user-visible result handling.

## Follow-ups

S04 should invoke `publishFormatterSuggestionReview()` from explicit `@kodiai format suggestions` and combined `@kodiai review & format suggestions` orchestration, preserve independent normal-review and formatter-subflow results, and surface `no-suggestions`/`skipped`/`blocked`/`failed` truthfully. S05 should run the live GitHub smoke and update operator docs.

## Files Created/Modified

- `src/execution/formatter-suggestion-publisher.ts` — New exported formatter suggestion publisher, Octokit port, options/result/status types, batched createReview mapping, idempotency gate handling, outgoing secret blocking, mention sanitization, and rejection conversion.
- `src/execution/formatter-suggestion-publisher.test.ts` — New test suite covering batched payload mapping, optional marker behavior, empty no-op, idempotency skip/default gate scan, gate failure, mention sanitization, outgoing secret blocks, and GitHub 422 rejection handling.
- `.gsd/REQUIREMENTS.md` — Rendered from DB after marking R081 validated with S03 verification evidence.
- `.gsd/PROJECT.md` — Refreshed current project state and architecture patterns to include M066/S03 completion and formatter publisher seam.
