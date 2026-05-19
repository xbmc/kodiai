# Queue

## Pending Milestones

### M027 — Embedding Integrity & Timeout Hardening
- Status: queued
- Added: 2026-03-11
- Summary: Audit all persisted embedding corpora in production, verify query-time retrieval is actually using embeddings, and harden the online repair/backfill paths so they stop timing out.
- Context: `.gsd/milestones/M027/M027-CONTEXT.md`

### M028 — Wiki Modification-Only Publishing
- Status: queued
- Added: 2026-03-11
- Summary: Replace suggestion-style wiki update output with concrete modification artifacts, keep only minimal citations/metadata, support hybrid section/full-page publishing, and retrofit existing published wiki comments.
- Context: `.gsd/milestones/M028/M028-CONTEXT.md`

### M029 — Wiki Generation Quality & Issue Cleanup
- Status: queued
- Added: 2026-03-16
- Summary: Fix LLM outputting reasoning prose instead of actual wiki replacement text, tighten PR evidence → page targeting to filter irrelevant matches, clean up xbmc/wiki issue #5 (delete junk comments), and re-run generation/publication with quality-gated output.
- Context: `.gsd/milestones/M029/M029-CONTEXT.md`

### M031 — Security Hardening
- Status: queued
- Added: 2026-03-28
- Summary: Defense-in-depth against credential exfiltration: agent env allowlist, git remote token sanitization, outgoing secret scan on all publish paths, prompt-level refusal instructions, CLAUDE.md security policy in workspace.
- Context: `.gsd/milestones/M031/M031-CONTEXT.md`

### M032 — Agent Process Isolation
- Status: queued
- Added: 2026-03-29
- Summary: Move Claude agent subprocess into an ephemeral Azure Container Apps Job with zero application secrets. MCP servers exposed over authenticated HTTP from the orchestrator. Workspace shared via Azure Files mount. Orchestrator polls ACA Job API for completion and reads result.json. Closes the /proc/<ppid>/environ attack path confirmed in post-M031 security testing.
- Context: `.gsd/milestones/M032/M032-CONTEXT.md`

### M053 — Unsafe `new Function()` Removal
- Status: queued
- Added: 2026-04-20
- Summary: Remove the unsafe dynamic evaluator surface from `src/`, preserve the operator proof intent, and enforce the no-`new Function()` invariant with `verify:m053`.
- Context: GitHub issue #92

### M054 — GSD v2 Planning Artifact Repair
- Status: queued
- Added: 2026-04-20
- Summary: Reconcile stale queue state, reconstruct missing retrospective milestone artifacts, and repair verifier/rationale coverage for completed historical milestones.
- Context: GitHub issue #93

### M055 — Top-Level Docs Accuracy Pass
- Status: queued
- Added: 2026-04-20
- Summary: Align README, CHANGELOG, LICENSE, CONTRIBUTING, docs index, and runbooks with the current shipped product and verifier contracts.
- Context: GitHub issue #94

### M056 — Migration Rollback Completeness
- Status: queued
- Added: 2026-04-20
- Summary: Add missing down migrations for historical schema changes and enforce that new migrations ship paired rollback scripts.
- Context: GitHub issue #95

### M057 — Core Handler & Webhook Test Backfill
- Status: queued
- Added: 2026-04-20
- Summary: Backfill high-value tests across webhook routing, core handlers, fork/gist behavior, and orphaned workspace test coverage.
- Context: GitHub issue #96

### M058 — CI Workflow Hardening
- Status: queued
- Added: 2026-04-20
- Summary: Broaden CI coverage, pin the Bun/runtime contract, and add lint, orphan-test, and migration-down gates.
- Context: GitHub issue #97

### M059 — Script Registry & Orphan Audit
- Status: queued
- Added: 2026-04-20
- Summary: Create a truthful script registry and sweep orphaned scripts so operational entrypoints have explicit ownership and status.
- Context: GitHub issue #98

### M060 — Knowledge Subsystem Test Backfill
- Status: queued
- Added: 2026-04-20
- Summary: Backfill direct tests for central knowledge subsystem files and clarify the ownership boundary with M027 embedding-integrity work.
- Context: GitHub issue #99

### M074 — Clawpatch Inspired Review Workflow and Inline Fix Evidence
- Status: queued
- Added: 2026-05-18
- Summary: Incorporate Clawpatch-inspired durable finding lifecycle, same-PR inline fix evidence, and validation/revalidation proof into Kodiai's existing review flow without porting Clawpatch or expanding default write authority.
- Context: `.gsd/milestones/M074/M074-CONTEXT.md`

## Not Pending

Completed milestone history is tracked in `.gsd/PROJECT.md` and each milestone's committed `.gsd/milestones/<MID>/` artifacts when present. Do not list completed milestones in the pending queue.

Clearly shipped milestones that must stay out of Pending Milestones include M044, M045, M046, M047, M048, M049, M050, M051, and M052.
