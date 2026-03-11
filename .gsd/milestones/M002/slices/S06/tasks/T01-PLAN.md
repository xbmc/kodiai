# T01: 16-write-guardrails 01

**Slice:** S06 — **Milestone:** M002

## Description

Add safety guardrails for mention-driven writes: path policy, secret detection blocks, and basic rate limiting.

## Must-Haves

- [ ] "Write-mode remains opt-in and requires explicit write intent"
- [ ] "Writes are blocked for denied paths and suspicious secrets"
- [ ] "Write-mode has basic rate limiting to reduce accidental spam"

## Files

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/jobs/workspace.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `docs/runbooks/mentions.md`
