# S01: Env Allowlist — buildAgentEnv() — UAT

**Milestone:** M031
**Written:** 2026-03-28T16:44:36.481Z

## UAT: S01 — Env Allowlist (buildAgentEnv())

### Preconditions

- Node/Bun environment with `src/execution/env.ts` present
- `bun` installed and `bun test` runnable from the repo root
- No DATABASE_URL or GITHUB_PRIVATE_KEY set in the test execution environment (they should be blocked regardless)

---

### Test Cases

#### TC-01: Test suite passes with exit 0

**Steps:**
1. Run `bun test src/execution/env.test.ts`

**Expected:**
- Output: `10 pass, 0 fail`
- Exit code: 0
- All 10 named tests show `(pass)`

---

#### TC-02: Application secrets are blocked

**Steps:**
1. Inspect `src/execution/env.test.ts` test `"blocks application secret keys"`
2. Confirm it sets GITHUB_PRIVATE_KEY, GITHUB_PRIVATE_KEY_BASE64, GITHUB_APP_ID, GITHUB_WEBHOOK_SECRET, DATABASE_URL, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, VOYAGE_API_KEY, BOT_USER_PAT in process.env
3. Confirm `buildAgentEnv()` result is asserted undefined for each

**Expected:** Test passes; 9 keys blocked

---

#### TC-03: SDK auth vars are forwarded

**Steps:**
1. Inspect test `"forwards SDK auth vars when set"`
2. Confirm CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY are set and then asserted present in result

**Expected:** Test passes; both keys forwarded with correct values

---

#### TC-04: System vars are forwarded

**Steps:**
1. Inspect test `"forwards system vars when set"`
2. Confirm HOME, PATH, USER are set to test values and asserted present in result

**Expected:** Test passes; all three system keys forwarded

---

#### TC-05: Unknown vars are blocked

**Steps:**
1. Inspect test `"blocks unknown arbitrary vars"`
2. Confirm SOME_UNKNOWN_SECRET is set but asserted absent

**Expected:** Test passes; arbitrary key blocked

---

#### TC-06: Absent allowlisted keys are omitted (not undefined)

**Steps:**
1. Inspect test `"omits allowlisted keys that are not set in process.env"`
2. Confirm TMPDIR is deleted from process.env, then `Object.prototype.hasOwnProperty.call(env, "TMPDIR")` asserted false

**Expected:** Test passes; key entirely absent from result object

---

#### TC-07: CLAUDE_CODE_ENTRYPOINT is excluded from allowlist

**Steps:**
1. Inspect test `"does not include CLAUDE_CODE_ENTRYPOINT (callers set it)"` (AGENT_ENV_ALLOWLIST describe)
2. Inspect test `"does not include CLAUDE_CODE_ENTRYPOINT"` (buildAgentEnv describe)

**Expected:** Both tests pass; CLAUDE_CODE_ENTRYPOINT absent from allowlist and absent from buildAgentEnv() result

---

#### TC-08: executor.ts uses buildAgentEnv()

**Steps:**
1. Open `src/execution/executor.ts`
2. Search for `buildAgentEnv`
3. Confirm import from `./env.ts` is present
4. Confirm the agent spawn env object contains `...buildAgentEnv()` (not `...process.env`)
5. Confirm `CLAUDE_CODE_ENTRYPOINT: 'kodiai-github-app'` is still present as a separate key

**Expected:** Import present; spread uses buildAgentEnv(); entrypoint key is set by the call site

---

#### TC-09: generate.ts uses buildAgentEnv()

**Steps:**
1. Open `src/llm/generate.ts`
2. Search for `buildAgentEnv`
3. Confirm import from `../execution/env.ts` is present
4. Confirm the agent spawn env object contains `...buildAgentEnv()` (not `...process.env`)
5. Confirm `CLAUDE_CODE_ENTRYPOINT: 'kodiai-llm-generate'` is still present

**Expected:** Import present; spread uses buildAgentEnv(); entrypoint key is set by the call site

---

#### TC-10: AGENT_ENV_ALLOWLIST is exported and non-empty

**Steps:**
1. Run `bun test src/execution/env.test.ts --test-name-pattern "is a non-empty array"`
2. Confirm test passes

**Expected:** Array.isArray true; length > 0 (actual: 26 elements)

