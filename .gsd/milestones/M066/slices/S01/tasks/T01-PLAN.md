---
estimated_steps: 5
estimated_files: 2
skills_used:
  - test-driven-development
  - test
---

# T01: Add formatter suggestion config defaults and parsing

**Slice:** S01 — Formatter suggestion config and mention intent
**Milestone:** M066

## Description

Add the `review.formatterSuggestions` config contract in the Zod schema using test-first changes. This task implements D197/R079's default-off automatic mode while preserving explicit formatter requests for later tasks and slices. It also establishes the `command` and `maxSuggestions` fields consumed by S02/S03.

## Negative Tests

- **Malformed inputs**: Invalid `automatic` type, empty `command`, and out-of-range `maxSuggestions` should be covered by existing config validation/fallback patterns rather than silently producing a partial invalid shape.
- **Error paths**: If `review.formatterSuggestions` is invalid, keep the current section-level review fallback behavior unless implementation evidence shows a narrower fallback already exists.
- **Boundary conditions**: Assert default `maxSuggestions` is `10`; assert configured lower/upper valid values parse; use bounded schema limits such as `1..100`.

## Steps

1. Add failing tests in `src/execution/config.test.ts` for default `review.formatterSuggestions` values when no `.kodiai.yml` exists and when `review:` exists without the nested block.
2. Add a YAML parsing test with `review.formatterSuggestions.automatic: true`, a non-empty `command`, and a configured `maxSuggestions`.
3. Add `formatterSuggestionsSchema` in `src/execution/config.ts` and nest it under `reviewSchema`; include the default object in `reviewSchema.default(...)`.
4. Ensure there is no `enabled` field or behavior that blocks explicit formatter-suggestion requests.
5. Run the task verification command and fix schema/test mismatches until it passes.

## Must-Haves

- [ ] `config.review.formatterSuggestions.automatic` defaults to `false`.
- [ ] `config.review.formatterSuggestions.command` is optional.
- [ ] `config.review.formatterSuggestions.maxSuggestions` defaults to `10` and is bounded.
- [ ] Tests make it clear `automatic` is not an explicit-request gate.

## Verification

- `bun test ./src/execution/config.test.ts --timeout 30000`

## Inputs

- `src/execution/config.ts` — existing Zod config schema and review defaults.
- `src/execution/config.test.ts` — existing config test patterns for defaults, YAML parsing, and fallback behavior.

## Expected Output

- `src/execution/config.ts` — adds `review.formatterSuggestions` with `automatic`, optional `command`, and bounded `maxSuggestions` defaults.
- `src/execution/config.test.ts` — adds regression tests proving default-off automatic mode and configured formatter-suggestion values.
