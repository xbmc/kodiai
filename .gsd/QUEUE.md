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
