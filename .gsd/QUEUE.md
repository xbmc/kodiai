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

### M039 — Review Output Hardening — Intent Parsing + Claude Usage Visibility
- Status: queued
- Added: 2026-04-04
- Summary: Tighten PR body/template stripping so Keyword parsing only reports real breaking-change intent, switch Claude usage display in Review Details to weekly percent-left, and add deterministic regression tests plus a real xbmc fixture to lock both failures down.
- Context: `.gsd/milestones/M039/M039-CONTEXT.md`

### M036 — Auto Rule Generation from Feedback
- Status: queued
- Added: 2026-04-04
- Summary: Cluster learning_memories by embedding similarity; surface high-positive-signal clusters as auto-proposed rules; inject ACTIVE rules into review prompt's custom instructions. Full lifecycle: PENDING → ACTIVE → RETIRED. Auto-activation above configurable confidence threshold.
- Context: `.gsd/milestones/M036/M036-CONTEXT.md`

### M037 — Embedding-Based Suggestion Clustering & Reinforcement Learning
- Status: queued
- Added: 2026-04-04
- Summary: Build a per-repo cluster model from learning memories (positive and negative signals). Score draft findings against cluster centroids before comment creation — suppress findings similar to persistently-negative clusters, boost confidence for findings similar to persistently-positive clusters. Ephemeral per-run adjustments, cached cluster model with 24h TTL.
- Context: `.gsd/milestones/M037/M037-CONTEXT.md`

### M040 — Graph-Backed Extensive Review Context
- Status: queued
- Added: 2026-04-04
- Summary: Build a persistent structural graph on Kodiai’s existing stack to compute blast radius, likely affected tests, and dependency-aware minimal review context for large/extensive PRs. Use graph signals to improve deep-review selection and add an optional Octopus-style second-pass validation gate for graph-amplified findings. This milestone is the graph substrate that should precede and narrow M038.
- Context: `.gsd/milestones/M040/M040-CONTEXT.md`

### M041 — Canonical Repo-Code Corpus
- Status: queued
- Added: 2026-04-04
- Summary: Build a canonical default-branch code corpus for current code at HEAD: function/class/module chunks with commit/ref provenance, one-time backfill, incremental merge updates, and audit/repair scans. This milestone is a sibling substrate to M040 and the semantic-current-code prerequisite for M038.
- Context: `.gsd/milestones/M041/M041-CONTEXT.md`

### M038 — AST Call-Graph Impact Analysis
- Status: queued
- Added: 2026-04-04
- Summary: Review-time consumer milestone for M040 and M041. Queries graph blast-radius signals plus canonical current-code retrieval to produce bounded Structural Impact output, semantically relevant unchanged-code evidence, and evidence-backed breaking-change detection for C++ and Python first.
- Context: `.gsd/milestones/M038/M038-CONTEXT.md`
