---
estimated_steps: 5
estimated_files: 4
skills_used:
  - test-driven-development
  - tdd
  - verify-before-complete
---

# T03: Add outgoing safety checks and whole-batch rejection handling

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

## Inputs

- `src/execution/formatter-suggestion-publisher.ts`
- `src/execution/formatter-suggestion-publisher.test.ts`
- `src/lib/sanitizer.ts`

## Expected Output

- `src/execution/formatter-suggestion-publisher.ts`
- `src/execution/formatter-suggestion-publisher.test.ts`

## Verification

bun test ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000 && bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000

## Observability Impact

Adds failure-path diagnostics for blocked outgoing content and GitHub whole-batch rejection: status, posted zero, safe pattern/rejection fields, bounded sanitized error message, and no secret values.
