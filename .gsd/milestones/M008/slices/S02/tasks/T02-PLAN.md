# T02: 43-auto-profile-selection 02

**Slice:** S02 — **Milestone:** M008

## Description

Integrate auto-profile resolution into the review handler so runtime profile selection adapts by PR size while preserving override precedence.

Purpose: The resolver from Plan 01 must drive real review behavior and be visible to users/operators. This closes the loop from pure logic to live profile selection and observability.

Output: Updated handler/profile wiring plus tests that prove thresholds and precedence under real review execution paths.

## Must-Haves

- [ ] "Small PRs (<=100 changed lines) run with strict profile defaults when no manual/keyword override is present"
- [ ] "Large PRs (>500 changed lines) run with minimal profile defaults when no manual/keyword override is present"
- [ ] "Manual config profile still overrides auto-profile"
- [ ] "Keyword profile override still overrides both manual config and auto-profile"
- [ ] "Review Details reports the applied profile and why it was selected"

## Files

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
