---
estimated_steps: 4
estimated_files: 3
---

# T03: Document the final operator proof and run the live acceptance pass

**Slice:** S04 — Final Integrated Production Repair Proof
**Milestone:** M027

## Description

Make the final proof runnable and understandable for operators, then exercise it against the real production wiring. This task closes the gap between a passing local test harness and actual milestone acceptance by updating the runbook, executing the real command, and tightening any live-only truthfulness or diagnostics issues exposed by the run.

## Steps

1. Extend `docs/operations/embedding-integrity.md` with the final `verify:m027:s04` command, its check IDs, required inputs, and interpretation notes for `repair_not_needed`, `repair_resume_available`, retriever degradation, and `issue_comments` being audited-only.
2. Run the final proof against the production-wired targets (`xbmc/xbmc`, `json-rpc subtitle delay`, `JSON-RPC API/v8`, `review_comments`) in both JSON and human modes.
3. Inspect the paired status surfaces (`repair:wiki-embeddings -- --status --json` and `repair:embeddings -- --corpus review_comments --status --json`) to confirm the live proof is backed by durable repair-state evidence rather than transient output only.
4. If the live run exposes truthfulness, rendering, or status-localization gaps, fix them in `scripts/verify-m027-s04.ts` and rerun until the final proof is operationally clean.

## Must-Haves

- [ ] The runbook explains the real operator interpretation path for healthy no-op reruns and audited-only retriever gaps.
- [ ] The final proof is executed live and passes with durable diagnostic backing from both repair-state surfaces.

## Verification

- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json`
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments && bun run repair:wiki-embeddings -- --status --json && bun run repair:embeddings -- --corpus review_comments --status --json`

## Observability Impact

- Signals added/changed: Documents and verifies the milestone-level check IDs and the durable repair-state surfaces that anchor idempotent success.
- How a future agent inspects this: Use the runbook plus the three JSON commands to inspect final-proof verdicts and the underlying wiki/non-wiki state rows.
- Failure state exposed: Live regressions remain attributable to a specific proof family or persisted status surface instead of reading ad hoc logs.

## Inputs

- `docs/operations/embedding-integrity.md` — existing operator runbook that already documents S01/S02/S03 surfaces.
- `scripts/verify-m027-s04.ts` — newly implemented final acceptance harness to exercise against production wiring.

## Expected Output

- `docs/operations/embedding-integrity.md` — updated runbook section for the final milestone proof.
- `scripts/verify-m027-s04.ts` — live-validated final harness with any truthfulness fixes discovered during real execution.
