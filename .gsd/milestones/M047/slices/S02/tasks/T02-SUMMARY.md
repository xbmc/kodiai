---
id: T02
parent: S02
milestone: M047
key_files:
  - src/handlers/identity-suggest.ts
  - src/handlers/identity-suggest.test.ts
  - src/routes/slack-commands.test.ts
  - scripts/verify-m047-s02.ts
  - scripts/verify-m047-s02.test.ts
  - package.json
key_decisions:
  - Use `profileStore.getByGithubUsername(githubUsername, { includeOptedOut: true })` in the identity-suggestion path so opted-out linked rows suppress DMs without re-enabling profile-backed guidance.
  - Prove signed slash continuity and identity-suggestion suppression with a focused `verify:m047:s02` harness instead of widening route dependencies or recalculating continuity inside the route layer.
duration: 
verification_result: mixed
completed_at: 2026-04-11T01:58:37.355Z
blocker_discovered: false
---

# T02: Suppressed opted-out identity suggestion DMs and added signed slash continuity proof coverage.

**Suppressed opted-out identity suggestion DMs and added signed slash continuity proof coverage.**

## What Happened

Fixed the root cause in `src/handlers/identity-suggest.ts` by switching the existing-profile check onto `getByGithubUsername(..., { includeOptedOut: true })`, which lets opted-out linked contributors suppress identity-link DMs without re-enabling profile-backed behavior. Expanded `src/handlers/identity-suggest.test.ts` to cover system-view linked suppression, opted-out suppression, duplicate same-process attempts, malformed Slack DM responses, and missing opted-out-lookup support while continuing to reset in-memory state around each case. Extended `src/routes/slack-commands.test.ts` so the signed Hono route now proves generic continuity for untrusted `link` and `profile opt-in` flows plus active continuity for trusted linked rows. Added the missing `scripts/verify-m047-s02.ts` proof harness, its regression test, and the `verify:m047:s02` package script so future agents can inspect signed-route continuity and identity-suggestion suppression through a stable JSON surface with named status codes.

## Verification

Focused task verification passed with `bun test ./src/handlers/identity-suggest.test.ts ./src/routes/slack-commands.test.ts`, `bun run verify:m047:s02 -- --json`, and `bun run tsc --noEmit`. The broader slice bundle is partially green as expected for an intermediate task: `bun test ./src/contributor/profile-surface-resolution.test.ts ./src/slack/slash-command-handler.test.ts ./src/routes/slack-commands.test.ts ./src/handlers/identity-suggest.test.ts ./src/knowledge/retrieval-query.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./scripts/verify-m045-s03.test.ts ./scripts/verify-m047-s02.test.ts` and `bun run verify:m047:s01 && bun run verify:m045:s03 && bun run verify:m047:s02` still fail only because the existing M045/S03 Slack proof expects pre-S02 continuity copy for `linked-profile` and `profile-opt-in`.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/handlers/identity-suggest.test.ts ./src/routes/slack-commands.test.ts` | 0 | ✅ pass | 62ms |
| 2 | `bun run verify:m047:s02 -- --json` | 0 | ✅ pass | 80ms |
| 3 | `bun test ./src/contributor/profile-surface-resolution.test.ts ./src/slack/slash-command-handler.test.ts ./src/routes/slack-commands.test.ts ./src/handlers/identity-suggest.test.ts ./src/knowledge/retrieval-query.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./scripts/verify-m045-s03.test.ts ./scripts/verify-m047-s02.test.ts` | 1 | ❌ fail | 152ms |
| 4 | `bun run verify:m047:s01 && bun run verify:m045:s03 && bun run verify:m047:s02` | 1 | ❌ fail | 139ms |
| 5 | `bun run tsc --noEmit` | 0 | ✅ pass | 7900ms |

## Deviations

Added the missing `verify:m047:s02` proof harness, its test file, and `package.json` script wiring because the task and slice verification contract already required that command even though it was absent from the repo snapshot.

## Known Issues

`bun run verify:m045:s03` and `scripts/verify-m045-s03.test.ts` still fail because the older M045/S03 Slack verifier expects the pre-S02 `linked-profile` and `profile-opt-in` copy. That pre-existing drift remains follow-on work for the slice; the new T02 identity suppression path, dedicated `verify:m047:s02` harness, and `bun run tsc --noEmit` all pass.

## Files Created/Modified

- `src/handlers/identity-suggest.ts`
- `src/handlers/identity-suggest.test.ts`
- `src/routes/slack-commands.test.ts`
- `scripts/verify-m047-s02.ts`
- `scripts/verify-m047-s02.test.ts`
- `package.json`
