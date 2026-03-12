---
estimated_steps: 5
estimated_files: 5
---

# T03: Ship the operator repair CLI, status surface, and compatibility wrapper

**Slice:** S02 — Timeout-Hardened Wiki Repair Path
**Milestone:** M027

## Description

Expose the new repair engine through stable operator commands so the timeout-hardening work is actually usable in production, inspectable between runs, and consistent with the S01 audit/proof surfaces.

## Steps

1. Add `scripts/wiki-embedding-repair.ts` as the explicit operator CLI with JSON/human output, `--status`, `--resume`, and representative-target options.
2. Update `package.json` with a stable `repair:wiki-embeddings` alias and any verification alias needed by S02.
3. Convert `scripts/wiki-embedding-backfill.ts` into a thin compatibility wrapper over the new engine so the legacy entrypoint no longer executes the old monolithic timeout-prone flow.
4. Update `docs/operations/embedding-integrity.md` with the new repair command, progress fields, resume behavior, and inspection guidance for checkpoint state.
5. Make `scripts/wiki-embedding-repair.test.ts` pass and confirm the status command returns machine-readable progress data.

## Must-Haves

- [ ] The CLI exposes one stable operator contract for progress, resume, and status instead of ad hoc console output.
- [ ] Legacy wiki repair invocation no longer writes `voyage-code-3` or bypasses the bounded repair engine.
- [ ] Operator docs explain how to inspect checkpoints, rerun safely, and distinguish successful completion from partial failure.

## Verification

- `bun test scripts/wiki-embedding-repair.test.ts`
- `bun run repair:wiki-embeddings -- --status --json`

## Observability Impact

- Signals added/changed: Stable CLI JSON/human rendering of run state, cursor location, counts, and failure summaries.
- How a future agent inspects this: Use `bun run repair:wiki-embeddings -- --status --json` and the updated runbook instead of reading raw DB rows blindly.
- Failure state exposed: Partial runs, resume-ready cursors, and last failure metadata are visible without reproducing the whole repair job.

## Inputs

- `src/knowledge/wiki-embedding-repair.ts` — reusable engine and state model from T02.
- `scripts/wiki-embedding-backfill.ts` — legacy operator surface that must become a wrapper rather than a second code path.
- `docs/operations/embedding-integrity.md` — existing audit/verifier runbook that should absorb the new repair surface.

## Expected Output

- `scripts/wiki-embedding-repair.ts` — stable repair CLI entrypoint.
- `scripts/wiki-embedding-backfill.ts` — compatibility wrapper onto the new engine.
- `package.json` — `repair:wiki-embeddings` and any related verification alias.
- `docs/operations/embedding-integrity.md` — operator guidance for repair/status/resume.
- `scripts/wiki-embedding-repair.test.ts` — passing CLI contract tests.
