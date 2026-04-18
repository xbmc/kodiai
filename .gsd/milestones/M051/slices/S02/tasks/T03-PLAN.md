---
estimated_steps: 4
estimated_files: 3
skills_used: []
---

# T03: Lock the surviving manual trigger proof surface

Make the supported-path proof explicit enough to close R055 without re-litigating the trigger contract.
- Reuse or tighten `src/handlers/mention.test.ts` coverage that proves `@kodiai review` routes to `taskType=review.full` on `lane=interactive-review` and still owns the visible publish/fallback path.
- Add/update a narrow negative regression in `src/handlers/review.test.ts` proving team-only `review_requested` events are skipped after the removal.
- Run the slice-level proof bundle so completion can cite one explicit supported trigger and zero stale team-trigger claims.

## Inputs

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/handlers/review.test.ts`
- `.gsd/REQUIREMENTS.md`

## Expected Output

- `Regression proof that `@kodiai review` remains the surviving supported manual rereview lane`
- `Negative coverage proving team-only `review_requested` events no longer count as an accepted manual trigger`
- `R055 closure evidence bundle for slice completion`

## Verification

bun test ./src/handlers/mention.test.ts ./src/handlers/review.test.ts

## Observability Impact

Keeps the publish-resolution and interactive-review evidence surfaces tied to the only surviving manual trigger.
