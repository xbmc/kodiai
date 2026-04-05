# S02: Default-Branch Backfill and Semantic Retrieval

**Goal:** Build the one-time default-branch backfill path and retrieval surface that make the canonical corpus actually useful to downstream review systems.
**Demo:** After this: After this slice, Kodiai can backfill a repo's default branch once and answer review-style semantic queries from the canonical current-code corpus with provenance-preserving results.

## Tasks
- [x] **T01: Added a resumable default-branch canonical code backfill pipeline with fail-open per-file/per-chunk handling and explicit progress counters.** — - Resolve the repo's canonical default-branch snapshot using existing workspace access patterns.
- Build a one-time backfill job that walks eligible files and writes canonical chunks.
- Keep the path fail-open and bounded when parsing or embedding individual files fails.
  - Estimate: 1d
  - Files: src/knowledge/canonical-code-backfill.ts, src/knowledge/canonical-code-backfill.test.ts, src/jobs/workspace.ts, src/knowledge/canonical-code-ingest.ts
  - Verify: bun test ./src/knowledge/canonical-code-backfill.test.ts && bun run tsc --noEmit
- [ ] **T02: Add canonical semantic retrieval with provenance** — - Add a retrieval module for canonical current-code chunks with provenance-rich results.
- Integrate it alongside existing retrieval orchestration without collapsing historical and canonical corpora.
- Ensure returned matches carry enough metadata for downstream bounded prompt packing.
  - Estimate: 1d
  - Files: src/knowledge/canonical-code-retrieval.ts, src/knowledge/canonical-code-retrieval.test.ts, src/knowledge/retrieval.ts, src/knowledge/code-snippet-retrieval.ts
  - Verify: bun test ./src/knowledge/canonical-code-retrieval.test.ts
- [ ] **T03: Add end-to-end backfill and retrieval verifier** — - Add an end-to-end verifier for M041/S02 covering one-time backfill plus review-style retrieval.
- Use a production-like fixture repo snapshot or equivalent fixture package.
- Prove retrieval hits canonical current-code rows rather than historical diff-hunk rows.
  - Estimate: 0.5-1d
  - Files: scripts/verify-m041-s02.ts, scripts/verify-m041-s02.test.ts, src/knowledge/canonical-code-backfill.ts, src/knowledge/canonical-code-retrieval.ts
  - Verify: bun test ./scripts/verify-m041-s02.test.ts && bun run verify:m041:s02 -- --json
