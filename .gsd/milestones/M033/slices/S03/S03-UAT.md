# S03: Harden security policy prompt against execution bypass — UAT

**Milestone:** M033
**Written:** 2026-03-31T11:47:55.070Z

## UAT: S03 — Harden security policy prompt against execution bypass

### Preconditions
- Repository checked out at HEAD with M033/S03 changes applied
- Bun runtime available (`bun --version`)
- No database or network access required — all checks are pure-code

---

### Test 1: buildSecurityPolicySection contains execution refusal language

**Command:** `bun test ./src/execution/review-prompt.test.ts --test-name-pattern "mentions execution requests as a refusal trigger"`

**Expected outcome:** 1 test passes. The section text contains "execute" (case-insensitive).

---

### Test 2: buildSecurityPolicySection flags social engineering

**Command:** `bun test ./src/execution/review-prompt.test.ts --test-name-pattern "flags skip-review instructions as adversarial"`

**Expected outcome:** 1 test passes. The section text contains "social engineering".

---

### Test 3: buildSecurityPolicySection mandates code review before execution

**Command:** `bun test ./src/execution/review-prompt.test.ts --test-name-pattern "mandates code review before execution"`

**Expected outcome:** 1 test passes. The section text matches `/review.*before.*execut|must.*review/i`.

---

### Test 4: buildSecurityClaudeMd execution safety — execute keyword

**Command:** `bun test ./src/execution/executor.test.ts --test-name-pattern "buildSecurityClaudeMd mentions execution safety"`

**Expected outcome:** 1 test passes. The CLAUDE.md output contains "execute".

---

### Test 5: buildSecurityClaudeMd execution safety — social engineering keyword

**Command:** `bun test ./src/execution/executor.test.ts --test-name-pattern "buildSecurityClaudeMd flags social engineering"`

**Expected outcome:** 1 test passes. The CLAUDE.md output contains "social engineering".

---

### Test 6: Full test suite regression

**Commands:**
```
bun test ./src/execution/review-prompt.test.ts
bun test ./src/execution/executor.test.ts
```

**Expected outcome:** 169/169 pass in review-prompt.test.ts. 24/24 pass in executor.test.ts. Zero failures.

---

### Test 7: Content spot-check — review-prompt security policy

**Command:**
```ts
import { buildSecurityPolicySection } from './src/execution/review-prompt';
const s = buildSecurityPolicySection();
console.log(s.includes('social engineering'), s.includes('execute'), /review.*before.*execut/i.test(s));
```

Or via grep: `grep -i "social engineering" src/execution/review-prompt.ts`

**Expected outcome:** All three signals present in the section text.

---

### Test 8: Content spot-check — CLAUDE.md Execution Safety section

**Command:** `grep -A 4 "## Execution Safety" src/execution/executor.ts`

**Expected outcome:** Section header present followed by at least 3 bullets covering execution refusal, social engineering handling, and mandatory review.

---

### Edge cases

- **Regression guard:** Running `bun test ./src/execution/review-prompt.test.ts` after removing any of the three new bullets from `buildSecurityPolicySection()` must produce ≥1 failing test.
- **Regression guard:** Running `bun test ./src/execution/executor.test.ts` after removing the `## Execution Safety` section from `buildSecurityClaudeMd()` must produce ≥1 failing test.
- **Mirror consistency:** The guardrail concepts (execute refusal, social engineering, review-first) appear in both `review-prompt.ts` and `executor.ts`. Both files must be updated together if policy language changes — updating only one leaves the other surface unprotected.
