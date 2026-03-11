# T03: 51-timeout-resilience 03

**Slice:** S01 — **Milestone:** M009

## Description

Fix test gap: add timeout_partial coverage to errors.test.ts.

Purpose: The verification report found that errors.test.ts was not updated when timeout_partial was added to ErrorCategory. The expectedHeaders Record<ErrorCategory, string> is missing the new category, causing TypeScript compilation failure. This plan adds the missing test coverage.

## Must-Haves

- [ ] "errors.test.ts includes timeout_partial in the categories array and expectedHeaders object"
- [ ] "classifyError returns timeout_partial when isTimeout=true and published=true"
- [ ] "formatErrorComment produces correct output for timeout_partial category"

## Files

- `src/lib/errors.test.ts`
