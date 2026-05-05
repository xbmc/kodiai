# S03: Batched same-PR suggestion review publisher — UAT

**Milestone:** M066
**Written:** 2026-05-05T00:53:56.944Z

# UAT: M066/S03 Batched Same-PR Suggestion Review Publisher

## Preconditions

- The caller has already run S02 and has one or more `FormatterSuggestionPayload` objects whose target lines are commentable on the PR diff.
- The caller knows the target repository owner/name, PR number, and PR head commit SHA to pass as `commitId`.
- Tests use a fake Octokit or test GitHub client capable of capturing `rest.pulls.createReview` calls. Live GitHub rendering is intentionally deferred to S05.

## Test Case 1 — Publish one batched formatter review

1. Prepare two formatter suggestions: one single-line suggestion and one multi-line suggestion with `startLine`.
2. Call `publishFormatterSuggestionReview()` with `owner`, `repo`, `prNumber`, `commitId`, `reviewOutputKey`, and the two suggestions.
3. Expected outcome: exactly one `octokit.rest.pulls.createReview` call is made.
4. Expected outcome: the payload has `event: "COMMENT"`, `commit_id` equal to the caller-provided `commitId`, and one review body containing the Kodiai formatter summary plus `buildReviewOutputMarker(reviewOutputKey)`.
5. Expected outcome: the `comments` array contains both suggestions; the single-line comment has `path`, `line`, `side: "RIGHT"`, and the original suggestion fence body; the multi-line comment also has `start_line` and `start_side: "RIGHT"`.
6. Expected outcome: the result is `status: "posted"`, `posted` equals the number of comments, and `review.id`/`review.url` are populated from GitHub's response.

## Test Case 2 — Empty safe suggestion batch is a no-op

1. Call `publishFormatterSuggestionReview()` with `suggestions: []`, a `reviewOutputKey`, and one or more S02 skipped diagnostics.
2. Expected outcome: no publication gate is resolved and no GitHub write is attempted.
3. Expected outcome: the result is `status: "no-suggestions"`, `posted: 0`, `skipped` equals the S02 skipped diagnostic count, and `skippedSuggestions` preserves those diagnostics for S04 reporting.

## Test Case 3 — Duplicate review-output marker skips before publishing

1. Use a fake or real publication gate that returns `shouldPublish: false`, `publicationState: "skip-existing-output"`, an `existingLocation`, and an `idempotencyDecision`.
2. Call `publishFormatterSuggestionReview()` with a non-empty suggestion batch and the matching `reviewOutputKey`.
3. Expected outcome: the gate is resolved exactly once and `createReview` is not called.
4. Expected outcome: the result is `status: "skipped"`, `posted: 0`, and `reviewOutput` exposes the publication state, existing location, idempotency decision, marker, and scan stats.

## Test Case 4 — Outgoing mention sanitization preserves suggestion fences

1. Prepare a suggestion body containing a configured bot handle such as `@kodiai` inside a GitHub suggestion fence.
2. Call the publisher with `botHandles: ["kodiai"]`.
3. Expected outcome: GitHub receives a review body and comment body with the configured bot handle neutralized/sanitized.
4. Expected outcome: the markdown suggestion fence remains intact so GitHub can still render it as a committable suggestion.

## Test Case 5 — Outgoing secret detection blocks before GitHub writes

1. Prepare either a suggestion body or generated review body containing a credential-like token pattern.
2. Call the publisher with a fake Octokit that records write attempts.
3. Expected outcome: `createReview` is never called.
4. Expected outcome: the result is `status: "blocked"`, `posted: 0`, and `blocked.pattern`/`blocked.location` identify the class and source location without exposing the credential value.

## Test Case 6 — GitHub rejects the batch all-or-nothing

1. Use a fake Octokit whose `createReview` throws a GitHub-like `422 Validation Failed` error with a long message.
2. Call the publisher with a non-empty safe suggestion batch.
3. Expected outcome: the publisher does not retry with standalone inline comments, issue comments, pushes, commits, or a new PR.
4. Expected outcome: the result is `status: "failed"`, `posted: 0`, `failed: true`, and `rejection.status`/`rejection.message` contain bounded, sanitized rejection details that S04 can surface truthfully.

## Edge Cases to Preserve in S04

- If `reviewOutputKey` is omitted, the publisher still publishes one review but does not include a marker and does not run idempotency gating.
- S04 should pass the PR head SHA as `commitId`; this module intentionally does not fetch PR state.
- S04 should surface `blocked` and `failed` statuses as formatter-publication failures without claiming any suggestions were posted.
- S05 remains responsible for proving GitHub accepts and renders at least one generated suggestion on a real PR.
