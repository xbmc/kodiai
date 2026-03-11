# T01: 07-operational-resilience 01

**Slice:** S07 — **Milestone:** M001

## Description

Create the error handling foundation and timeout enforcement for Phase 7: Operational Resilience.

Purpose: Both handlers (review and mention) need shared error formatting and the executor needs timeout enforcement. This plan creates the foundation that Plan 02 wires into the handlers.

Output: Error classification/formatting module (`src/lib/errors.ts`), updated executor with AbortController-based timeout, updated config with `timeoutSeconds`, updated types with `isTimeout` field.

## Must-Haves

- [ ] "Error messages are classified into user-understandable categories (timeout, api_error, config_error, clone_error, internal_error)"
- [ ] "Error comments are formatted as clear, actionable markdown with a header, detail, and suggestion"
- [ ] "A job exceeding the configured timeout is terminated via AbortController and returns isTimeout: true"
- [ ] "Timeout duration is configurable via timeoutSeconds in .kodiai.yml (default 300)"
- [ ] "Tokens/secrets in error messages are redacted before they can reach any comment-posting code"

## Files

- `src/lib/errors.ts`
- `src/lib/errors.test.ts`
- `src/execution/types.ts`
- `src/execution/config.ts`
- `src/execution/executor.ts`
