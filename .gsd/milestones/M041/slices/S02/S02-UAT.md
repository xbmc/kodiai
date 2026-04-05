# S02: Default-Branch Backfill and Semantic Retrieval — UAT

**Milestone:** M041
**Written:** 2026-04-05T14:35:30.780Z

# S02 UAT — Default-Branch Backfill and Semantic Retrieval

## Preconditions
- Repository checkout is at the completed M041/S02 state.
- Bun dependencies are installed.
- No external services are required; the verifier builds its own deterministic local fixture repo.

## Test Case 1 — Canonical backfill stores default-branch snapshot rows
1. Run `bun test ./src/knowledge/canonical-code-backfill.test.ts`.
   - **Expected:** 3 tests pass, including the happy-path backfill, fail-open embedding degradation, and resume-from-state scenarios.
2. Run `bun run verify:m041:s02 -- --json`.
   - **Expected:** The JSON output includes check `M041-S02-BACKFILL-STORES-CANONICAL-CHUNKS` with `passed: true` and detail containing `canonicalRef=trunk`, `filesDone=3`, and `storedRows=4` (or another deterministic non-zero stored row count if fixture chunking changes in a future deliberate update).

## Test Case 2 — Unified retrieval returns canonical current-code evidence with provenance
1. Run `bun test ./src/knowledge/canonical-code-retrieval.test.ts`.
   - **Expected:** 5 tests pass, including the standalone helper mapping case and the unified retriever integration case.
2. Run `bun run verify:m041:s02 -- --json` and inspect check `M041-S02-RETRIEVAL-RETURNS-CANONICAL-CURRENT-CODE`.
   - **Expected:** `passed: true`.
   - **Expected:** Detail contains `canonicalCodeCount=` with a value greater than 0 and `topCanonicalFilePath=src/auth/token.ts`.
   - **Expected:** The unified retrieval result still exposes canonical evidence even if the top unified source is not canonical.

## Test Case 3 — Canonical and historical corpora stay separate
1. Run `bun run verify:m041:s02 -- --json` and inspect check `M041-S02-RETRIEVAL-PRESERVES-CORPUS-SEPARATION`.
   - **Expected:** `passed: true`.
   - **Expected:** Detail contains `snippetCount=1` and `unifiedSources` showing both `snippet` and `canonical_code` sources.
2. Confirm the verifier output does **not** collapse canonical hits into the snippet corpus.
   - **Expected:** Canonical results are reported via `canonicalCodeCount`; historical diff-hunk evidence is reported separately via `snippetCount`.

## Test Case 4 — Non-`main` default branch propagates end to end
1. Run `bun run verify:m041:s02 -- --json` and inspect check `M041-S02-NONMAIN-DEFAULT-BRANCH-IS-RESPECTED`.
   - **Expected:** `passed: true`.
   - **Expected:** Detail contains `backfillCanonicalRef=trunk` and `retrievalCanonicalRef=trunk`.
2. Confirm there is no indication that retrieval fell back to `main`.
   - **Expected:** No failing status code `canonical_ref_propagation_failed`; no detail string mentioning `retrieval canonicalRefRequested=main`.

## Test Case 5 — Full regression gate for the slice
1. Run:
   ```bash
   bun run tsc --noEmit && \
   bun test ./src/knowledge/canonical-code-backfill.test.ts && \
   bun test ./src/knowledge/canonical-code-retrieval.test.ts && \
   bun test ./scripts/verify-m041-s02.test.ts && \
   bun run verify:m041:s02 -- --json
   ```
   - **Expected:** All commands exit 0.
   - **Expected:** The final verifier JSON reports `overallPassed: true` and exactly these four check ids:
     - `M041-S02-BACKFILL-STORES-CANONICAL-CHUNKS`
     - `M041-S02-RETRIEVAL-RETURNS-CANONICAL-CURRENT-CODE`
     - `M041-S02-RETRIEVAL-PRESERVES-CORPUS-SEPARATION`
     - `M041-S02-NONMAIN-DEFAULT-BRANCH-IS-RESPECTED`

## Edge Cases Covered By This UAT
- Embedding generation can fail for individual files/chunks without aborting the whole backfill run.
- Backfill can resume from persisted `last_file_path` when the commit SHA still matches.
- Canonical retrieval fails open without breaking other corpora.
- Default branch propagation is verified against a non-`main` branch (`trunk`), preventing regressions back to a hard-coded `main` assumption.
- TypeScript compile correctness is required for completion; proof-harness tests must use full nested fixture shapes so the slice remains `tsc` clean.
