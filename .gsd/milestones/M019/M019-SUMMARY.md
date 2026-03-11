---
id: M019
milestone: M019
verification_result: passed
completed_at: migrated
---

# M019: Intelligent Retrieval Enhancements

**Migrated from v0.19 milestone summary**

## What Happened

## v0.19 Intelligent Retrieval Enhancements (Shipped: 2026-02-25)

**Scope:** 4 phases (93-96), 14 plans
**Timeline:** 2026-02-25
**Source:** [Issue #42](https://github.com/xbmc/kodiai/issues/42)
**Files modified:** 92 (12,746 insertions, 152 deletions)

**Key accomplishments:**
- Language-aware retrieval boosting with 61-extension classification map, proportional multi-language boost, related-language affinity, and backward-compatible schema migration with backfill script
- Specialized [depends] deep-review pipeline for Kodi-convention dependency bump PRs with three-tier changelog fallback, consumer impact analysis, hash/URL verification, transitive dependency checks, and structured review comments
- Unrelated CI failure recognition using Checks API base-branch comparison with flakiness history tracking, structured annotation comments, and no-noise policy (silent on clean PRs)
- Hunk-level code snippet embedding as 4th retrieval corpus with content-hash SHA-256 deduplication, configurable per-PR hunk cap, and fire-and-forget integration in the review handler
- Cross-corpus retrieval expanded from 3 to 4 sources with unified RRF ranking, per-corpus source weights, and [snippet] labels alongside [code], [review], [wiki]

---
