# S03: Batched same-PR suggestion review publisher

**Goal:** Build a deterministic formatter suggestion publisher that takes S02 `FormatterSuggestionPayload[]` and creates one same-PR GitHub Pull Request Review containing multiple inline `suggestion` comments, with review-level idempotency markers, no-op/skip behavior, outgoing safety checks, and whole-batch rejection reporting for S04.
**Demo:** A publisher can create one GitHub PR review containing multiple inline suggestion blocks, with markers/idempotency and rejection handling.

## Must-Haves

- ## Must-Haves
- `publishFormatterSuggestionReview()` or equivalently named exported function exists in `src/execution/formatter-suggestion-publisher.ts` and accepts S02 `FormatterSuggestionPayload[]`, repo/PR identity, `commitId`, optional `reviewOutputKey`, optional `botHandles`, optional logger, and optional `ReviewOutputPublicationGate`.
- Multiple safe formatter suggestions are published with exactly one `octokit.rest.pulls.createReview` call using `event: "COMMENT"`, the provided `commit_id`, one review body containing `buildReviewOutputMarker(reviewOutputKey)`, and a `comments` array using GitHub `path`, `body`, `line`, `side`, optional `start_line`, and optional `start_side` fields.
- Empty suggestions return a structured `no-suggestions` no-op result and do not call GitHub.
- Reusing an existing `reviewOutputKey` returns a structured `skipped` result using the idempotency decision/location from the publication gate and does not call GitHub.
- Outgoing review/comment bodies are sanitized with `sanitizeOutgoingMentions()` and blocked by `scanOutgoingForSecrets()` before any GitHub write when either the review body or a suggestion body contains a credential pattern.
- GitHub validation/rejection errors are caught as whole-batch failures with `posted: 0`, no silent fallback to standalone comments, a bounded sanitized error message, and result fields that S04 can surface truthfully.
- Result types expose posted/skipped/failed/rejection data for R084 and keep R077 live committability proof explicitly scoped to S05.
- ## Threat Surface
- **Abuse**: The publisher sends repository-derived formatter output into GitHub review comments; a malicious PR can include code that mentions bot handles, embeds credential-looking strings, or creates large/invalid suggestion bodies that cause GitHub rejection. S03 must sanitize mentions, scan for secrets, avoid branch/commit writes, and report all-or-nothing rejection without retry storms.
- **Data exposure**: Suggestion bodies may contain code from the PR diff and accidental secrets in formatter output. Do not echo matched secret values in results or logs; log only pattern names and bounded redacted messages.
- **Input trust**: `FormatterSuggestionPayload[]` comes from trusted S02 mapping but is still derived from untrusted repo content before publication. The publisher must treat all markdown bodies as untrusted outgoing content and only trust S02 for line commentability.
- ## Requirement Impact
- **Requirements touched**: R077, R080, R081, R084.
- **Re-verify**: S02 formatter mapper regression, S03 publisher unit tests, and the S01/S02 mention/config regression bundle to ensure publisher contract changes do not break upstream explicit formatter request semantics.
- **Decisions revisited**: D195 and D199 are implemented at fixture/contract level by same-PR inline suggestion review batching; D198 remains intact because the publisher consumes deterministic formatter payloads instead of LLM-authored hunks.

## Proof Level

- This slice proves: Contract/integration proof with fake Octokit. Real GitHub runtime is not required in S03; S05 remains responsible for live committability proof that GitHub accepts and renders at least one Kodiai-generated formatter suggestion.

## Integration Closure

Upstream surfaces consumed: `src/execution/formatter-suggestions.ts` `FormatterSuggestionPayload`/`FormatterDiffSkip`, `src/handlers/review-idempotency.ts` marker/status helpers, `src/execution/mcp/review-output-publication-gate.ts`, and `src/lib/sanitizer.ts`. New wiring introduced in this slice: an exported pure publisher module and tests that prove the S03 boundary contract for S04. Remaining before end-to-end usability: S04 must call the publisher from explicit/combined mention orchestration with a PR head SHA and formatter-specific review output key; S05 must run live GitHub smoke and operator docs.

## Verification

- Runtime signals: structured publisher result status (`posted`, `skipped`, `no-suggestions`, `blocked`, `failed`), posted/skipped counts, idempotency decision/location, review id/url, rejection status/message, and S02 skip summaries carried forward. Inspection surfaces: targeted Bun tests in `src/execution/formatter-suggestion-publisher.test.ts` and future S04 logs/results using the exported result shape. Failure visibility: blocked secret pattern names without secret values, GitHub rejection classification with bounded sanitized message, and no claimed posted count on failed batches. Redaction constraints: never include credential values in result text or logs; sanitize bot mentions in both review and inline bodies.

## Tasks

- [x] **T01: Add publisher contract and batched createReview payload tests** `est:1h`
  Use installed skills in task-plan frontmatter: `test-driven-development`, `tdd`, `verify-before-complete`.

Why: R081 needs a concrete batched publisher boundary before idempotency and failure handling can be meaningful. This task should establish the public API and prove the core GitHub Pull Request Review payload shape with a fake Octokit before implementation.

Steps:
1. In `src/execution/formatter-suggestion-publisher.test.ts`, write RED tests for two S02-style suggestions: one single-line and one multi-line. The fake Octokit should capture calls to `rest.pulls.createReview` and return a review `id` plus `html_url`.
2. Assert exactly one `createReview` call with `owner`, `repo`, `pull_number`, provided `commit_id`, `event: "COMMENT"`, a non-empty review `body`, and two `comments` entries.
3. Assert comment mapping preserves `path`, `line`, `side: "RIGHT"`, uses the S02 `suggestionBody` as the comment body, and maps `startLine` to GitHub `start_line` plus `start_side: "RIGHT"` for multi-line suggestions.
4. Create `src/execution/formatter-suggestion-publisher.ts` with exported options/result/status types and `publishFormatterSuggestionReview()` (or a clearly equivalent exported name). The first implementation should build a review summary body, append `buildReviewOutputMarker(reviewOutputKey)` when provided, map comments, and call `octokit.rest.pulls.createReview` once.
5. Run `bun test ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` until the new core payload tests pass.

Must-haves:
- The publisher accepts S02 `FormatterSuggestionPayload[]` directly; do not reparse formatter diffs in S03.
- The publisher uses `event: "COMMENT"`; do not create pending reviews and do not loop over `createReviewComment`.
- The provided `commitId` is passed through as `commit_id`; do not fetch PR state in this module.

Failure Modes (Q5): dependency `octokit.rest.pulls.createReview` throws => later T03 must convert to `failed`; malformed suggestion ranges are not revalidated here and are expected to be caught by GitHub/S02; missing optional `reviewOutputKey` means the review body has no marker but still publishes.

Load Profile (Q6): shared resource is one GitHub Pull Request Review create request per formatter publication; per-operation cost is one API call with N inline comments; 10x breakpoint is GitHub validation/rate/spam limits on batch size, so this publisher should not add per-comment API loops.

Negative Tests (Q7): single-line vs multi-line payload mapping, marker body presence when `reviewOutputKey` is set, and no accidental extra API calls.
  - Files: `src/execution/formatter-suggestion-publisher.test.ts`, `src/execution/formatter-suggestion-publisher.ts`, `src/execution/formatter-suggestions.ts`, `src/handlers/review-idempotency.ts`, `src/execution/mcp/review-output-publication-gate.ts`, `src/lib/sanitizer.ts`
  - Verify: bun test ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000

- [x] **T02: Implement no-op and idempotency skip publication gates** `est:45m`
  Use installed skills in task-plan frontmatter: `test-driven-development`, `tdd`, `verify-before-complete`.

Why: R081 requires a publisher that can be safely retried without duplicate batched reviews, and S04 needs truthful no-op behavior when S2 produced no safe suggestions.

Steps:
1. Add RED tests in `src/execution/formatter-suggestion-publisher.test.ts` proving an empty `suggestions` array returns `status: "no-suggestions"`, `posted: 0`, carries any provided S02 `skipped` diagnostics/counts, and never calls `createReview` or the publication gate.
2. Add RED tests with a fake `ReviewOutputPublicationGate` resolving `shouldPublish: false`, `publicationState: "skip-existing-output"`, `existingLocation: "review"`, and `idempotencyDecision: "skip-existing-review"`; assert the publisher returns `status: "skipped"`, exposes the idempotency fields, and never calls `createReview`.
3. Implement publication-gate resolution only when both `reviewOutputKey` and at least one suggestion are present. If no gate is injected, create one with `createReviewOutputPublicationGate({ owner, repo, prNumber, reviewOutputKey })`.
4. Ensure the posted result also includes idempotency status when the gate allows publication, so S04 can distinguish first publish from duplicate skip.
5. Run `bun test ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` until the no-op/idempotency tests and T01 tests pass.

Must-haves:
- Empty suggestion batches must not create empty GitHub reviews.
- Duplicate review output keys must skip before body sanitization or GitHub writes.
- The result shape must preserve S02 skipped hunks and S03 skip/idempotency reasons separately enough for S04 partial-failure reporting.

Failure Modes (Q5): dependency `publicationGate.resolve()` rejects => return `failed` with `posted: 0` and bounded error message rather than publishing blindly; dependency returns malformed status is TypeScript-guarded by `ReviewOutputPublicationStatus`; no `reviewOutputKey` means idempotency is not applied.

Load Profile (Q6): shared resource is the idempotency scan over GitHub comments/reviews when no fake gate is injected; per-operation cost is the existing paged scan plus one createReview call; 10x breakpoint is GitHub API quota, so callers should reuse keys and this module should call the gate at most once.

Negative Tests (Q7): empty suggestions, duplicate marker in existing review, gate rejection/throwing path if included, and S02 skipped diagnostics preserved on no-op.
  - Files: `src/execution/formatter-suggestion-publisher.test.ts`, `src/execution/formatter-suggestion-publisher.ts`, `src/execution/mcp/review-output-publication-gate.ts`, `src/handlers/review-idempotency.ts`, `src/execution/formatter-suggestions.ts`
  - Verify: bun test ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000

- [x] **T03: Add outgoing safety checks and whole-batch rejection handling** `est:1h`
  Use installed skills in task-plan frontmatter: `test-driven-development`, `tdd`, `verify-before-complete`.

Why: The risky part of S03 is publishing untrusted repo-derived markdown to GitHub in an all-or-nothing batch. This task closes R077/R081 fixture proof and R084 reporting by proving mention sanitization, secret blocking, and GitHub rejection handling.

Steps:
1. Add RED tests proving `@kodiai`/configured bot handles are stripped from both the review body and inline suggestion bodies before publication, while preserving the suggestion fence structure.
2. Add RED tests proving a token-like secret in either a suggestion body or generated review body returns `status: "blocked"`, `posted: 0`, a non-secret blocked reason/pattern field, and does not call `createReview`.
3. Add RED tests where fake `createReview` throws a GitHub-like `422 Validation Failed` error with a long message; assert the publisher returns `status: "failed"`, `posted: 0`, `failed: true` or equivalent, `rejection.status: 422`, and a bounded sanitized message without falling back to standalone inline comments.
4. Implement sanitization and `scanOutgoingForSecrets()` on the review body and every comment body before calling GitHub. Log only safe structured fields if a logger is provided.
5. Implement `try/catch` around `createReview`, bounded/redacted error formatting, final result types/exports, and run both targeted and regression commands.

Must-haves:
- Safety checks happen after idempotency skip but before GitHub writes.
- Blocked or failed results must never claim any suggestions were posted.
- No fallback to `createReviewComment`, issue comments, branch pushes, commits, or separate PRs is introduced.
- Final verification includes S01/S02 regression files plus the new S03 publisher tests.

Failure Modes (Q5): dependency `scanOutgoingForSecrets` detects a credential pattern => block publication and expose only the pattern name; dependency `createReview` rejects entire batch => failed result with bounded sanitized message; dependency logger throws should not be introduced because logger calls should be optional/best-effort.

Load Profile (Q6): shared resources are one GitHub API call and memory for N suggestion bodies; per-operation cost is O(N) sanitization/secret scanning plus one createReview call; 10x breakpoint is comment payload size or GitHub validation limits, so S02 `maxSuggestions` remains the cap source and S03 reports batch rejection truthfully.

Negative Tests (Q7): bot mention in review and comment bodies, credential-like literal in suggestion code, credential-like literal in review body if helper permits injection, GitHub 422 validation failure, and long error-message truncation/redaction.
  - Files: `src/execution/formatter-suggestion-publisher.test.ts`, `src/execution/formatter-suggestion-publisher.ts`, `src/lib/sanitizer.ts`, `src/execution/formatter-suggestions.ts`
  - Verify: bun test ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000 && bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000

## Files Likely Touched

- src/execution/formatter-suggestion-publisher.test.ts
- src/execution/formatter-suggestion-publisher.ts
- src/execution/formatter-suggestions.ts
- src/handlers/review-idempotency.ts
- src/execution/mcp/review-output-publication-gate.ts
- src/lib/sanitizer.ts
