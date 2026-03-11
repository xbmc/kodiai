# S01: Mention Ux Parity

**Goal:** Enable global @claude alias support for mention triggers, with a per-repo opt-out.
**Demo:** Enable global @claude alias support for mention triggers, with a per-repo opt-out.

## Must-Haves


## Tasks

- [x] **T01: 11-mention-ux-parity 01** `est:5 min`
  - Enable global @claude alias support for mention triggers, with a per-repo opt-out. Ensure empty/ack-only mentions do not create reply comments.

Purpose: Replace @claude GitHub Actions mentions without retraining dev muscle memory.
Output: Config-driven aliasing, robust mention parsing/stripping, and tests.
- [x] **T02: 11-mention-ux-parity 02** `est:5 min`
  - Restore contextual mention replies (conversation + PR context) while keeping tracking as eyes-only. Improve answer quality compared to the current minimal-context mention prompt.

Purpose: Match @claude mention UX (contextual answers) without relying on GitHub Actions sandboxed posting.
Output: Context builder + prompt updates + tests.
- [x] **T03: 11-mention-ux-parity 03** `est:5 min`
  - Add inline thread replies for PR review comment mentions so responses show up in the exact review comment thread (parity with xbmc/xbmc @claude UX).

Purpose: Developers expect replies to inline comments to stay in-thread.
Output: New MCP tool + routing + tests.
- [x] **T04: 11-mention-ux-parity 04** `est:2h 46m`
  - Verify mention UX end-to-end against real GitHub surfaces and write a short runbook for operators/maintainers.

Purpose: Ensure xbmc devs get the expected in-thread replies and contextual answers.
Output: Human-verified behavior + a runbook.

## Files Likely Touched

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/mention-types.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention-types.test.ts`
- `src/handlers/mention.ts`
- `src/execution/mention-prompt.ts`
- `src/lib/sanitize.ts`
- `src/lib/toctou.ts`
- `src/execution/mention-context.ts`
- `src/execution/mention-context.test.ts`
- `src/execution/mcp/review-comment-thread-server.ts`
- `src/execution/mcp/index.ts`
- `src/execution/mention-prompt.ts`
- `src/handlers/mention.ts`
- `src/execution/mcp/review-comment-thread-server.test.ts`
- `docs/runbooks/mentions.md`
