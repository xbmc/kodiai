# T01: 29-feedback-capture 01

**Slice:** S04 — **Milestone:** M004

## Description

Add the storage and correlation foundation for LEARN-05 so reaction feedback can be tied back to exact Kodiai findings deterministically.

Purpose: Phase 29 needs durable finding-to-comment linkage and append-only feedback storage before any sync job can capture thumbs reactions reliably.

Output: Knowledge store schema/types and review persistence wiring updated to support deterministic correlation and idempotent feedback writes.

## Must-Haves

- [ ] "Each persisted finding from Kodiai PR review comments has deterministic comment linkage (comment id/surface/output key)"
- [ ] "Thumbs-up and thumbs-down feedback can be stored per repo with finding context and without duplicates across retries"
- [ ] "Feedback persistence remains additive and non-fatal, with no automatic changes to live review behavior"

## Files

- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
