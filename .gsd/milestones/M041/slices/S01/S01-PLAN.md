# S01: Canonical Schema, Chunking, and Storage

**Goal:** Create the canonical corpus foundations: dedicated schema, chunk identity, exclusion rules, and storage semantics that are explicitly separate from historical diff-hunk snippets.
**Demo:** After this: After this slice, Kodiai can ingest a fixture repo snapshot into dedicated canonical-corpus tables and show current-code chunks with explicit repo/ref/commit provenance.

## Tasks
- [x] **T01: Validated and tightened the canonical code corpus schema and store contract, including SQL-enforced chunk/backfill invariants and passing store/type verification.** — - Add the first canonical-corpus migration with dedicated tables and indexes.
- Define explicit types for canonical chunk identity, provenance, and replacement semantics.
- Implement a store module that is clearly separate from historical snippet storage.
  - Estimate: 0.5-1d
  - Files: src/db/migrations/033-canonical-code-corpus.sql, src/knowledge/canonical-code-types.ts, src/knowledge/canonical-code-store.ts, src/knowledge/canonical-code-store.test.ts
  - Verify: bun test ./src/knowledge/canonical-code-store.test.ts && bun run tsc --noEmit
- [x] **T02: Added a dedicated canonical code chunker with auditable exclusion reasons, function/class/module boundaries, and symbol-poor C++ block fallback.** — - Implement a canonical chunker for function/class/module fallback boundaries.
- Add explicit exclusion rules for generated files, vendored code, lockfiles, and build outputs.
- Keep chunking logic independent from historical diff-hunk chunking so semantics do not blur.
  - Estimate: 0.5-1d
  - Files: src/knowledge/canonical-code-chunker.ts, src/knowledge/canonical-code-chunker.test.ts, src/knowledge/code-snippet-chunker.ts
  - Verify: bun test ./src/knowledge/canonical-code-chunker.test.ts
- [x] **T03: Added a dedicated canonical snapshot ingest path with fixture-proven replacement, dedup, exclusion, and historical-store separation semantics.** — - Build a fixture-driven ingest path that turns parsed files into canonical rows.
- Prove idempotent replacement behavior using content hash and chunk identity.
- Verify canonical ingest never writes into historical diff-hunk tables.
  - Estimate: 0.5-1d
  - Files: src/knowledge/canonical-code-ingest.ts, src/knowledge/canonical-code-ingest.test.ts, src/knowledge/canonical-code-store.ts, src/knowledge/canonical-code-chunker.ts
  - Verify: bun test ./src/knowledge/canonical-code-ingest.test.ts
