---
estimated_steps: 5
estimated_files: 4
---

# T04: Ship the unified repair CLI, status surface, and operator docs

**Slice:** S03 — Unified Online Repair for Remaining Corpora
**Milestone:** M027

## Description

Expose the shared repair engine through one stable operator command, with explicit status/resume/dry-run modes and documentation that differentiates persisted-row repair from the older ingestion/backfill scripts.

## Steps

1. Create `scripts/embedding-repair.ts` with argument parsing for `--corpus`, `--status`, `--resume`, `--dry-run`, and `--json`, plus human rendering from the same report envelope used for machine output.
2. Wire the command into `package.json` as `repair:embeddings` and keep the runtime path on the shared engine instead of historical backfill scripts.
3. Document the operator contract in `docs/operations/embedding-integrity.md`, including supported corpora, example commands, durable status inspection, and the fact that normal repair is DB-driven rather than GitHub-fetch-driven.
4. Lock the CLI/output contract with `scripts/embedding-repair.test.ts` and make it pass.
5. Run a read-only `--dry-run` check against a currently empty or healthy corpus to prove no-op reporting stays truthful and machine-checkable.

## Must-Haves

- [ ] One command covers all five remaining corpora with a stable envelope and explicit separation between mutating repair, `--status`, and `--dry-run`.
- [ ] Human-readable output is rendered from the same report object as `--json`, preventing drift between operator and automation surfaces.
- [ ] Docs tell future operators how to inspect persisted repair state and when to use the repair CLI instead of historical ingestion scripts.

## Verification

- `bun test scripts/embedding-repair.test.ts`
- `bun run repair:embeddings -- --corpus issues --dry-run --json`

## Observability Impact

- Signals added/changed: Stable CLI-level `success`, `status_code`, `run`, and `failure_summary` surfaces across every non-wiki corpus.
- How a future agent inspects this: Use `repair:embeddings -- --status --corpus <name> --json` or the documented SQL against `embedding_repair_state`.
- Failure state exposed: CLI status mode surfaces the last cursor and failure metadata without requiring another mutating repair attempt.

## Inputs

- `src/knowledge/embedding-repair.ts` — shared repair engine from T02/T03.
- `docs/operations/embedding-integrity.md` — existing audit/wiki-repair runbook that now needs the non-wiki repair surface added coherently.

## Expected Output

- `scripts/embedding-repair.ts` — stable operator CLI for all remaining corpus repairs.
- `package.json` — `repair:embeddings` script alias.
- `docs/operations/embedding-integrity.md` — updated operator runbook for shared non-wiki repair and status inspection.
