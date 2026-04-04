# S01: Generated Rule Schema, Store, and Proposal Candidates

**Goal:** Build the generated-rule persistence and proposal substrate: schema, store, clustering inputs, and candidate generation from positive feedback patterns.
**Demo:** After this: After this slice, Kodiai can persist generated rules and produce bounded pending-rule candidates from clustered learning memories.

## Tasks
- [x] **T01: Added generated-rule persistence with lifecycle transitions and repo-level lifecycle counts.** — - Add generated-rule schema and store surfaces for pending/active/retired lifecycle state.
- Keep generated rules separate from raw learning-memory records.
- Add tests for persistence and lifecycle-state transitions.
  - Estimate: 0.5-1d
  - Files: src/db/migrations/035-generated-rules.sql, src/knowledge/generated-rule-store.ts, src/knowledge/generated-rule-store.test.ts
  - Verify: bun test ./src/knowledge/generated-rule-store.test.ts && bun run tsc --noEmit
- [x] **T02: Added deterministic pending-rule proposal generation from clustered learning-memory feedback.** — - Build proposal-candidate generation from clustered positive learning-memory patterns.
- Reuse existing cluster-matcher and cluster-pipeline helpers where they fit.
- Bound cluster minimums and proposal text inputs so sparse/noisy patterns do not generate rules.
  - Estimate: 1d
  - Files: src/knowledge/generated-rule-proposals.ts, src/knowledge/generated-rule-proposals.test.ts, src/knowledge/cluster-matcher.ts, src/knowledge/cluster-pipeline.ts
  - Verify: bun test ./src/knowledge/generated-rule-proposals.test.ts
- [x] **T03: Added a fail-open generated-rule proposal sweep plus a pure-code proof harness for representative positive-cluster proposals.** — - Add the sweep entrypoint that reads learning memories, produces proposal candidates, and persists pending rules.
- Keep the sweep fail-open and background-oriented.
- Add a verifier proving proposals are created from representative positive clusters.
  - Estimate: 0.5-1d
  - Files: src/knowledge/generated-rule-sweep.ts, src/knowledge/generated-rule-sweep.test.ts, scripts/verify-m036-s01.ts, scripts/verify-m036-s01.test.ts
  - Verify: bun test ./src/knowledge/generated-rule-sweep.test.ts && bun test ./scripts/verify-m036-s01.test.ts
