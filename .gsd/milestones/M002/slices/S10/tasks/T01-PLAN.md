# T01: 20-next-improvements 01

**Slice:** S10 — **Milestone:** M002

## Description

Ship the next set of quality improvements: better write-mode UX (update PR when possible), stronger guardrails, clearer observability, optional delivery metadata, and basic CI.

## Must-Haves

- [ ] "Write-mode updates the existing PR branch when possible; falls back to bot PR otherwise"
- [ ] "Secret/policy guardrails block high-risk writes with clear refusal messages"
- [ ] "Operators can tell exactly why output was skipped from one evidence line"
- [ ] "PRs run CI (tests + typecheck)"

## Files

- `src/handlers/mention.ts`
- `src/jobs/workspace.ts`
- `src/execution/config.ts`
- `src/execution/mcp/comment-server.ts`
- `docs/runbooks/mentions.md`
- `docs/runbooks/review-requested-debug.md`
- `.github/workflows/ci.yml`
