# M053: Formatter Suggestion Reviews — Context Draft

**Status:** Draft discussion in progress

## Confirmed Scope

The user wants Kodiai to generate committable GitHub suggestions for formatting fixes on the same PR. This is inspired by a `jenkins4kodi` comment on `xbmc/xbmc#28259`, but Kodiai must not depend on Jenkins artifacts. Kodiai should compute formatting suggestions independently from the PR workspace.

Included:
- The formatter-suggestion capability should always be accessible by explicit mention.
- A default-off repo config flag controls automatic inclusion during reviews, not whether explicit requests are allowed.
- Explicit mention commands:
  - `@kodiai format suggestions`
  - `@kodiai suggest formatting fixes`
  - `@kodiai review & format suggestions`
- Same-PR GitHub suggested changes, so authors/maintainers can click GitHub's built-in "Commit suggestion" flow.
- No separate branch or formatting-fix PR.
- No bot-authored commits unless a human applies suggestions through GitHub.
- Batched output: ideally one PR review containing multiple inline suggestion comments.
- Limit posted suggestions to avoid spam.
- First formatter target can be clang-format-style flow, but design should keep a generic formatter-adapter seam.

Excluded:
- Consuming `jenkins4kodi` diff artifact links.
- Creating a follow-up PR with formatting fixes.
- Pushing commits directly to contributor branches.

## Confirmed Architecture

- Formatter source: repo-configured formatter command, not Jenkins and not prompt-only.
- Posting behavior: direct publish on explicit request.
- Publication shape: one batched PR review with multiple inline suggestion comments where GitHub accepts them.
- Suggestion generation: deterministic formatter diff to GitHub suggestion conversion. Claude should not invent formatting hunks.
- Combined mode `@kodiai review & format suggestions` runs normal review and formatter suggestions as independent subflows under one mention intent. Formatter failure must not block normal review publication; review failure must not block formatter suggestions if they can run safely.
- Formatter suggestion review should likely be a separate GitHub review object from the normal review output, but on the same PR.

## Error Handling Strategy

- Explicit formatter requests are always recognized.
- If no formatter command is configured, explicit request gets a concise setup-needed response.
- Automatic formatter suggestions only run when repo config opts in.
- Empty formatter output produces no suggestion review and a concise no-op response.
- Invalid/unmappable hunks are skipped; never guessed or repaired by Claude.
- Only post hunks that map cleanly to PR diff line/range and valid GitHub suggestion blocks.
- Cap suggestions by config.
- Partial success posts valid suggestions and logs/publicly counts skipped hunks.
- Whole GitHub batch rejection posts one concise failure/skip comment and logs details; no fallback spam of standalone comments in the first version.

## Codebase / Research Notes

- `src/execution/mcp/inline-review-server.ts` already supports single inline comments with GitHub suggestion blocks via `pulls.createReviewComment`.
- `src/execution/review-prompt.ts` already instructs the agent to include suggestion blocks when it has a concrete fix.
- To satisfy the user's preference for one output with multiple inline suggestions, the implementation likely needs a batched review path using GitHub's pull request review API rather than looping over standalone `createReviewComment` calls.
- GitHub suggestion blocks must be attached to a valid PR diff line/range and replace the entire selected range.
