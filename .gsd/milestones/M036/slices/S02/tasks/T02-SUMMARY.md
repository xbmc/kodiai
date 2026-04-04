---
id: T02
parent: S02
milestone: M036
key_files:
  - src/knowledge/active-rules.ts
  - src/knowledge/active-rules.test.ts
  - src/execution/review-prompt.ts
  - src/execution/review-prompt.test.ts
key_decisions:
  - Active rules retrieval is fail-open — store errors log a warn and return empty result so review proceeds without generated rules
  - Absolute cap of 20 rules guards against prompt overload regardless of caller-configured limit
  - Rules section placed before custom instructions so repo-specific instructions retain recency bias position
  - sanitizeRule delegates to the existing sanitizeContent pipeline (HTML comment stripping, invisible chars, token redaction, etc.)
duration: 
verification_result: passed
completed_at: 2026-04-04T22:49:35.151Z
blocker_discovered: false
---

# T02: Added active-rules retrieval module with fail-open sanitized fetch and wired activeRules into buildReviewPrompt for bounded prompt injection

**Added active-rules retrieval module with fail-open sanitized fetch and wired activeRules into buildReviewPrompt for bounded prompt injection**

## What Happened

Created src/knowledge/active-rules.ts with three surfaces: sanitizeRule (runs full sanitizeContent pipeline + MAX_RULE_TEXT_CHARS truncation), getActiveRulesForPrompt (fail-open bounded retrieval with absolute cap of 20, per-call observability logging), and formatActiveRulesSection (pure formatter returning ## Generated Review Rules markdown). Added activeRules?: SanitizedActiveRule[] to buildReviewPrompt context type and injected the section before custom instructions so recency bias for repo config is preserved. 19 tests in active-rules.test.ts and 11 new tests appended to review-prompt.test.ts.

## Verification

bun test ./src/knowledge/active-rules.test.ts — 19 pass, 0 fail. bun test ./src/execution/review-prompt.test.ts — 178 pass, 0 fail (11 new injection tests). bun run tsc --noEmit — exit 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/active-rules.test.ts` | 0 | ✅ pass | 12ms |
| 2 | `bun test ./src/execution/review-prompt.test.ts` | 0 | ✅ pass | 35ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 10000ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/active-rules.ts`
- `src/knowledge/active-rules.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
