---
id: S04
parent: M027
milestone: M027
provides:
  - Milestone-closing final proof for M027 with one production-wired acceptance command, stable milestone check IDs, and preserved nested S01/S02/S03 evidence.
requires:
  - slice: S01
    provides: Six-corpus audit plus truthful live retriever verification with preserved raw evidence and the audited-only `issue_comments` boundary.
  - slice: S02
    provides: Durable wiki repair-state evidence for `JSON-RPC API/v8` through the bounded `voyage-context-3` repair path.
  - slice: S03
    provides: Durable non-wiki repair-state evidence for `review_comments` through the shared resumable repair/status contract.
affects:
  - M027
key_files:
  - scripts/verify-m027-s04.ts
  - scripts/verify-m027-s04.test.ts
  - docs/operations/embedding-integrity.md
  - .gsd/REQUIREMENTS.md
  - .gsd/milestones/M027/M027-ROADMAP.md
  - .gsd/PROJECT.md
  - .gsd/STATE.md
key_decisions:
  - M027 closes only from the passing live `verify:m027:s04` proof, not from inferred readiness or subordinate slice completion alone.
  - Healthy idempotent reruns remain a pass only when the durable repair-state surfaces still report `repair_completed` with zero failures.
  - `issue_comments` remains an intentional audited-only / repairable boundary and must stay surfaced under `not_in_retriever` instead of being implied as live retriever coverage.
patterns_established:
  - Milestone closure artifacts cite one authoritative passing proof command and point future agents to nested evidence rather than paraphrased recollection.
  - Final proof summaries preserve stable top-level check IDs plus raw subordinate payloads so later debugging starts from the exact failing boundary.
observability_surfaces:
  - bun test ./scripts/verify-m027-s04.test.ts
  - bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json
  - bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments
  - bun run repair:wiki-embeddings -- --status --json
  - bun run repair:embeddings -- --corpus review_comments --status --json
  - .gsd/milestones/M027/slices/S04/S04-SUMMARY.md
drill_down_paths:
  - .gsd/milestones/M027/slices/S04/tasks/T01-SUMMARY.md
  - .gsd/milestones/M027/slices/S04/tasks/T02-SUMMARY.md
  - .gsd/milestones/M027/slices/S04/tasks/T03-SUMMARY.md
  - .gsd/milestones/M027/slices/S04/tasks/T04-SUMMARY.md
duration: ~3h
verification_result: passed
completed_at: 2026-03-12T15:24:00-07:00
---

# S04: Final Integrated Production Repair Proof

**Closed M027 with a passing production-wired final proof that keeps the six-corpus audit green, proves both repair families remain durably healthy on rerun, and stays truthful that `issue_comments` is audited but not part of the live retriever.**

## What Happened

S04 finished the milestone by composing the existing S01, S02, and S03 proof surfaces into one final acceptance harness rather than inventing a new repair path. `scripts/verify-m027-s04.ts` now runs the full milestone proof and preserves the raw subordinate envelopes under `s01`, `s02`, and `s03`, with stable top-level checks:
- `M027-S04-FULL-AUDIT`
- `M027-S04-RETRIEVER`
- `M027-S04-WIKI-REPAIR-STATE`
- `M027-S04-NON-WIKI-REPAIR-STATE`

The final live proof was then run against the real production wiring with the representative targets defined by the slice plan:
- repo: `xbmc/xbmc`
- query: `json-rpc subtitle delay`
- wiki page: `JSON-RPC API/v8`
- non-wiki corpus: `review_comments`

That acceptance pass returned `overallPassed=true` and `status_code=m027_s04_ok`.

The passing proof establishes four things together:
1. The preserved six-corpus `s01.audit` envelope is green end to end (`learning_memories`, `review_comments`, `wiki_pages`, `code_snippets`, `issues`, `issue_comments`).
2. The live `createRetriever(...).retrieve(...)` path still generates a real query embedding and returns attributed hits.
3. The wiki repair family remains durably healthy from the bounded `JSON-RPC API/v8` repair state (`repair_completed`, `failed=0`).
4. The non-wiki repair family remains durably healthy even on an idempotent `review_comments` rerun: the immediate repair probe returns `repair_not_needed`, while the durable status surface still proves `repair_completed` with zero failures.

The milestone closure artifacts now all point to that exact proof command instead of relying on summary prose alone.

## Verification

Passed every slice-plan verification command:

- `bun test ./scripts/verify-m027-s04.test.ts`
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json`
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments`
- `bun run repair:wiki-embeddings -- --status --json`
- `bun run repair:embeddings -- --corpus review_comments --status --json`

Representative final-pass results:

- Final proof command returned `overallPassed=true`, `status_code=m027_s04_ok`
- `M027-S04-FULL-AUDIT` → `audit_ok`
- `M027-S04-RETRIEVER` → `retrieval_hits`
- `M027-S04-WIKI-REPAIR-STATE` → `repair_completed`
- `M027-S04-NON-WIKI-REPAIR-STATE` → `repair_completed`
- Preserved retriever scope remained truthful: `s01.retriever.not_in_retriever=["issue_comments"]`
- Wiki durable status remained complete for `JSON-RPC API/v8`: `repaired=388`, `failed=0`, `used_split_fallback=false`
- Non-wiki durable status remained healthy for `review_comments`: top-level status `repair_completed`, persisted run state `not_needed`, `failed=0`

Observability/diagnostic surface check:

- The final proof keeps the raw `s01`, `s02`, and `s03` payloads intact, so future agents can localize regressions without rerunning exploratory commands first.
- The closure evidence is intentionally boundary-aware: `issue_comments` is counted in audit coverage but still excluded from live retriever participation.
- Idempotent reruns are proven by durable status surfaces, not by pretending a no-op rerun performed fresh repair work.

## Requirements Advanced

- R019 — milestone closure now re-proves the six-corpus audit inside the final acceptance command.
- R020 — milestone closure now proves both repair families stay healthy together under one operator command.
- R021 — milestone closure now re-proves the live retriever path inside the final acceptance command.
- R022 — milestone closure now proves the hardened wiki and non-wiki repair surfaces remain healthy together on a production-wired rerun.
- R023 — milestone closure now re-proves the wiki/non-wiki model boundary through the preserved all-green audit envelope.
- R024 — milestone closure now has a stable top-level proof/test contract that detects drift in final composition and scope truthfulness.

## Requirements Validated

- R019 — validated by the passing `M027-S04-FULL-AUDIT` check inside the final proof.
- R020 — validated by the passing wiki and non-wiki durable repair-state checks inside the final proof.
- R021 — validated by the passing `M027-S04-RETRIEVER` check and preserved live-hit evidence.
- R022 — validated by the bounded repair families remaining green together under the milestone-closing rerun.
- R023 — validated by the preserved all-green audit envelope confirming wiki=`voyage-context-3` vs non-wiki=`voyage-code-3`.
- R024 — validated by the final S04 contract tests plus the passing live final proof.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- None.

## Known Limitations

- `issue_comments` remains outside the live retriever by design. S04 proves that boundary truthfully; it does not change it.
- The final proof is a health/acceptance proof, not a historical run archive. For deeper forensics, use the preserved nested proof payloads plus the durable repair-state tables.
- The current live proof uses representative targets (`JSON-RPC API/v8`, `review_comments`) rather than exhaustively replaying every possible degraded repair path on demand.

## Follow-ups

- M027 itself has no remaining in-scope work after this passing proof.
- The next milestone should treat `issue_comments` retriever participation as separate future scope unless requirements explicitly change that system boundary.

## Files Created/Modified

- `scripts/verify-m027-s04.ts` — final milestone proof harness with stable check IDs and preserved nested S01/S02/S03 evidence.
- `scripts/verify-m027-s04.test.ts` — locked regression contract for final-proof composition, verdicts, and boundary truthfulness.
- `docs/operations/embedding-integrity.md` — operator runbook for the final proof command, check IDs, and localization path.
- `.gsd/REQUIREMENTS.md` — requirement validation text updated to cite the final passing proof command and its exact meaning.
- `.gsd/milestones/M027/M027-ROADMAP.md` — marked S04 complete from the passing live proof.
- `.gsd/PROJECT.md` — current project state updated to reflect completed M027 acceptance and the audited-only `issue_comments` boundary.
- `.gsd/STATE.md` — active milestone/state advanced beyond M027 closure.

## Forward Intelligence

### What the next milestone should know
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` is the single authoritative proof for completed M027.
- If a future run fails, start from the failing S04 check ID and inspect the preserved `s01`, `s02`, or `s03` payload instead of re-deriving the localization path.
- `issue_comments` being audited-but-not-in-retriever is a real system boundary, not unfinished M027 work.

### What's fragile
- The final proof depends on real providers and Azure Postgres state, so environmental failures can still surface even when code contracts are unchanged.
- The durable repair-state surfaces expose latest state, not an append-only history of all repair attempts.

### Authoritative diagnostics
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` — milestone-closing proof with nested evidence.
- `bun run repair:wiki-embeddings -- --status --json` — durable wiki checkpoint surface.
- `bun run repair:embeddings -- --corpus review_comments --status --json` — durable non-wiki checkpoint surface.
- `bun run audit:embeddings --json` — full six-corpus audit baseline.

### What assumptions changed
- The assumption that milestone closure needed fresh repair mutations changed — a healthy idempotent rerun is valid when the durable repair-state evidence still proves prior completion.
- The assumption that six-corpus audit success implied six-corpus retriever participation changed — S04 explicitly preserves the narrower live retriever scope and reports `issue_comments` honestly under `not_in_retriever`.
