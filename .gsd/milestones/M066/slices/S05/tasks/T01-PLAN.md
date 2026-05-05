---
estimated_steps: 5
estimated_files: 7
skills_used:
  - github-bot
  - github-workflows
  - gh
  - test-driven-development
  - verify-before-complete
---

# T01: Add formatter suggestion live verifier with tests

skills_used frontmatter expectation: `github-bot`, `github-workflows`, `gh`, `test-driven-development`, `verify-before-complete`.

Build the machine-readable proof gate for R085. Start test-first in `scripts/verify-m066-s05.test.ts`, then implement `scripts/verify-m066-s05.ts` following the existing verifier style rather than adding a separate framework. The verifier must parse `--repo`, `--review-output-key`, optional `--delivery-id`, `--json`, and `--help`; reject malformed/mismatched args before network access; require `parseReviewOutputKey(key)?.action === "mention-format-suggestions"`; use GitHub App auth from `GITHUB_APP_ID` plus `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_BASE64`; list PR reviews and review comments for the PR encoded by the key; find exactly one matching PR review body containing `<!-- kodiai:review-output-key:<key> -->`; require the review source to be a Pull Request Review with `COMMENTED` state; require at least one associated review comment for that review id whose body contains a fenced ```suggestion block; and emit a report with PR URL, review URL/id, first suggestion comment URL/id, artifact counts, status code, preflight access state, and issues. Add `"verify:m066:s05": "bun scripts/verify-m066-s05.ts"` to `package.json`.

Failure Modes (Q5): GitHub App auth missing should return a named missing-access status without printing secret values; GitHub API failures should return a named unavailable status with bounded error text; malformed API data should fail closed with issues explaining which required proof field was absent.

Load Profile (Q6): The verifier performs bounded paginated GitHub reads against one PR (reviews and review comments, 100/page). The 10x breakpoint is GitHub API rate limiting on repeated smoke attempts, so the implementation should avoid repository-wide scans and should stop after enough pages to prove or disprove the specific reviewOutputKey.

Negative Tests (Q7): Cover missing review-output-key, malformed key, wrong action (`mention-review`), delivery-id mismatch, repo mismatch, missing GitHub env, duplicate matching reviews, wrong review state, issue-comment-only/standalone surfaces not satisfying proof, no suggestion-fenced comments, and a happy path with one COMMENTED review plus one suggestion comment.

## Inputs

- `scripts/verify-m049-s02.ts`
- `scripts/verify-m065-s02.ts`
- `src/handlers/review-idempotency.ts`
- `src/review-audit/review-output-artifacts.ts`
- `package.json`

## Expected Output

- `scripts/verify-m066-s05.ts`
- `scripts/verify-m066-s05.test.ts`
- `package.json`

## Verification

bun test ./scripts/verify-m066-s05.test.ts --timeout 30000 && bunx tsc --noEmit --pretty false && bunx eslint scripts/verify-m066-s05.ts scripts/verify-m066-s05.test.ts

## Observability Impact

Adds `bun run verify:m066:s05 -- --json`, whose report must expose proof status, artifact URLs/ids, matched reviewOutputKey, delivery id, and bounded failure reasons while redacting secrets.
