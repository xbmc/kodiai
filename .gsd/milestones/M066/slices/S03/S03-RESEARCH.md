# S03 Research — Batched same-PR suggestion review publisher

## Summary

S03 should be a targeted implementation: the risky API shape is GitHub Pull Request Reviews, but the codebase already has the two key seams needed for a small, testable publisher:

- `src/execution/formatter-suggestions.ts` already produces S03-ready `FormatterSuggestionPayload[]` with `path`, `line`, optional `startLine`, `side: "RIGHT"`, `suggestionBody`, and source metadata.
- `src/handlers/review-idempotency.ts` already provides marker building and cross-surface duplicate detection (`ensureReviewOutputNotPublished`) over review comments, issue comments, and reviews.

Build a new deterministic publisher around `octokit.rest.pulls.createReview`, not an MCP tool and not a loop of `createReviewComment`. The publisher should take the S02 payloads, sanitize/secret-scan each suggestion body, add one review-level idempotency marker to the review body, and call `createReview` once with `event: "COMMENT"` plus a `comments` array.

## Requirements Targeted

S03 owns or directly advances:

- **R077** — same-PR committable GitHub suggested changes. S03 can prove the payload is a same-PR PR review, but live committability remains S05.
- **R081** — one batched PR review with multiple inline suggestion comments. This is the primary S03 requirement.

S03 supports downstream:

- **R080** — S04 combined request orchestration needs this publisher as the formatter publication subflow.
- **R084** — publisher result shape should expose posted/skipped/failed/rejection data so S04 can report partial failures truthfully.

Memory lookup for prior notes failed with `database disk image is malformed`, matching the S02 summary. Do not rely on the memory store for this slice.

## Skill / Docs Notes

- Used the `using-superpowers` process skill before action; relevant rule for the planner/executors is to invoke applicable skills before work and not skip workflow discipline.
- Used the installed `github-bot` skill to confirm GitHub API/write-operation conventions. It is directly relevant for later S05 live smoke or manual GitHub writes, but S03 fixture work should not generate live tokens or write to GitHub.
- Skill discovery for `Octokit GitHub REST API` found no clearly better directly relevant installable skill. Results were generic/low-relevance (`vercel-labs/emulate@github`, `winsorllc/...@github-ops`, etc.); do not install them for S03.
- Context7 docs for `@octokit/rest` confirm `pulls.get({ mediaType: { format: "diff" } })` is already the right way to fetch PR diffs for S02/S04. Official GitHub docs confirm `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` supports `commit_id`, `body`, `event`, and `comments[]` with `path`, `body`, `line`, `side`, `start_line`, and `start_side` fields. `event: COMMENT` requires a review body; leaving `event` blank creates a pending review, so S03 should set `event: "COMMENT"`.

## Implementation Landscape

### Existing S02 formatter contract

File: `src/execution/formatter-suggestions.ts`

Important exported types/functions:

- `FormatterSuggestionPayload`:
  - `path: string`
  - `line: number`
  - `startLine?: number`
  - `side: "RIGHT"`
  - `suggestionBody: string` containing a fenced GitHub suggestion block
  - source/debug metadata: `oldStart`, `oldEnd`, `newStart`, `hunkHeader`
- `MapFormatterDiffToSuggestionsResult`:
  - `suggestions: FormatterSuggestionPayload[]`
  - `skipped: FormatterDiffSkip[]`
  - `counts` with generated/skipped/capped/parser/candidate totals
  - `capped: boolean`
- `mapFormatterDiffToSuggestions()` already validates against a PR RIGHT-side commentability index before cap enforcement.

Planner should treat S02 output as trusted-but-still-to-be-sanitized outgoing markdown. S03 does not need to parse diffs or revalidate PR line commentability; that already belongs to S02.

### Existing idempotency seam

File: `src/handlers/review-idempotency.ts`

Important exports:

- `buildReviewOutputKey(input)` builds a deterministic output key from installation/repo/PR/action/delivery/head.
- `buildReviewOutputMarker(reviewOutputKey)` returns `<!-- kodiai:review-output-key:<key> -->`.
- `ensureReviewOutputNotPublished({ octokit, owner, repo, prNumber, reviewOutputKey })` scans:
  - PR review comments via `pulls.listReviewComments`
  - issue comments via `issues.listComments`
  - PR reviews via `pulls.listReviews`
- It returns a `ReviewOutputPublicationStatus` with `shouldPublish`, `existingLocation`, `idempotencyDecision`, `scanStats`, and marker.

Use this seam directly or via `src/execution/mcp/review-output-publication-gate.ts`. The MCP gate caches the check per instance; a pure publisher can either accept an optional `ReviewOutputPublicationGate` for tests/reuse or call `ensureReviewOutputNotPublished` once.

Important idempotency detail: review-level markers must be in the PR review `body` because `pulls.listReviews` scans review bodies. Do not rely only on inline comment bodies; the requirement says one batched review and the duplicate check should find the batch as a review.

### Existing publication/sanitization patterns

Files:

- `src/execution/mcp/inline-review-server.ts`
- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/review-comment-thread-server.ts`
- `src/lib/sanitizer.ts`

Patterns to reuse:

- `sanitizeOutgoingMentions(body, botHandles)` before GitHub publication.
- `scanOutgoingForSecrets(body)` before GitHub publication; block and return a structured error instead of posting.
- Existing inline comments add `buildReviewOutputMarker(reviewOutputKey)` to body and log `already-published-skip` / `published` outcomes.
- Existing `createInlineReviewServer` already maps `startLine` to GitHub `start_line` and sets `start_side` when multi-line.

S03 should be a trusted-code publisher, not an LLM-facing MCP tool. The formatter suggestions are deterministic, and S04 will call the publisher from orchestration.

### Natural new file seam

Recommended new module:

- `src/execution/formatter-suggestion-publisher.ts`
- `src/execution/formatter-suggestion-publisher.test.ts`

Suggested public API:

```ts
export type FormatterSuggestionPublishStatus =
  | "posted"
  | "skipped"
  | "no-suggestions"
  | "blocked"
  | "failed";

export interface PublishFormatterSuggestionsOptions {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  commitId: string; // S04 can pass PR head SHA; tests can provide fixture SHA
  suggestions: FormatterSuggestionPayload[];
  skipped?: FormatterDiffSkip[];
  reviewOutputKey?: string;
  botHandles?: string[];
  logger?: Logger;
  publicationGate?: ReviewOutputPublicationGate;
}
```

The exact names can vary, but keep a single pure entry point returning a structured result with:

- `status`: posted/skipped/no-suggestions/blocked/failed
- `posted`: number of suggestions posted
- `skipped`: count and/or grouped reasons from S02 plus S03-local skips
- `failed`: boolean or count
- `reviewId`, `reviewUrl` when GitHub returns them
- `reviewOutputKey` and `markerStatus`/`idempotencyDecision` when applicable
- `errorMessage` sanitized/bounded on whole-batch rejection

## GitHub API Constraints

From GitHub REST docs for creating a pull request review:

- Endpoint: `octokit.rest.pulls.createReview({ owner, repo, pull_number, commit_id, body, event, comments })`.
- `event` should be `"COMMENT"` for a submitted non-approval review containing formatter suggestions.
- `body` is required when event is `COMMENT`; it should include the Kodiai marker and a concise summary.
- `comments[]` supports modern line-based fields: `path`, `body`, `line`, `side`, `start_line`, `start_side`.
- Older `position` is still documented, but S02 already maps RIGHT-side line numbers, and existing `createInlineReviewServer` uses `line`/`start_line`; follow that pattern.
- GitHub returns `422` for validation failures or spam/rate limiting. Treat this as a whole-batch rejection for S03; do not silently fallback to standalone comments unless a future decision explicitly allows it.

Expected comment mapping from `FormatterSuggestionPayload`:

```ts
const comment = {
  path: suggestion.path,
  body: sanitizedSuggestionBody,
  line: suggestion.line,
  side: suggestion.side, // RIGHT
  ...(suggestion.startLine
    ? { start_line: suggestion.startLine, start_side: suggestion.side }
    : {}),
};
```

Review body should be separate from inline suggestion bodies, for example:

```md
Kodiai formatter suggestions for this PR.

Posted: 3 suggestions.
Skipped: 2 formatter hunks (1 target-range-not-in-pr-diff, 1 pure-insertion).

<!-- kodiai:review-output-key:... -->
```

Do not put the marker only in one inline comment; use the review body so `listReviews` idempotency scan can find the batch.

## Risks / Pitfalls

- **All-or-nothing GitHub rejection:** `createReview` can reject the entire comments array if any line/range is invalid. S02 reduces this risk, but S03 still needs tests for catching `Validation Failed`/`422` and returning `status: "failed"` with `posted: 0`.
- **Idempotency action naming:** S04 will likely need a formatter-specific review output key action such as `mention-format-suggestions`, not the existing `mention-review`, so format-only and normal review outputs do not suppress each other. S03 can stay agnostic and accept a key, but tests should prove repeated same key skips.
- **Marker location:** Existing `ensureReviewOutputNotPublished` scans review comment bodies first, issue comments second, review bodies third. A batched review should be found in review bodies if the marker is in `body`. Inline comments may or may not carry marker; avoid duplicating marker in every inline suggestion unless needed.
- **Outgoing secret scanner false positives:** Formatter suggestion blocks are code. A formatter diff could include a token-like literal. Existing outgoing policy blocks publication when a credential pattern is present. S03 should block before GitHub write and report `matchedPattern` internally/logged, but visible text should not echo secrets.
- **Mention loops:** Even deterministic suggestions can contain `@kodiai` in code/comments; use `sanitizeOutgoingMentions` on review body and inline bodies like existing MCP servers.
- **No-suggestions flow:** If S02 returns zero safe suggestions, publisher should not create an empty review. Return a no-op result so S04 can publish concise no-op guidance separately if desired.
- **Review body secret scanning:** Scan both the review body and every inline suggestion body. A marker is safe; suggestion body is untrusted formatter output from repo code.
- **S05 remains necessary:** Fixture tests cannot prove GitHub renders `suggestion` fences as committable. Do not mark R077 fully validated until live smoke.

## Suggested Task Decomposition

1. **Publisher contract and payload builder tests first**
   - Add `formatter-suggestion-publisher.test.ts` with a fake Octokit.
   - Prove multiple S02 payloads become one `pulls.createReview` call with `event: "COMMENT"`, shared `commit_id`, review body marker, and a `comments` array.
   - Include one single-line and one multi-line suggestion to prove `start_line`/`start_side` mapping.

2. **Idempotency and no-op gates**
   - Use a fake publication gate or fake `listReviewComments`/`listReviews` responses.
   - Prove same `reviewOutputKey` returns skipped and does not call `createReview`.
   - Prove empty suggestions return `no-suggestions` and do not call GitHub.

3. **Security and rejection handling**
   - Prove `@kodiai` is stripped from review/comment bodies.
   - Prove token-like content blocks publication before `createReview`.
   - Prove thrown GitHub errors return structured failed/rejection result with sanitized/bounded message and no claimed posted count.

4. **Exports for S04**
   - Export the publisher and result types from the new module. No orchestration wiring is necessary in S03 unless the planner intentionally pulls a small integration test into scope.

## Verification Plan

Targeted S03 command:

```bash
bun test ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000
```

Regression command including S01/S02 context:

```bash
bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000
```

If S03 touches idempotency helpers or MCP publication code, also run:

```bash
bun test ./src/handlers/review-idempotency.test.ts ./src/execution/mcp/inline-review-server.test.ts ./src/execution/mcp/comment-server.test.ts --timeout 30000
```

## Recommendation

Implement S03 as a narrow, deterministic `publishFormatterSuggestionReview()` module with fake-Octokit tests. Reuse `FormatterSuggestionPayload`, `buildReviewOutputMarker`, `ensureReviewOutputNotPublished`/`ReviewOutputPublicationGate`, `sanitizeOutgoingMentions`, and `scanOutgoingForSecrets`. Keep S03 independent from mention/review orchestration; S04 should own fetching PR head SHA, building formatter-specific review output keys, running S02, and deciding what user-visible no-op/failure summaries to post.