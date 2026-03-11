---
id: M022
milestone: M022
verification_result: passed
completed_at: migrated
---

# M022: Issue Intelligence

**Migrated from v0.22 milestone summary**

## What Happened

## v0.22 Issue Intelligence (Shipped: 2026-02-27)

**Scope:** 4 phases (106-109), 7 plans
**Timeline:** 2026-02-27
**Source:** [Issue #74](https://github.com/xbmc/kodiai/issues/74)
**Files modified:** 57 (9,629 insertions, 875 deletions)
**Git range:** v0.21..v0.22
**Requirements:** 19/19 satisfied (1 gap fixed during audit)

**Key accomplishments:**
- Historical issue corpus population via backfill script for xbmc/xbmc with Voyage AI embeddings, HNSW-indexed vectors, PR filtering, and cursor-based resume
- Nightly incremental sync via GitHub Actions cron job for issues and comments updated since last sync
- High-confidence duplicate detection with top-3 candidate formatting (similarity scores, titles, open/closed status), fail-open design, and comment-only policy (never auto-closes)
- Auto-triage on `issues.opened` with config gate (`autoTriageOnOpen`), four-layer idempotency (delivery-ID dedup, atomic DB claim with cooldown, comment marker scan), and duplicate detection integration
- PR-issue linking via explicit reference parsing (fixes/closes/relates-to regex) and semantic search fallback when no references found, with linked issue context injected into review prompts
- Issue corpus wired as 5th source in unified cross-corpus RRF retrieval with hybrid search (vector + BM25), per-trigger weight tuning, `[issue: #N] Title (status)` citations, and dedup

---
