---
estimated_steps: 4
estimated_files: 2
skills_used:
  - systematic-debugging
  - test-driven-development
  - verification-before-completion
---

# T01: Harden the phase-timing evidence contract against incomplete payloads

**Slice:** S03 — Residual operator truthfulness cleanup
**Milestone:** M051

## Description

The root false-green is one layer below the human report text: `buildPhaseTimingEvidence()` currently accepts matched phase-summary rows that are missing `conclusion` and/or `published` as a clean payload. This task fixes that provenance seam first. Keep the matched row, correlation data, and normalized phases visible for diagnosis, but stop reporting the payload as trustworthy when those interpretation fields are absent.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Azure phase-summary payload normalization in `src/review-audit/phase-timing-evidence.ts` | Return `invalid-phase-payload` with named issues instead of `ok`. | N/A — pure in-process parsing with no remote call. | Preserve the matched row and normalized phases, but record missing `conclusion` / `published` as payload issues. |
| Existing phase normalization helpers in `src/review-audit/phase-timing-evidence.ts` | Keep current unavailable/degraded phase behavior and accumulate issues rather than dropping evidence. | N/A — pure in-process normalization. | Continue surfacing malformed or missing phase data alongside the new missing-field issues so one bad field does not hide the rest of the payload drift. |

## Negative Tests

- **Malformed inputs**: rows missing `conclusion`, rows missing `published`, and rows missing both fields must all produce named payload issues.
- **Error paths**: malformed payloads must stay `invalid-phase-payload` even when `totalDurationMs` or phase names are also wrong, rather than losing the original drift signal.
- **Boundary conditions**: matched-row dedupe and normalized phase fallback still work when the selected row has null interpretation fields.

## Steps

1. Add failing regressions in `src/review-audit/phase-timing-evidence.test.ts` for rows missing `conclusion`, missing `published`, and missing both fields.
2. Update `src/review-audit/phase-timing-evidence.ts` so missing `conclusion` / `published` append named payload issues and flip the result to `invalid-phase-payload` without discarding matched-row evidence.
3. Extend the malformed-payload assertions so existing `totalDurationMs` and phase-normalization drift still coexists with the new missing-field issues.
4. Run the targeted parser test file and confirm the new cases fail before the fix and pass after it.

## Must-Haves

- [ ] Missing `conclusion` is treated as payload drift, not as a clean `ok` evidence row.
- [ ] Missing `published` is treated as payload drift, not silently normalized into a trustworthy payload.
- [ ] The returned `evidence` object still carries matched row identity and normalized phases so operators can inspect what was actually found.

## Verification

- `bun test ./src/review-audit/phase-timing-evidence.test.ts`
- The new regression cases prove incomplete matched rows return `invalid-phase-payload` with named issues.

## Observability Impact

- Signals added/changed: `invalid-phase-payload` and named missing-field issues now surface when a matched row is incomplete.
- How a future agent inspects this: run `bun test ./src/review-audit/phase-timing-evidence.test.ts` and inspect the assertions for `issues`, `status`, and preserved `evidence` fields.
- Failure state exposed: matched-but-incomplete Azure evidence remains visible for diagnosis instead of hiding behind a false-green `ok` result.

## Inputs

- `src/review-audit/phase-timing-evidence.ts` — current parser that still accepts missing `conclusion` / `published` as a clean payload.
- `src/review-audit/phase-timing-evidence.test.ts` — existing regression harness to extend with missing-field cases.

## Expected Output

- `src/review-audit/phase-timing-evidence.ts` — parser updated to treat missing `conclusion` / `published` as invalid payload issues while preserving matched-row evidence.
- `src/review-audit/phase-timing-evidence.test.ts` — regression coverage for missing `conclusion`, missing `published`, and both-missing payloads.
