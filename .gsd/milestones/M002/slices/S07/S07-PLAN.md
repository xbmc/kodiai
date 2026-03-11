# S07: Write Mode Reliability

**Goal:** Strengthen write-mode reliability by adding idempotency and lightweight in-process locking so redeliveries and retries do not create duplicate branches/PRs.
**Demo:** Strengthen write-mode reliability by adding idempotency and lightweight in-process locking so redeliveries and retries do not create duplicate branches/PRs.

## Must-Haves


## Tasks

- [x] **T01: 17-write-mode-reliability 01** `est:20 min`
  - Strengthen write-mode reliability by adding idempotency and lightweight in-process locking so redeliveries and retries do not create duplicate branches/PRs.
- [x] **T02: 17-write-mode-reliability 02** `est:15 min`
  - Improve write-mode reliability for private single-replica usage by focusing on user-visible clarity and safer behavior under expected failures, without adding distributed infrastructure.

## Files Likely Touched

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/jobs/workspace.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/jobs/workspace.ts`
- `docs/runbooks/mentions.md`
