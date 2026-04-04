# S02: Rule Activation and Prompt Injection — UAT

**Milestone:** M036
**Written:** 2026-04-04T23:02:58.115Z

# S02 UAT: Rule Activation and Prompt Injection

## Preconditions
- Repo checked out, `bun install` complete
- No `DATABASE_URL` needed — all checks use pure in-process stubs
- `bun run tsc --noEmit` exits 0 (confirms no type regressions)

---

## TC-01: Activation policy — high-signal pending rule auto-activates

**Goal:** A pending rule with `signalScore = 0.85` (above default threshold 0.7) is promoted to `active` by `applyActivationPolicy`.

**Steps:**
1. Import `applyActivationPolicy`, `shouldAutoActivate`, `DEFAULT_ACTIVATION_THRESHOLD` from `src/knowledge/generated-rule-activation.ts`
2. Construct a `GeneratedRuleStore` stub with:
   - `listRulesForRepo(repo, { status: 'pending' })` returning one rule with `signalScore: 0.85`
   - `activateRule(id)` returning a copy of the rule with `status: 'active'`
3. Call `applyActivationPolicy({ store, logger, repo: 'xbmc/xbmc' })`
4. Assert `result.activated === 1`
5. Assert `result.activatedRules[0].status === 'active'`
6. Assert `result.activationFailures === 0`

**Expected:** Policy result reports 1 activation, 0 failures.

**Automated coverage:** `bun test ./src/knowledge/generated-rule-activation.test.ts` — test: `applyActivationPolicy > activates rules that meet the threshold`

---

## TC-02: Activation policy — below-threshold rule is skipped

**Goal:** A pending rule with `signalScore` below the threshold is NOT activated.

**Steps:**
1. Construct store stub returning a rule with `signalScore: 0.65` (below default 0.7)
2. Confirm `activateRule` is never called
3. Assert `result.activated === 0`, `result.skipped === 1`

**Expected:** Policy result reports 0 activations.

**Automated coverage:** `generated-rule-activation.test.ts` — `applyActivationPolicy > skips rules below the threshold`

---

## TC-03: Activation policy — boundary condition at exact threshold

**Goal:** `shouldAutoActivate` returns `true` at exactly the threshold value.

**Steps:**
1. Call `shouldAutoActivate(DEFAULT_ACTIVATION_THRESHOLD, DEFAULT_ACTIVATION_THRESHOLD)`
2. Assert return value is `true`
3. Call `shouldAutoActivate(DEFAULT_ACTIVATION_THRESHOLD - 0.01, DEFAULT_ACTIVATION_THRESHOLD)`
4. Assert return value is `false`

**Expected:** Boundary is inclusive (≥ threshold activates).

**Automated coverage:** `generated-rule-activation.test.ts` — `shouldAutoActivate > returns true when score equals threshold`

---

## TC-04: Activation policy — fail-open on store error

**Goal:** When `store.activateRule` throws, `applyActivationPolicy` catches the error and counts it as `activationFailures` without propagating.

**Steps:**
1. Construct store stub where `activateRule` throws `new Error('DB timeout')`
2. Run `applyActivationPolicy` against a rule that meets the threshold
3. Assert the call does NOT throw
4. Assert `result.activationFailures === 1`, `result.activated === 0`

**Expected:** Fail-open: activation failure counted, no exception propagated.

**Automated coverage:** `generated-rule-activation.test.ts` — `applyActivationPolicy > counts activation failures without throwing (fail-open)`

---

## TC-05: Active-rule retrieval — sanitized rules returned

**Goal:** `getActiveRulesForPrompt` returns rules sanitized through the content pipeline.

**Steps:**
1. Construct store returning one active rule with ruleText containing an HTML comment: `<!-- hidden -->`
2. Call `getActiveRulesForPrompt({ store, repo: 'xbmc/xbmc', logger })`
3. Assert `result.rules.length === 1`
4. Assert `result.rules[0].ruleText` does NOT contain `<!-- hidden -->`

**Expected:** HTML comment is stripped from sanitized output.

**Automated coverage:** `active-rules.test.ts` — `sanitizeRule > strips HTML comments from title and ruleText`

---

## TC-06: Active-rule retrieval — absolute cap of 20 enforced

**Goal:** Even when the store returns more than 20 rules, `getActiveRulesForPrompt` caps at 20.

**Steps:**
1. Construct store returning 25 active rules
2. Call `getActiveRulesForPrompt({ store, repo, logger, limit: 100 })`
3. Assert `result.rules.length === 20`
4. Assert `result.truncatedCount === 5`

**Expected:** Cap enforced regardless of caller-configured limit.

**Automated coverage:** `active-rules.test.ts` — `getActiveRulesForPrompt > applies absolute cap of 20 when limit exceeds it`

---

## TC-07: Active-rule retrieval — fail-open on store error

**Goal:** When `store.getActiveRulesForRepo` throws, `getActiveRulesForPrompt` returns an empty result and emits a warn log.

**Steps:**
1. Construct store where `getActiveRulesForRepo` always throws
2. Provide a spy logger
3. Call `getActiveRulesForPrompt({ store, repo, logger })`
4. Assert `result.rules.length === 0`, `result.totalActive === 0`
5. Assert spy logger received at least one `warn` call

**Expected:** Empty result returned, warn emitted, no exception propagated.

**Automated coverage:** `active-rules.test.ts` — `getActiveRulesForPrompt > fail-open: returns empty result when store throws`

---

## TC-08: Prompt section formatting — rules present

**Goal:** `formatActiveRulesSection` produces a `## Generated Review Rules` markdown block containing rule title, text excerpt, and signal score.

**Steps:**
1. Provide one `SanitizedActiveRule` with `title: 'Always guard pointers'`, `ruleText: 'Add an explicit null check...'`, `signalScore: 0.85`
2. Call `formatActiveRulesSection([rule])`
3. Assert section contains `## Generated Review Rules`
4. Assert section contains the rule title
5. Assert section contains `signal:` label with `0.85` formatted to 2 decimal places

**Expected:** Formatted markdown section with all required fields.

**Automated coverage:** `active-rules.test.ts` — `formatActiveRulesSection > includes section header and each rule title`

---

## TC-09: Prompt section formatting — empty rules returns empty string

**Goal:** `formatActiveRulesSection([])` returns an empty string (no section header emitted).

**Steps:**
1. Call `formatActiveRulesSection([])`
2. Assert result is `''`

**Expected:** Empty string — section is completely absent when no rules.

**Automated coverage:** `active-rules.test.ts` — `formatActiveRulesSection > returns empty string for empty rules array`

---

## TC-10: Review prompt injection — active rules appear before custom instructions

**Goal:** When `activeRules` is provided to `buildReviewPrompt`, the Generated Review Rules section appears before any custom instructions.

**Steps:**
1. Call `buildReviewPrompt` with `activeRules: [rule]` and `customInstructions: 'Focus on X'`
2. Find the index of `## Generated Review Rules` in the output
3. Find the index of `'Focus on X'` in the output
4. Assert rules section index < custom instructions index

**Expected:** Rules section precedes custom instructions (rules section placed before custom instructions for recency bias).

**Automated coverage:** `review-prompt.test.ts` — `buildReviewPrompt active rules injection > active rules section appears before custom instructions`

---

## TC-11: Review prompt injection — absent when no rules provided

**Goal:** When `activeRules` is absent or empty, the Generated Review Rules section does not appear in the prompt.

**Steps:**
1. Call `buildReviewPrompt` without `activeRules` field
2. Assert prompt does NOT contain `## Generated Review Rules`
3. Call `buildReviewPrompt` with `activeRules: []`
4. Assert prompt does NOT contain `## Generated Review Rules`

**Expected:** Section completely omitted — backward-compatible behavior.

**Automated coverage:** `review-prompt.test.ts` — `buildReviewPrompt active rules injection > omits Generated Review Rules section when activeRules is absent`

---

## TC-12: Proof harness — full pipeline end-to-end

**Goal:** `bun run verify:m036:s02 -- --json` exits 0 with all three checks passing.

**Steps:**
1. Run: `bun run verify:m036:s02 -- --json`
2. Parse JSON output
3. Assert `overallPassed === true`
4. Assert all 3 check IDs present: `M036-S02-ACTIVATION`, `M036-S02-PROMPT-INJECTION`, `M036-S02-FAIL-OPEN`
5. Assert each check has `passed: true`, `skipped: false`

**Expected:** 3/3 PASS, exit code 0.

**Automated coverage:** `verify-m036-s02.test.ts` — `buildM036S02ProofHarness > prints valid JSON in json mode`

---

## Edge Cases

| Case | Expected behavior |
|------|-------------------|
| `signalScore` exactly at threshold | Rule activates (boundary is inclusive ≥) |
| `activateRule` returns `null` | Counted as `activationFailures`, not `activated` |
| Store throws during rule listing | `applyActivationPolicy` propagates error (only `activateRule` per-rule errors are caught) |
| `ruleText` exceeds `MAX_RULE_TEXT_CHARS` | Truncated with `truncated: true` flag set on sanitized rule |
| GitHub token in `ruleText` | Redacted by `sanitizeContent` pipeline before entering prompt |
| 25 rules in store, limit=100 | Exactly 20 returned, `truncatedCount=5` |

