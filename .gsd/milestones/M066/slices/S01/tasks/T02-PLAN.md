---
estimated_steps: 5
estimated_files: 2
skills_used:
  - test-driven-development
  - test
---

# T02: Create pure formatter suggestion mention intent parser

**Slice:** S01 — Formatter suggestion config and mention intent
**Milestone:** M066

## Description

Create a small pure parser module for formatter-suggestion mentions so downstream slices can consume a stable descriptor without depending on the large mention handler. This task implements R076 phrase recognition directly and supports R080 by distinguishing combined review+format requests from format-only requests.

## Negative Tests

- **Malformed inputs**: Empty strings, whitespace-only strings, and unrelated mention text return `undefined`.
- **Error paths**: Broad write-like wording such as `format this PR` does not match unless it is suggestion-oriented.
- **Boundary conditions**: Polite prefixes should not change the descriptor mode; combined phrases should not be downgraded to format-only just because they contain `format suggestions`.

## Steps

1. Create `src/handlers/formatter-suggestion-intent.test.ts` with a phrase matrix for accepted format-only phrases: `format suggestions`, `formatting suggestions`, `suggest formatting fixes`, and `suggest formatting changes`.
2. Add tests for combined phrases: `review & format suggestions`, `review and format suggestions`, `review + format suggestions`, and `review with format suggestions`, including polite prefixes such as `please` and `can you please`.
3. Add negative tests for empty input, unrelated review-only wording, and broad write-like `format this PR` wording.
4. Create `src/handlers/formatter-suggestion-intent.ts` exporting `FormatterSuggestionRequest` and `detectFormatterSuggestionRequest(userQuestion: string): FormatterSuggestionRequest | undefined`.
5. Implement conservative normalization and matching so descriptors include `requested: true`, `mode`, `source: "explicit-mention"`, and `normalizedRequest`; run verification until the parser tests pass.

## Must-Haves

- [ ] Parser is pure and does not import the mention handler.
- [ ] Descriptor is serializable and stable for downstream slices.
- [ ] `review-and-format` is detected explicitly, not inferred from the existing review prefix behavior.
- [ ] Non-suggestion formatter wording remains unmatched to avoid write-mode ambiguity.

## Verification

- `bun test ./src/handlers/formatter-suggestion-intent.test.ts --timeout 30000`

## Inputs

- `src/handlers/mention-types.ts` — existing mention normalization helpers and style conventions.
- `src/handlers/mention.ts` — existing review-request phrasing conventions to avoid conflicting semantics.

## Expected Output

- `src/handlers/formatter-suggestion-intent.ts` — exports `FormatterSuggestionRequest` and `detectFormatterSuggestionRequest(...)`.
- `src/handlers/formatter-suggestion-intent.test.ts` — covers accepted, combined, polite-prefix, and non-matching write-like phrases.
