# S05: S05 — UAT

**Milestone:** M066
**Written:** 2026-05-05T01:56:18.428Z

## UAT: M066 S05 Formatter-Suggestion Operational Proof

### Preconditions

1. A controlled smoke PR exists in a repository where the Kodiai GitHub App is installed.
2. The PR includes a commentable changed line and a `.kodiai.yml` formatter-suggestion config with `review.formatterSuggestions.automatic: false`, `maxSuggestions: 1`, and a deterministic command that emits a git unified diff to stdout.
3. The operator environment has `GITHUB_APP_ID` and either `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_BASE64` available without printing secret values.
4. The operator can capture the GitHub webhook delivery id, deployed revision/log correlation fields, formatter `reviewOutputKey`, PR review URL/id, and suggestion comment URL/id.

### Test Case 1 — Explicit format-only trigger posts a same-PR suggestion

1. On the controlled PR, comment `@kodiai format suggestions`.
2. Wait for the deployed handler to complete the formatter subflow.
3. Expected: Kodiai creates a Pull Request Review on the same PR, not a new PR, branch push, standalone commit, or issue-comment-only response.
4. Expected: The PR review body includes `<!-- kodiai:review-output-key:<captured-key> -->` where the key action is `mention-format-suggestions`.
5. Expected: At least one associated inline review comment contains a fenced ```suggestion block that GitHub renders as a committable suggestion.

### Test Case 2 — Machine-readable verifier accepts only the real formatter review

1. Export the captured identifiers as `M066_S05_REPO`, `M066_S05_REVIEW_OUTPUT_KEY`, and optionally `M066_S05_DELIVERY_ID`.
2. Run `bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --delivery-id "$M066_S05_DELIVERY_ID" --json` when a delivery id is available, otherwise omit `--delivery-id`.
3. Expected: JSON contains `"success": true`, `"status_code": "m066_s05_ok"`, a PR URL, formatter review URL/id, first suggestion comment URL/id, and bounded artifact counts.
4. Expected: The verifier proves a Pull Request Review with `COMMENTED` state and an associated inline suggestion comment; it must not accept issue comments or standalone PR comments.

### Test Case 3 — Combined review and format request preserves independent subflows

1. On a fresh trigger comment or new PR head commit, comment `@kodiai review & format suggestions`.
2. Expected: Normal review behavior and formatter-suggestion behavior are reported independently.
3. Expected: Formatter logs include bounded `formatterStatus`, `commandStatus`, `publisherStatus`, `suggestions`, `skipped`, `capped`, `posted`, `publisherSkipped`, and `publisherFailed` fields.
4. Expected: A formatter failure does not suppress the normal review fallback/publication, and a normal review error does not prevent the formatter subflow from running when workspace/config/PR identity are available.

### Test Case 4 — Automatic-mode documentation boundary

1. Read `docs/configuration.md` and `docs/runbooks/formatter-suggestions.md`.
2. Expected: `review.formatterSuggestions.automatic` is documented as boolean default false and reserved for later automatic-review inclusion until that path is wired and smoked.
3. Expected: The docs describe explicit triggers as operational and do not claim normal automatic PR reviews currently publish formatter suggestions.

### Edge Cases

- Missing GitHub App credentials: verifier returns a named missing-access status without printing secret values.
- Wrong review-output key action such as `mention-review`: verifier fails before network access.
- Delivery id mismatch: verifier fails before network access.
- Duplicate matching PR reviews: verifier fails closed rather than choosing one arbitrarily.
- Matching review without fenced suggestion comment: verifier fails with a no-suggestion proof issue.
- Formatter emits unsafe, unmappable, or excessive hunks: docs and logs expose skipped/capped/failed counts instead of silently claiming success.
