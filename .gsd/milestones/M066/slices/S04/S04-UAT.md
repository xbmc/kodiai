# S04: Explicit and combined request orchestration — UAT

**Milestone:** M066
**Written:** 2026-05-05T01:22:02.379Z

## UAT: S04 Explicit and Combined Formatter Suggestion Orchestration

### Preconditions

1. A test PR exists with at least one file changed on the PR branch.
2. Kodiai is configured with `review.formatterSuggestions.command` that can emit a git unified diff against the checked-out workspace.
3. `review.formatterSuggestions.maxSuggestions` is set to a small known value, for example `10`.
4. The Kodiai GitHub App installation has permission to create Pull Request Reviews and issue comments.
5. For failure-path tests, the operator can temporarily set the formatter command to an invalid command or a command that exits non-zero.

### Test Case 1 — Format-only request bypasses Claude

1. Comment on the PR: `@kodiai format suggestions`.
2. Wait for the mention job to complete.
3. Inspect operator logs for the mention completion event.

Expected outcomes:

- The request is classified as formatter mode `format-only`.
- No Claude executor run is started for this mention.
- The formatter subflow runs with PR identity, workspace refs, configured command, and `maxSuggestions`.
- If suggestions map safely, exactly one formatter Pull Request Review is created with inline GitHub suggestion blocks.
- No extra success issue comment is posted when the formatter Pull Request Review is successfully created.

### Test Case 2 — Format-only setup-needed diagnostic

1. Remove or blank `review.formatterSuggestions.command` in the repo config.
2. Comment on the PR: `@kodiai suggest formatting fixes`.
3. Wait for the mention job to complete.

Expected outcomes:

- Claude is not invoked.
- No formatter command is executed.
- Kodiai posts a bounded setup guidance reply explaining that a formatter command must be configured.
- Structured logs report `formatterStatus: setup-needed` and `visibleReplyPosted: true` without raw command output.

### Test Case 3 — Combined review and formatter success

1. Restore a working formatter command.
2. Comment on the PR: `@kodiai review & format suggestions`.
3. Wait for the review job to complete.
4. Inspect GitHub PR reviews/comments and operator logs.

Expected outcomes:

- Normal explicit review routing is preserved, including review task type and inline-tool enablement.
- The normal review result is published or falls back exactly as the existing explicit review path dictates.
- After normal review work, the formatter subflow runs separately.
- Formatter suggestions, if any, publish through one batched Pull Request Review using formatter-specific idempotency.
- Logs include independent review fields (`reviewConclusion`, `publishResolution`) and formatter fields (`formatterStatus`, `commandStatus`, `publisherStatus`, suggestion/skipped/capped counts).

### Test Case 4 — Review failure does not suppress formatter

1. Trigger a combined request in an environment where the Claude executor returns a failure result or throws after workspace/config setup.
2. Keep the formatter command valid.
3. Comment: `@kodiai review & format suggestions`.

Expected outcomes:

- Kodiai still attempts the formatter subflow after the review failure condition is known and workspace/config/PR identity are available.
- Formatter suggestions can still publish if mapper/publisher conditions are safe.
- The original review failure behavior is preserved through the existing review fallback/error path.
- Logs mark the run as a combined partial failure rather than reporting a single collapsed success/failure.

### Test Case 5 — Formatter failure does not suppress review

1. Configure the formatter command to exit non-zero or time out.
2. Comment: `@kodiai review & format suggestions`.
3. Wait for the job to complete.

Expected outcomes:

- Normal explicit review still executes and publishes/falls back normally.
- Formatter failure is surfaced as a bounded visible diagnostic when appropriate.
- Logs include `formatterStatus: failed` and `commandStatus: failed` or `timed-out`.
- Raw formatter stdout and full stderr are not present in GitHub comments or logs.

### Test Case 6 — Duplicate/idempotent formatter publication

1. Trigger a successful formatter suggestion request once.
2. Re-trigger the same formatter suggestion request against the same PR head commit.

Expected outcomes:

- The second run uses the formatter-specific review-output key and detects the existing formatter output.
- No duplicate formatter Pull Request Review is created.
- The formatter subflow result reports duplicate/skipped status independently of normal review idempotency.

### Edge Cases

- If the formatter emits no diff, expected status is `no-op` with no unsafe publication.
- If the PR diff cannot be collected, expected status is `pr-diff-unavailable` with a visible diagnostic.
- If formatter hunks do not map cleanly to PR RIGHT-side lines, expected status is `mapped-no-suggestions` with skipped-count/reason summary.
- If mapped suggestions exceed `maxSuggestions`, only capped safe suggestions are attempted and capped counts are logged/reported.
- If publisher/GitHub rejects the batch, no standalone comment-loop fallback, branch push, bot commit, or new PR is created.
