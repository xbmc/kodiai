# T01: 11-mention-ux-parity 01

**Slice:** S01 — **Milestone:** M002

## Description

Enable global @claude alias support for mention triggers, with a per-repo opt-out. Ensure empty/ack-only mentions do not create reply comments.

Purpose: Replace @claude GitHub Actions mentions without retraining dev muscle memory.
Output: Config-driven aliasing, robust mention parsing/stripping, and tests.

## Must-Haves

- [ ] "@claude is accepted as an alias for @kodiai by default"
- [ ] "A repo can opt out of @claude aliasing via .kodiai.yml"
- [ ] "Mentions that contain no question after stripping do not produce a reply"

## Files

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/mention-types.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention-types.test.ts`
