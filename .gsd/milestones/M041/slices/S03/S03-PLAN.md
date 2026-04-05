# S03: Incremental Refresh and Audit/Repair

**Goal:** Add steady-state freshness: selective updates on change plus audit/repair for stale, missing, and model-mismatched canonical rows.
**Demo:** After this: After this slice, Kodiai keeps the canonical corpus fresh via changed-file updates and can prove drift detection and selective repair without full-repo rebuilds.

## Tasks
- [x] **T01: Added a dedicated canonical-code selective refresh path that preserves unchanged rows, updates changed chunks, and reports steady-state counters.** — - Implement a changed-file refresh path that reprocesses only touched files or changed chunks.
- Reuse canonical chunk identity and content hashes to avoid rewriting unchanged rows.
- Keep the normal update path separate from one-time backfill semantics.
  - Estimate: 1d
  - Files: src/knowledge/canonical-code-update.ts, src/knowledge/canonical-code-update.test.ts, src/knowledge/canonical-code-store.ts, src/knowledge/canonical-code-backfill.ts
  - Verify: bun test ./src/knowledge/canonical-code-update.test.ts && bun run tsc --noEmit
- [ ] **T02: Extend audit and repair for canonical corpus drift** — - Extend audit and repair flows to cover the canonical current-code corpus.
- Detect stale, missing, and model-mismatched canonical rows.
- Repair only the affected rows or files, fail-open on per-file failures, and keep the existing audit/repair patterns intact.
  - Estimate: 1d
  - Files: src/knowledge/embedding-audit.ts, src/knowledge/embedding-repair.ts, scripts/embedding-audit.ts, scripts/embedding-repair.ts, src/knowledge/canonical-code-store.ts
  - Verify: bun test ./scripts/embedding-audit.test.ts && bun test ./scripts/embedding-repair.test.ts
- [ ] **T03: Add selective-update and repair verifier** — - Add the milestone-level verifier for selective updates and repair.
- Cover unchanged-file preservation, drift detection, and selective repair outcomes.
- Emit machine-checkable proof output that can close the milestone without requiring a full live repo rebuild.
  - Estimate: 0.5-1d
  - Files: scripts/verify-m041-s03.ts, scripts/verify-m041-s03.test.ts, src/knowledge/canonical-code-update.ts, src/knowledge/embedding-audit.ts, src/knowledge/embedding-repair.ts
  - Verify: bun test ./scripts/verify-m041-s03.test.ts && bun run verify:m041:s03 -- --json
