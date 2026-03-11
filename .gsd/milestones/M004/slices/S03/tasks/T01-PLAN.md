# T01: 28-knowledge-store-explicit-learning 01

**Slice:** S03 — **Milestone:** M004

## Description

Create the SQLite-backed knowledge store that persists review findings, metrics, and suppression history. This is the storage foundation for Phase 28.

Purpose: All other Phase 28 features (suppression tracking, confidence scoring, metrics display, CLI reporting) need a place to persist and query data. The knowledge store follows the exact same factory pattern as the existing telemetry store.

Output: `createKnowledgeStore()` factory function with types, schema, and comprehensive tests.

## Must-Haves

- [ ] "Knowledge store persists review records with metrics (files analyzed, lines changed, finding counts by severity)"
- [ ] "Knowledge store persists individual findings with severity, category, confidence, file path, and suppression status"
- [ ] "Knowledge store persists suppression log entries showing which patterns fired per review"
- [ ] "Knowledge store provides repo-level stats queries (total reviews, findings by severity, top files)"
- [ ] "Knowledge store provides daily trend data for time-series analysis"

## Files

- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`
