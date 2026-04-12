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

### M044 — Audit Recent XBMC Review Correctness
- Status: queued
- Added: 2026-04-08
- Summary: Audit the most recent ~12 Kodiai-reviewed `xbmc/xbmc` PRs across automatic and explicit review lanes, distinguish valid clean approvals from missing or unpublished findings using GitHub-visible and internal publication evidence, fix any defects exposed by the audit, and leave behind a repeatable audit/verification surface.
- Context: `.gsd/milestones/M044/M044-CONTEXT.md`

### M045 — Contributor Experience Product Contract and Architecture
- Status: queued
- Added: 2026-04-08
- Summary: Define the long-term contributor-experience product contract, decide how contributor status should affect Kodiai across all tier-related surfaces, and implement the architectural unification needed to express that contract coherently.
- Context: `.gsd/milestones/M045/M045-CONTEXT.md`

### M046 — Contributor Tier Calibration and Fixture Audit
- Status: queued
- Added: 2026-04-08
- Summary: Build an xbmc/xbmc-first contributor fixture set, evaluate Kodiai's current scoring and percentile tiering against that evidence under the M045 contract, and produce an explicit calibration verdict.
- Context: `.gsd/milestones/M046/M046-CONTEXT.md`

### M047 — Contributor Experience Redesign and Calibration Rollout
- Status: queued
- Added: 2026-04-08
- Summary: Ship the contributor-experience redesign and approved recalibration across review, retrieval, Slack, and contributor-model plumbing, then prove cross-surface coherence end to end.
- Context: `.gsd/milestones/M047/M047-CONTEXT.md`

### M048 — PR Review Latency Reduction and Bounded Execution
- Status: queued
- Added: 2026-04-10
- Summary: Reduce end-to-end PR review latency on the live xbmc/kodiai path by measuring phase timing, trimming serial overhead, tuning large-PR behavior honestly, and exploring parallel review fan-out only if cheaper wins are insufficient.
- Context: `.gsd/milestones/M048/M048-CONTEXT.md`

### M049 — Evidence-Backed Clean PR Approvals
- Status: queued
- Added: 2026-04-11
- Summary: Replace marker-only clean approval reviews with one short evidence-backed GitHub review body across explicit mention, automatic review, and approve-via-comment paths, while preserving findings publication behavior and avoiding separate clean-approval issue comments.
- Roadmap: `.gsd/milestones/M049/M049-ROADMAP.md`
- Context: pending depth-gated save
