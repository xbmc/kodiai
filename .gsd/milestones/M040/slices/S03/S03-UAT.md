# S03: Bounded Prompt Integration, Bypass, and Validation Gate — UAT

**Milestone:** M040
**Written:** 2026-04-05T12:34:48.984Z

## UAT Script — M040/S03: Bounded Prompt Integration, Bypass, and Validation Gate

**Preconditions:**
- Repository checked out at `HEAD` (all S03 task code merged)
- Bun v1.3.8+ installed
- `bun install` run (no additional services required — all checks are pure-code or fixture-driven)

---

### TC-01: Proof Harness Exit 0 — All 4 Checks Pass

**Purpose:** Confirm the machine-verifiable proof of all S03 operational properties.

**Steps:**
1. Run `bun run verify:m040:s03 -- --json`
2. Inspect JSON output

**Expected outcome:**
- Exit code: `0`
- `overallPassed: true`
- `checks[0].id = "M040-S03-PROMPT-BOUNDED"` with `passed: true`, `detail` contains `withinBudget=true`
- `checks[1].id = "M040-S03-TRIVIAL-BYPASS"` with `passed: true`, `detail` contains `bypass=true` for small PR, `bypass=false` for large and zero PRs
- `checks[2].id = "M040-S03-FAIL-OPEN-VALIDATION"` with `passed: true`, `detail` contains `neverThrew=true` and `originalFindingsPreserved=true`
- `checks[3].id = "M040-S03-VALIDATION-ANNOTATES"` with `passed: true`, `detail` contains `allAmplifiedAnnotated=true` and `directFindingSkipped=true`

---

### TC-02: Bounded Prompt Section — Char Budget Enforcement

**Purpose:** Confirm the graph context section never exceeds `maxChars`.

**Steps:**
1. Import `buildGraphContextSection` from `src/review-graph/prompt-context.ts`
2. Build a blast radius with 20 impacted files, 10 likely tests, 10 probable dependents (each with long paths and reasons)
3. Call `buildGraphContextSection(blastRadius, { maxChars: 500 })`
4. Inspect `result.stats.charCount` and `result.text.length`

**Expected outcome:**
- `result.stats.charCount <= 500`
- `result.text.length <= 500` (or within truncation-note overhead)
- `result.truncated === true`
- `result.text` contains a truncation note (e.g., "... truncated")

**Edge case — null blast radius:**
- Call `buildGraphContextSection(null)`
- `result.text === ""`, `result.stats.charCount === 0`, `result.truncated === false`

---

### TC-03: Trivial-Change Bypass — Threshold and Fail-Closed Behavior

**Purpose:** Confirm bypass fires at/below threshold and is fail-closed on zero files.

**Steps:**
1. Import `isTrivialChange` from `src/review-graph/validation.ts`
2. Test: `isTrivialChange({ changedFileCount: 1 })` → `{ bypass: true, reason: contains "lte-threshold" }`
3. Test: `isTrivialChange({ changedFileCount: 3 })` → `{ bypass: true }` (at threshold)
4. Test: `isTrivialChange({ changedFileCount: 4 })` → `{ bypass: false }`
5. Test: `isTrivialChange({ changedFileCount: 0 })` → `{ bypass: false, reason: "no-files" }` (**fail-closed**)
6. Test: `isTrivialChange({ changedFileCount: 1, trivialFileThreshold: 5 })` → `{ bypass: true }`

**Expected outcome:** All assertions above hold. Zero-file case must return `bypass: false`.

---

### TC-04: Validation Gate — Fail-Open on LLM Error

**Purpose:** Confirm the validation gate never blocks review completion when the LLM throws.

**Steps:**
1. Import `validateGraphAmplifiedFindings` from `src/review-graph/validation.ts`
2. Prepare 2 findings: one on an amplified file (`impactedFiles[0]`), one on a changed file
3. Prepare a blast radius with `impactedFiles = [amplifiedFilePath]`
4. Pass a throwing `llm` stub: `async () => { throw new Error("LLM unavailable") }`
5. Call `validateGraphAmplifiedFindings({ enabled: true, findings, blastRadius, changedPaths: new Set([changedFilePath]), llm: throwingLlm })`

**Expected outcome:**
- Function does NOT throw
- `result.succeeded === false`
- `result.findings` is identical to the input findings (same array length and IDs)
- `result.validatedCount === 0`

---

### TC-05: Validation Gate — Non-Destructive Annotation

**Purpose:** Confirm that amplified findings get annotated and changed-file findings are skipped.

**Steps:**
1. Prepare 3 findings: `finding-A` on amplified file, `finding-B` on amplified file, `finding-C` on a directly changed file
2. Pass an `llm` stub that returns `{ "finding-A": "confirmed", "finding-B": "uncertain" }` as JSON
3. Call `validateGraphAmplifiedFindings({ enabled: true, findings: [A, B, C], blastRadius, changedPaths: Set([C.filePath]), llm })`

**Expected outcome:**
- `result.succeeded === true`
- `finding-A` in output has `graphValidated: true`, `graphValidationVerdict: "confirmed"`
- `finding-B` in output has `graphValidated: true`, `graphValidationVerdict: "uncertain"`
- `finding-C` in output has `graphValidated: false`, `graphValidationVerdict: "skipped"` (directly changed — not amplified)
- No findings are removed from output
- `result.validatedCount === 2`

---

### TC-06: Review Prompt Integration — Graph Section Position

**Purpose:** Confirm the graph section appears in the correct position in the assembled prompt.

**Steps:**
1. Import `buildReviewPrompt` from `src/execution/review-prompt.ts`
2. Call with a non-null `graphBlastRadius` containing at least one impacted file
3. Inspect the returned prompt string

**Expected outcome:**
- Prompt contains `## Graph Impact Context` (or equivalent section heading)
- Section appears AFTER incremental-review context section (if present)
- Section appears BEFORE knowledge-retrieval context section (if present)
- Prompt contains the impacted file path and a confidence label (`high`/`medium`/`low`)

**Backward-compat check:**
- Call `buildReviewPrompt` WITHOUT `graphBlastRadius`
- Prompt does NOT contain `## Graph Impact Context`
- All other sections render identically to pre-S03 output

---

### TC-07: Full Test Suite — No Regressions

**Purpose:** Confirm S03 additions did not regress any existing tests.

**Steps:**
1. Run `bun test ./src/review-graph/ ./src/execution/review-prompt.test.ts`

**Expected outcome:**
- `235 pass, 7 skip (DB-gated store tests), 0 fail`
- DB-skipped tests are `createReviewGraphStore` tests — expected when no `TEST_DATABASE_URL` is set

---

### TC-08: TypeScript Strict Compilation

**Purpose:** Confirm no type errors introduced by S03.

**Steps:**
1. Run `bun run tsc --noEmit`

**Expected outcome:**
- Exit code `0`, no output (clean compile)

---

### TC-09: Disabled-by-Default Validation Gate — No Behavioral Change

**Purpose:** Confirm the validation gate is truly inert when not explicitly enabled.

**Steps:**
1. Call `validateGraphAmplifiedFindings({ findings: [someFindings], blastRadius, changedPaths })` with no `enabled` or `llm` provided

**Expected outcome:**
- `result.succeeded === true`
- All findings have `graphValidated: false`, `graphValidationVerdict: "skipped"`
- No LLM calls made
- Function completes synchronously (no async I/O)
