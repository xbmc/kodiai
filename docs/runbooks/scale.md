# Scale Runbook

Use this runbook when very large PRs (many files), very long conversation threads (many issue comments), or very long PR descriptions cause timeouts, missing context, or unexpected skips.

## Symptoms

- **Timeouts:** review/mention execution ends with a timeout error (often after several minutes).
- **Partial context:** the model appears to miss prior discussion, repeats questions, or ignores older decisions.
- **Explicit truncation note:** prompts include a `## Scale Notes` section indicating caps were hit.
- **Auto-approval unexpectedly skipped:** clean PRs with `review.autoApprove: true` do not get an approval, and logs mention a scan cap.
- **Idempotency seems off:** duplicate review output on a replayed delivery (should be prevented by the review-output marker).

## Where Scale Guardrails Live

### Prompt/context caps (prompt-size control)

- Mention conversation context builder: `src/execution/mention-context.ts`
  - Comment count cap: `DEFAULT_MAX_COMMENTS` (option `maxComments`)
  - Per-comment body cap: `DEFAULT_MAX_COMMENT_CHARS` (option `maxCommentChars`)
  - Total conversation characters cap: `DEFAULT_MAX_CONVERSATION_CHARS` (option `maxConversationChars`)
  - Pagination safety cap: `DEFAULT_MAX_API_PAGES` (option `maxApiPages`)
  - PR body cap: `DEFAULT_MAX_PR_BODY_CHARS` (option `maxPrBodyChars`)
  - Degradation signal: emits `## Scale Notes` when caps are hit.

- Review system prompt builder: `src/execution/review-prompt.ts`
  - PR title cap: `DEFAULT_MAX_TITLE_CHARS`
  - PR description cap: `DEFAULT_MAX_PR_BODY_CHARS`
  - Changed-files list cap: `DEFAULT_MAX_CHANGED_FILES`
  - Degradation signal: emits `## Scale Notes` when caps are hit.

### Pagination (API correctness + avoiding silent partial reads)

- Review idempotency marker scans: `src/handlers/review-idempotency.ts`
  - Uses paginated list calls to scan for `<!-- kodiai:review-output-key:... -->` markers.

- Auto-approve “did we post any inline comments?” scan: `src/handlers/review.ts`
  - Uses paginated list calls and safety caps.
  - If the scan hits a cap, auto-approval is skipped (safe degradation).

### Execution time/turn caps (runtime control)

- Repo config parsing: `src/execution/config.ts`
  - `.kodiai.yml` supports `maxTurns` and `timeoutSeconds`.

- Claude execution wrapper: `src/execution/executor.ts`
  - Enforces `maxTurns` and applies a timeout derived from `timeoutSeconds`.

## How to Reproduce / Diagnose

### 1) Confirm the PR/thread is actually “large”

From any machine with `gh` authenticated:

```sh
# Count issue comments on the PR (PRs are issues)
gh api repos/<owner>/<repo>/issues/<prNumber>/comments --paginate --jq 'length' \
  | awk '{s+=$1} END {print s}'

# Count review comments on the PR (inline diff comments)
gh api repos/<owner>/<repo>/pulls/<prNumber>/comments --paginate --jq 'length' \
  | awk '{s+=$1} END {print s}'

# Count files changed (cheap proxy; requires git clone)
git diff --name-only origin/<base>...HEAD | wc -l
```

Interpretation:

- `issues/.../comments` > 100 means a single non-paginated call would miss data.
- `pulls/.../comments` > 100 means inline-comment scans must paginate.
- Thousands of changed files can bloat the system prompt if not capped.

### 2) Look for explicit scale degradation notes

The system is designed to degrade explicitly. Search logs or captured prompts for:

- `## Scale Notes`
- `truncated`
- `scan capped`

If you see these, context was intentionally bounded; investigate whether the defaults are appropriate for the repo/PR size.

### 3) Verify pagination is being used for list endpoints

If you suspect a regression, confirm that calls include paging parameters (`per_page`, `page`) and are not relying on a single default page.

For local testing, you can reproduce the shape of the REST endpoints with `gh api`:

```sh
gh api repos/<owner>/<repo>/issues/<prNumber>/comments?per_page=100\&page=1 --jq 'length'
gh api repos/<owner>/<repo>/issues/<prNumber>/comments?per_page=100\&page=2 --jq 'length'

gh api repos/<owner>/<repo>/pulls/<prNumber>/comments?per_page=100\&page=1 --jq 'length'
gh api repos/<owner>/<repo>/pulls/<prNumber>/comments?per_page=100\&page=2 --jq 'length'
```

## How to Tune Safely

### 1) Increase runtime limits first (no prompt-size explosion)

In the target repo’s `.kodiai.yml`, tune execution limits conservatively:

```yml
maxTurns: 25
timeoutSeconds: 300
```

Guidance:

- Increase `timeoutSeconds` if the job times out but progress is being made.
- Increase `maxTurns` if the model runs out of turns before completing tool calls.
- Prefer small increments (e.g. +60s, +5 turns) and re-test.

### 2) Treat prompt/context cap increases as a code change

Context caps are intentionally conservative to prevent unbounded prompt growth.
If you raise caps, do it in small steps and keep the explicit `## Scale Notes` behavior.

- Mention context caps: `src/execution/mention-context.ts`
- Review prompt caps: `src/execution/review-prompt.ts`

Rules of thumb:

- Raising `maxComments` without raising `maxConversationChars` may not increase useful context (the total cap will still truncate).
- Raising per-comment caps increases injection surface area; keep sanitization in place.
- Keep pagination caps bounded; do not switch to unbounded `--paginate all pages` behavior in production paths.

### 3) Auto-approval safety behavior

If auto-approval is being skipped due to scan caps on huge PRs, that is an intentional safety choice.
Options (in order of preference):

1) Disable auto-approval for that repo via `.kodiai.yml`.
2) Increase scan caps in `src/handlers/review.ts` (still keep a hard cap).
3) Accept that very large PRs may not get silent approvals and require manual review.

## Expected Outcome After Fixes

- Large PRs do not cause unbounded prompt growth.
- When caps are hit, the prompt includes an explicit `## Scale Notes` section.
- GitHub list APIs that can exceed one page are called with pagination parameters.
- Operators can identify whether behavior is a timeout, a deliberate cap, or a real bug.
