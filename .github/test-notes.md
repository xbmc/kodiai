# Test Notes for Phase 9

This file documents the test plan for Phase 9 UX features.

## Test Scenarios

### Scenario 1: Eyes Reaction Timing
- Trigger: @mention kodiai in a comment
- Expected: Eyes emoji appears within seconds, before tracking comment

### Scenario 2: Long Response Collapse
- Trigger: Ask a question that generates a detailed response
- Expected: Response wrapped in `<details>` tags if over 500 characters

### Scenario 3: PR Summary
- Trigger: Open this PR
- Expected: Summary comment with "What changed", "Why", and "Files modified" sections

### Scenario 4: Cross-Surface Testing
- Test mentions in: issue comments, PR comments, PR review comments
- Expected: Eyes reaction works on all surfaces (except PR review body)
