---
estimated_steps: 13
estimated_files: 5
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T01: Restore synchronize-trigger continuity from repo config through handler gating

**Slice:** S03 — Truthful Bounded Reviews and Synchronize Continuity
**Milestone:** M048

## Description

The repo currently intends synchronize reruns, but `.kodiai.yml` uses legacy `review.onSynchronize` while `src/execution/config.ts` only honors `review.triggers.onSynchronize`. This task should close that continuity gap at the config/parser boundary, make the handler's synchronize behavior provable in tests, and update the checked-in repo/docs so the live xbmc loop can actually fire on new commits.

## Steps

1. Add failing coverage in `src/execution/config.test.ts` for the current legacy top-level `review.onSynchronize` shape, the correct nested `review.triggers.onSynchronize` shape, and any warning/helper output that distinguishes intent from effective runtime behavior.
2. Update `src/execution/config.ts` to detect the legacy key instead of silently stripping it, surface a fail-loud warning/helper signal, and keep the normal nested trigger path fast/default for correctly shaped configs.
3. Fix the checked-in `.kodiai.yml` and `docs/configuration.md` examples to use `review.triggers.onSynchronize`, then add or extend `src/handlers/review.test.ts` so `pull_request.synchronize` executes only when the effective trigger is enabled.
4. Re-run the focused tests and `tsc` so the repo config actually enables synchronize reruns and the false-green drift cannot regress unnoticed.

## Must-Haves

- [ ] Legacy `review.onSynchronize` no longer false-greens as “configured but disabled with no warning.”
- [ ] The checked-in repo config uses the same nested trigger shape the parser actually reads.
- [ ] Handler coverage proves `pull_request.synchronize` is wired to the effective trigger state, not the raw YAML shape.

## Inputs

- `.kodiai.yml`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/review.test.ts`
- `docs/configuration.md`

## Expected Output

- `.kodiai.yml`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/review.test.ts`
- `docs/configuration.md`

## Verification

- `bun test ./src/execution/config.test.ts ./src/handlers/review.test.ts`
- `bun run tsc --noEmit`

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `.kodiai.yml` parsing in `src/execution/config.ts` | Return a warning or verifier failure instead of silently pretending synchronize is disabled by design. | N/A — local file parse only. | Detect the legacy `review.onSynchronize` shape and surface intent-versus-effective drift instead of stripping it quietly. |
| `pull_request.synchronize` routing in `src/handlers/review.ts` | Keep other review triggers unaffected and fail the focused test rather than dispatching the wrong lane. | Preserve existing queue/handler timeout behavior; this task must not add a new wait path. | Treat missing or malformed trigger config as disabled-with-signal, not enabled-by-guessing. |

## Load Profile

- **Shared resources**: one repo-config parse per review trigger check plus the shared webhook handler registration path.
- **Per-operation cost**: a single YAML parse and one trigger-enable check; the fast nested-config path should remain unchanged for correctly shaped repos.
- **10x breakpoint**: repeated silent drift or warning spam would hurt operators before raw CPU cost does, so the task must keep the happy path cheap and the failure path explicit.

## Negative Tests

- **Malformed inputs**: legacy top-level `review.onSynchronize`, missing `review.triggers`, and non-boolean synchronize values in `.kodiai.yml`.
- **Error paths**: malformed YAML, missing config file, and synchronize events when the effective trigger is false.
- **Boundary conditions**: default config without `.kodiai.yml`, correct nested `review.triggers.onSynchronize: true`, and the checked-in repo config after the fix.
