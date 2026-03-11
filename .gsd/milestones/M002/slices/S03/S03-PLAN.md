# S03: Xbmc Cutover

**Goal:** Cut over xbmc/xbmc from @claude GitHub Actions to Kodiai GitHub App with immediate usability: install, webhook wire-up, and smoke tests.
**Demo:** Cut over xbmc/xbmc from @claude GitHub Actions to Kodiai GitHub App with immediate usability: install, webhook wire-up, and smoke tests.

## Must-Haves


## Tasks

- [x] **T01: 13-xbmc-cutover 01** `est:1min`
  - Cut over xbmc/xbmc from @claude GitHub Actions to Kodiai GitHub App with immediate usability: install, webhook wire-up, and smoke tests.

Purpose: Ensure devs can keep using @claude (alias) and get inline-thread replies and contextual answers.
Output: A cutover runbook and verified installation/webhook delivery.
- [x] **T02: 13-xbmc-cutover 02** `est:10 min`
  - Turn off the old @claude GitHub Actions workflows and validate Kodiai provides at least equivalent developer experience.

Purpose: Eliminate sandbox-posting failures and consolidate to a single system.
Output: Old workflows removed and smoke-tested parity.
- [x] **T03: 13-xbmc-cutover 03** `est:8 min`
  - Create a concise xbmc-specific ops runbook covering the new Kodiai behavior, common failure modes, and how to gather evidence.

Purpose: Keep maintainers self-sufficient after cutover.
Output: Runbook for xbmc operators.

## Files Likely Touched

- `docs/runbooks/xbmc-cutover.md`
- `docs/runbooks/xbmc-ops.md`
