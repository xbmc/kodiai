---
id: T01
parent: S03
milestone: M026
provides:
  - docs/architecture.md — comprehensive system design documentation for contributors
key_files:
  - docs/architecture.md
key_decisions:
  - Knowledge system gets one-paragraph overview + forward link to knowledge-system.md (S04 owns detail)
  - Included scheduled background systems and lifecycle/shutdown sections beyond the minimum spec — these are essential for contributors understanding operational behavior
patterns_established:
  - Documentation sections follow: overview → module map → request lifecycles → data layer → abstractions → subsystems
observability_surfaces:
  - none
duration: 15m
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---

# T01: Write architecture.md — system design and module map

**Created docs/architecture.md covering system design, all 20 src/ modules, both request lifecycles, data layer, key abstractions, and knowledge system overview with forward link.**

## What Happened

Wrote docs/architecture.md from source analysis of src/index.ts (wiring graph), webhook/router.ts (dispatch pattern), handlers/review.ts and mention.ts (request flows), and execution/executor.ts (LLM engine). The doc covers:

- **Overview**: Kodiai as a webhook-driven GitHub App with Hono + PostgreSQL/pgvector
- **Module Map**: 20-entry table covering all src/ directories with purpose and key files
- **Review Lifecycle**: 12-step flow from webhook receipt through LLM execution to comment publishing, plus decision points (incremental reviews, large PR triage, dep bumps, guardrails, auto-approval, fork write mode)
- **Mention Lifecycle**: Full flow from comment detection through context building, knowledge retrieval, MCP-enabled execution, to sanitized reply publishing, plus behaviors (write mode, conversation tracking, issue context, triage, troubleshooting)
- **Data Layer**: Connection model (single shared pool), 13-entry store table, embedding models (voyage-code-3, voyage-context-3)
- **Key Abstractions**: Event router, job queue, workspace manager, executor, task router, retriever, isolation layer
- **Knowledge System**: One-paragraph overview of 5-corpus system with forward link to knowledge-system.md
- **Scheduled Background Systems**: Wiki sync, staleness detector, popularity scorer, cluster scheduler
- **Lifecycle and Shutdown**: Graceful shutdown with webhook queue persistence and replay
- **HTTP API Surface**: All 6 endpoints

## Verification

- `test -f docs/architecture.md` — PASS
- `grep -c '##' docs/architecture.md` — 22 (≥5 required) — PASS
- `grep -c 'knowledge-system.md' docs/architecture.md` — 1 (≥1 required) — PASS
- `grep -c 'PostgreSQL\|pgvector' docs/architecture.md` — 6 (≥1 required) — PASS
- Module map entries: 20 (≥15 required) — PASS

### Slice-level checks (intermediate — T01 of 3):
- architecture.md exists — PASS
- configuration.md exists — EXPECTED FAIL (T02)
- docs/README.md exists — EXPECTED FAIL (T03)
- architecture.md sections ≥5 — PASS (22)

## Diagnostics

None — documentation-only task with no runtime changes.

## Deviations

Added three sections beyond the task plan spec (Scheduled Background Systems, Lifecycle and Shutdown, HTTP API Surface) because they are essential for contributor understanding and naturally fit the architecture document.

## Known Issues

None.

## Files Created/Modified

- `docs/architecture.md` — comprehensive architecture documentation (20 modules, 2 request lifecycles, data layer, key abstractions, knowledge system overview)
