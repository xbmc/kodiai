# S07: Remediate deployed formatter-suggestion mention path and live proof — UAT

**Milestone:** M066
**Written:** 2026-05-05T05:37:20.934Z

## UAT: S07 deployed formatter-suggestion mention path

### Preconditions

- GitHub App credentials are available to the verifier through the existing environment without printing secret values.
- `xbmc/kodiai#134` remains accessible and contains the captured formatter proof from delivery `462ed8c0-4843-11f1-8135-1c6010084b2c`.
- The smoke artifact `docs/smoke/m066-formatter-suggestions.md` is present and records the active revision `ca-kodiai--deploy-20260504-222417`.
- The PR-head test config contains `review.formatterSuggestions.command`; `main` does not need automatic formatter configuration for this explicit-request proof.

### Test Case 1 — Verify accepted live proof

1. Run:
   ```bash
   bun run verify:m066:s05 -- --repo xbmc/kodiai --review-output-key "kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-134:action-mention-format-suggestions:delivery-462ed8c0-4843-11f1-8135-1c6010084b2c:head-df017da6b6959038a288f8eae070b7a384ef0fa4" --delivery-id "462ed8c0-4843-11f1-8135-1c6010084b2c" --json
   ```
2. Expected: command exits 0.
3. Expected: JSON includes `success: true` and `status_code: "m066_s05_ok"`.
4. Expected: JSON proof points at PR #134, Pull Request Review `4225484818`, and first suggestion comment `3186219778`.
5. Expected: `issues` is an empty array.

### Test Case 2 — Confirm GitHub surface is the required same-PR suggestion review

1. Open or inspect `https://github.com/xbmc/kodiai/pull/134#pullrequestreview-4225484818`.
2. Expected: the review is on PR #134, not a new PR, branch push, bot commit, issue comment, or standalone comment.
3. Expected: the review state is COMMENTED.
4. Expected: the review body contains the formatter review-output marker for the captured `mention-format-suggestions` key.
5. Open or inspect `https://github.com/xbmc/kodiai/pull/134#discussion_r3186219778`.
6. Expected: the associated review comment contains a fenced GitHub `suggestion` block and is tied to the same Pull Request Review.

### Test Case 3 — Confirm deployed runtime and observable formatter subflow evidence

1. Inspect `docs/smoke/m066-formatter-suggestions.md`.
2. Expected: Status is `Accepted`.
3. Expected: active revision is `ca-kodiai--deploy-20260504-222417`.
4. Expected: `/healthz` is recorded as HTTP 200 with `{"status":"ok","db":"connected"}`.
5. Expected: `/readiness` is recorded as HTTP 200 with `{"status":"ready"}`.
6. Expected: bounded logs for delivery `462ed8c0-4843-11f1-8135-1c6010084b2c` include `Format-only formatter suggestion request completed` with `formatterStatus=posted`, `commandStatus=success`, `publisherStatus=posted`, `suggestions=1`, `skipped=0`, `capped=0`, `posted=1`, and `publisherSkipped=0`.

### Test Case 4 — Regression gate for mention routing and safety invariants

1. Run:
   ```bash
   bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000
   bunx tsc --noEmit --pretty false
   bunx eslint src/handlers/mention.ts src/handlers/formatter-suggestion-orchestration.ts src/execution/formatter-suggestions.ts src/execution/formatter-suggestion-publisher.ts scripts/verify-m066-s05.ts scripts/verify-m066-s05.test.ts
   ```
2. Expected: tests report 190 pass / 0 fail.
3. Expected: TypeScript exits 0.
4. Expected: ESLint exits 0.
5. Expected: formatter-only requests still bypass Claude/write mode, combined review-and-format requests still preserve normal review routing, and publisher/verifier failure modes remain bounded.

### Edge Cases

- If the verifier reports `missing_github_access`, treat it as an environment/access blocker, not proof failure; do not print or request secret values in logs.
- If a future explicit formatter trigger emits a generic `Mention execution completed` log without formatter status fields, classify it as a trigger/routing regression before investigating mapper or GitHub acceptance.
- If a proof review exists but lacks a fenced `suggestion` review comment or is not a COMMENTED Pull Request Review on the encoded PR, `verify:m066:s05` must fail closed rather than accepting issue-comment-only or wrong-surface evidence.
- If `main` lacks formatter config, smoke PRs must carry the formatter command on the PR head because Kodiai loads repo config from the checked-out head.
