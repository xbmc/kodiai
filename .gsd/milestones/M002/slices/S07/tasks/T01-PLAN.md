# T01: 17-write-mode-reliability 01

**Slice:** S07 — **Milestone:** M002

## Description

Strengthen write-mode reliability by adding idempotency and lightweight in-process locking so redeliveries and retries do not create duplicate branches/PRs.

## Must-Haves

- [ ] "Write-mode is idempotent for a given trigger comment (redeliveries do not create extra PRs)"
- [ ] "Concurrent or repeated write intents for the same comment are skipped with an existing PR link"
- [ ] "Locking/idempotency does not affect non-write mention replies"

## Files

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/jobs/workspace.ts`
