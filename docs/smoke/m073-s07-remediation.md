# M073 S07 remediation proof

This smoke artifact records the M073/S07 remediation bridge for two validation gaps: S02 must be machine-checkably linked back to S01 baseline evidence, and R131 must not be treated as completed by M073 token-first evidence.

The proof is intentionally offline and aggregate-only. It reads tracked JSON fixtures and docs; it performs no live GitHub writes, model calls, database writes, or publication actions.

## What S07 proves

| Area | Proof | Boundary |
|---|---|---|
| S01/S02 linkage | `scripts/verify-m073-s07.ts` loads the S07 fixture, then cross-checks S02 `baselineSource` rows against S01 prompt-section rows by source id, case id, delivery id, prompt kind, section name, and bounded char/token counts. | Counts and bounded identifiers only; no review-content reconstruction. |
| S06 compatibility | The S07 verifier confirms the S06 live-proof fixture still reports a passing S02 upstream result and the same S02 section count. | S06 remains a production-like offline proof, not a live write proof. |
| R131 disposition | `scripts/fixtures/m073-s07-remediation.json` declares `status: "formally-rescoped"`, `owner: "specialist-lane-follow-up"`, and `m073PublishesSpecialistLaneOutputs: false`. | M073 supports token-first review efficiency evidence only; it does not complete shadow/private specialist lane ownership. |
| Negative coverage | The tracked S07 fixture declares bounded negative cases for broken S01/S02 linkage, missing R131 owner/follow-up, false R131 completion wording, and unsafe proof fields. | Failures localize to paths, ids, section names, disposition fields, or stable check ids. |

## Verification command

Run the package script from the repository root:

```sh
bun run verify:m073:s07 --json
```

Equivalent direct verifier invocation:

```sh
bun scripts/verify-m073-s07.ts --fixture scripts/fixtures/m073-s07-remediation.json --json
```

Expected successful shape:

- `overallPassed: true`
- `statusCode: "m073_s07_ok"`
- `failedCheckIds: []`
- `observedTotals.r131DispositionStatus: "formally-rescoped"`
- `observedTotals.m073PublishesSpecialistLaneOutputs: false`

## Latest observed totals

The latest passing S07 verifier output observed these totals:

| Total | Value |
|---|---:|
| S01 baseline rows | 8 |
| S02 observations | 2 |
| S02 sections | 5 |
| S02 linked sections | 3 |
| S02 new budget sections | 2 |
| S02 bypassed sections | 1 |
| Matched links | 3 |
| Unmatched links | 0 |
| S06 S02 section count | 5 |
| Negative cases | 5 |

## R131 disposition and pending requirement update

S07 uses formal re-scope, not bounded specialist-lane completion. The requirement-update tool is unavailable in this execution runtime, so R131 must not be claimed validated by this task. The exact pending GSD requirement update is:

- Requirement: `R131`
- Status: keep `active`
- Primary owning slice: change from `M073` to `specialist-lane-follow-up` or the concrete follow-up milestone that owns real private/shadow specialist-lane completion.
- Supporting slices: keep `M072/S01`, `M072/S02`, `M072/S03`, and `M073` as supporting evidence; keep/add `M074` only if it remains the concrete specialist-lane follow-up owner.
- Validation: do not mark validated from M073.
- Notes: replace “Primary completion remains deferred to M073 specialist lane work” with “M073 provides supporting token-first, bounded-linkage, and non-publication evidence only. R131 private/shadow specialist-lane completion is formally re-scoped to `specialist-lane-follow-up` and requires a future bounded aggregate specialist-lane proof before validation.”

## Operator interpretation

- Use S07 to prove that S02 consumed S01 baseline rows through deterministic `baselineSource` references.
- Use S07 to prove that M073 did not accidentally claim R131 completion from token-budget or live-proof evidence.
- Use S06 for the production-like token-reduction proof.
- Re-run both final proofs together before milestone validation:

```sh
bun run verify:m073:s07 --json && bun run verify:m073:s06 --json
```
