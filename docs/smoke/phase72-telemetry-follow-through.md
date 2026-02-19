# Phase 72 Smoke: Telemetry Follow-Through

Run this smoke scenario once per milestone to produce release evidence for OPS-04 and OPS-05.

The scenario is fixed and deterministic:

1. Prime cache (first query)
2. Verify cache hit (same query)
3. Force cache miss (changed query)

Run the sequence for both trigger surfaces:

- `pull_request.review_requested`
- explicit `@kodiai` mention (`issue_comment.created` by default)

## Prerequisites

- Telemetry DB exists at `./data/kodiai-telemetry.db` (or pass `--db`).
- You have six delivery IDs from live runs:
  - Review surface: prime, hit, changed-query miss
  - Mention surface: prime, hit, changed-query miss

## Command

```sh
bun run verify:phase72 \
  --review <review-prime-delivery> <review-hit-delivery> <review-changed-delivery> \
  --mention <mention-prime-delivery> <mention-hit-delivery> <mention-changed-delivery>
```

Optional:

```sh
bun run verify:phase72 \
  --db ./data/kodiai-telemetry.db \
  --review-event-type pull_request.review_requested \
  --mention-event-type issue_comment.created \
  --review <review-prime-delivery> <review-hit-delivery> <review-changed-delivery> \
  --mention <mention-prime-delivery> <mention-hit-delivery> <mention-changed-delivery> \
  --json
```

## Expected Output

The script prints two evidence layers in one run:

1. DB assertions (`DB-C1` to `DB-C4`) for:
   - Both surfaces observed
   - Review cache-hit sequence `0 -> 1 -> 0`
   - Exactly-once composite identity (`delivery_id + event_type`)
   - Non-blocking completion in `executions.conclusion`
2. Operator summary with evidence-cited verdict language.

A passing run ends with `Final verdict: PASS ...` and exit code `0`.
Any failed assertion exits non-zero and lists failed checks for triage.

## Failure Interpretation

- `DB-C1` failed: One or more expected runs were not persisted in `executions`.
- `DB-C2` failed: cache-hit telemetry did not match `prime -> hit -> changed-query miss`.
- `DB-C3` failed: duplicate `rate_limit_events` rows were recorded for the same composite identity.
- `DB-C4` failed: execution conclusions suggest telemetry paths blocked completion.

If any check fails, follow `docs/runbooks/review-requested-debug.md` before rerunning.
