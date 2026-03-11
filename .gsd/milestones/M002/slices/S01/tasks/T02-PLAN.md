# T02: 11-mention-ux-parity 02

**Slice:** S01 — **Milestone:** M002

## Description

Restore contextual mention replies (conversation + PR context) while keeping tracking as eyes-only. Improve answer quality compared to the current minimal-context mention prompt.

Purpose: Match @claude mention UX (contextual answers) without relying on GitHub Actions sandboxed posting.
Output: Context builder + prompt updates + tests.

## Must-Haves

- [ ] "Mention replies use surrounding conversation context filtered to trigger timestamp"
- [ ] "Inline PR review comment mentions include file/line/diff hunk context"
- [ ] "Eyes reaction remains the only tracking signal (no tracking comment)"
- [ ] "The model is instructed to not post ack/tracking comments and to always reply to a mention (or ask clarifying questions)"

## Files

- `src/handlers/mention.ts`
- `src/execution/mention-prompt.ts`
- `src/lib/sanitize.ts`
- `src/lib/toctou.ts`
- `src/execution/mention-context.ts`
- `src/execution/mention-context.test.ts`
