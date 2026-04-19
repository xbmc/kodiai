# M051 S03 Research — Residual operator truthfulness cleanup

## Requirement focus
- **No active requirement is directly owned by S03.** `R055` is already validated in S02.
- This slice **supports** the still-active operator-proof requirements behind the M048 review evidence surfaces:
  - **R049** — operator-visible review behavior must stay truthful
  - **R050** — per-phase latency evidence must stay truthful on operator-visible surfaces
- In practice, S03 is a small cleanup slice that keeps the shipped M048 verifier/runbook surfaces from contradicting their own data.

## Executive summary
- Scope is much smaller than the roadmap title suggests. The closed `xbmc/kodiai` **PR #87** has **3 inline review comments**; only **2 are still operator/verifier truthfulness bugs** on `main`.
- The live truthfulness debt is localized to two places:
  1. `docs/runbooks/review-requested-debug.md` still says `## M050 Timeout-Truth Verifier Surfaces` even though every command under it is `verify:m048:s01/s02/s03`.
  2. `scripts/verify-m048-s01.ts` still collapses **evidence-present but null-field** cases into misleading summaries.
- The real root cause is one layer lower than the S01 renderer: `src/review-audit/phase-timing-evidence.ts` currently accepts missing `conclusion` / `published` fields as a clean payload (`status: ok`, `issues: []`), so the verifier can go false-green before the summary wording even runs.
- Smallest safe path:
  - per **systematic-debugging**: fix the provenance seam first (`buildPhaseTimingEvidence()`), not just the display string
  - per **test-driven-development**: add failing regressions first in `src/review-audit/phase-timing-evidence.test.ts` and `scripts/verify-m048-s01.test.ts`
  - then patch the runbook header drift
- The third PR #87 inline comment (`src/handlers/review.ts` redefines the `timeoutProgress` type instead of importing `TimeoutReviewDetailsProgress`) is real, but it is **maintainability debt, not operator/verifier truthfulness debt**. Either fold that one-line import cleanup into the slice while touching nearby code, or explicitly defer it so it is not stranded again.

## Skill discovery
Installed skill already directly relevant:
- `gh`
  - useful for reading the closed PR review comment set via `gh api` instead of scraping GitHub HTML.

Promising external skills (not installed, not required for this slice):
- **TypeScript**: `npx skills add wshobson/agents@typescript-advanced-types`
  - highest-result TypeScript match from `npx skills find "TypeScript"` (33.5K installs)
- **Azure / Kusto / Log Analytics**: `npx skills add microsoft/azure-skills@azure-kusto`
  - highest-result Azure Log Analytics/Kusto match from `npx skills find "Azure Log Analytics"` (205.7K installs)

No install is needed for S03. Existing repo patterns are enough.

## Implementation landscape
### Closed PR evidence source
- `gh api repos/xbmc/kodiai/pulls/87/comments --paginate`
  - authoritative source for the inline review comments that S03 is meant to retire
  - current inline comments are:
    1. `src/handlers/review.ts` — duplicate `timeoutProgress` type shape
    2. `docs/runbooks/review-requested-debug.md` — `M050` header drift vs `M048` commands
    3. `scripts/verify-m048-s01.ts` — misleading summary when phase evidence exists but `conclusion`/`published` fields are null

### Files that matter now
- `src/review-audit/phase-timing-evidence.ts`
  - parser/normalizer for the phase timing log payload
  - today it validates `totalDurationMs` and the six phases, but **does not validate `conclusion` or `published`**
  - this is the root provenance seam; if it stays permissive, `verify:m048:s01` can still report a clean row even when operator-critical fields are absent
- `src/review-audit/phase-timing-evidence.test.ts`
  - currently has coverage for malformed phases, missing `totalDurationMs`, timeout degraded/unavailable phases
  - **missing coverage** for absent `conclusion` / `published`
- `scripts/verify-m048-s01.ts`
  - `deriveM048S01Outcome()` turns parsed evidence into the operator-facing `outcome.class` and `outcome.summary`
  - current bugs:
    - `!evidence` and `evidence present but conclusion/published null` both collapse to `"no correlated phase evidence available"`
    - `conclusion: "success", published: null` renders `"success (no published output)"`
    - `conclusion: "timeout", published: null` renders `"timeout (no visible output published)"`
- `scripts/verify-m048-s01.test.ts`
  - currently covers the happy path, Azure unavailable, invalid args, and human report rendering
  - **missing null-field truthfulness regressions**
- `scripts/verify-m048-s03.ts`
  - downstream consumer: it prints `report.live.phaseTiming.outcome.summary`
  - this means fixing S01 summary truth automatically improves the later operator-facing M048 S03 surface too
- `docs/runbooks/review-requested-debug.md`
  - only live docs drift found from PR #87
  - section header at line 108 still says `M050` while commands below are `verify:m048:*`
  - no automated test covers this doc today
- `src/handlers/review.ts`
  - optional non-scope cleanup: imports many helpers from `src/lib/review-utils.ts` but still hand-rolls the `timeoutProgress` shape instead of using exported `TimeoutReviewDetailsProgress`
- `src/lib/review-utils.ts`
  - already exports `TimeoutReviewDetailsProgress`

## Key findings and surprises
1. **This is a light cleanup slice, not an architecture slice.**
   - No new subsystem is needed.
   - No external docs were needed.
   - The fix surface is one parser, one verifier script, one runbook, and optional one-line type cleanup.

2. **The verifier bug is worse than the original review comment described.**
   - The PR comment called out `evidence && conclusion === null`.
   - The current implementation also mishandles `published === null` in the specialized `success` and `timeout` branches.

3. **The root cause is parser permissiveness, not just renderer wording.**
   - Reproduction from the current repo:
     - `buildPhaseTimingEvidence()` with a row missing `conclusion` / `published` returns:
       - `status: "ok"`
       - `issues: []`
       - `evidence.conclusion: null`
       - `evidence.published: null`
   - That means the operator verifier can report a nominally valid row even though key interpretation fields are absent.

4. **The misleading summaries are reproducible today with one-liners.**
   - `deriveM048S01Outcome({ conclusion: null, published: null, ... })`
     - returns `summary: "no correlated phase evidence available"`
     - but evidence actually exists
   - `deriveM048S01Outcome({ conclusion: "success", published: null, ... })`
     - returns `summary: "success (no published output)"`
     - but publication is unknown, not false
   - `deriveM048S01Outcome({ conclusion: "timeout", published: null, ... })`
     - returns `summary: "timeout (no visible output published)"`
     - but publication is unknown, not false

5. **The docs drift is truly isolated.**
   - `rg` shows only one `M050 Timeout-Truth Verifier Surfaces` header in the repo.
   - This is a one-file operator-truthfulness patch, not a docs sweep.

6. **There is one remaining PR #87 comment that is probably out of scope.**
   - The `TimeoutReviewDetailsProgress` import comment is legitimate, but it is not operator/verifier truthfulness.
   - If the slice is kept strictly scoped, record an explicit defer rationale.
   - If the slice wants to clear all PR #87 inline comments in one pass, it is a trivial extra edit.

## Recommended task seams
### Task 1 — Fix the phase-evidence contract at the parser seam
Files:
- `src/review-audit/phase-timing-evidence.ts`
- `src/review-audit/phase-timing-evidence.test.ts`

What to do:
- Add failing tests for rows where `conclusion` and/or `published` are missing.
- Treat those missing fields as **payload issues**, the same way missing `totalDurationMs` is already treated.
- Keep the evidence object populated so operators still see the matched row + phases, but stop marking the payload clean.

Likely desired behavior:
- add issues such as:
  - `Missing conclusion on Review phase timing summary payload.`
  - `Missing published on Review phase timing summary payload.`
- allow `buildPhaseTimingEvidence()` to return `status: "invalid-phase-payload"` when those fields are absent

Why first:
- This is the root-cause seam from the **systematic-debugging** skill.
- Fixing only `deriveM048S01Outcome()` would still leave false-green parser results.

### Task 2 — Fix `verify:m048:s01` outcome wording for tri-state publication truth
Files:
- `scripts/verify-m048-s01.ts`
- `scripts/verify-m048-s01.test.ts`

What to do:
- Add failing tests first for:
  - evidence present + `conclusion: null`
  - `conclusion: "success", published: null`
  - `conclusion: "timeout", published: null`
- Keep `"no correlated phase evidence available"` only for the actual `!evidence` case.
- Make success/timeout summaries preserve the tri-state publication contract:
  - `published === true`
  - `published === false`
  - `published === null` → `publication unknown`

Why this matters:
- This string is emitted directly in the S01 human report and reused downstream by `scripts/verify-m048-s03.ts`.

### Task 3 — Patch the runbook header drift
File:
- `docs/runbooks/review-requested-debug.md`

What to do:
- Rename `## M050 Timeout-Truth Verifier Surfaces` to an `M048`-correct heading.
- Do not widen scope; the commands under the section are already correct.

Verification style:
- targeted grep is enough
- no need to invent a new docs test harness for a one-line runbook drift fix

### Task 4 — Decide explicitly on the non-truthfulness leftover
Files if folded in:
- `src/handlers/review.ts`

What to do:
- either import `TimeoutReviewDetailsProgress` from `src/lib/review-utils.ts` and delete the inline shape
- or explicitly defer it in slice/task notes as non-truthfulness debt

Planner note:
- This is the only part of PR #87 debt that is not really S03’s core contract. Do not let it silently survive without a conscious choice.

## What to build or prove first
1. **Add the parser-level failing tests first.**
   - This proves the real bug is “missing fields treated as valid evidence,” not just copy drift.
2. **Add the outcome-summary failing tests next.**
   - This locks the exact operator wording regressions before touching implementation.
3. **Implement the parser and summary fixes.**
4. **Patch the runbook header.**
5. **Make the explicit keep-or-defer decision on the `TimeoutReviewDetailsProgress` comment.**

## Verification baseline
Fresh evidence gathered during research:

### Closed PR #87 audit
- `gh api repos/xbmc/kodiai/pulls/87/comments --paginate --jq '.[] | {path, line, side, body, author: .user.login, created_at, html_url}'`
  - confirmed exactly **3** inline review comments
  - only **2** are operator/verifier truthfulness drift on `main`

### Current test baseline
- `bun test ./scripts/verify-m048-s01.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./src/lib/review-utils.test.ts`
  - **22 pass / 0 fail**

### Reproduced verifier-summary drift
- `bun -e "import { deriveM048S01Outcome } from './scripts/verify-m048-s01.ts'; ..."`
  - reproduced:
    - `missing both` → `"no correlated phase evidence available"`
    - `success missing publication` → `"success (no published output)"`
    - `timeout missing publication` → `"timeout (no visible output published)"`

### Reproduced parser false-green
- `bun -e "import { buildPhaseTimingEvidence } from './src/review-audit/phase-timing-evidence.ts'; ..."`
  - reproduced:
    - `status: "ok"`
    - `issues: []`
    - `conclusion: null`
    - `published: null`

### Reproduced runbook drift
- `rg -n "^## M050 Timeout-Truth Verifier Surfaces$|verify:m048:s01|verify:m048:s02|verify:m048:s03" docs/runbooks/review-requested-debug.md`
  - shows the stale `M050` header directly above `verify:m048:*` commands

## Verification plan for S03
Minimum completion bar:
- `bun test ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts`
- `bun test ./scripts/verify-m048-s02.test.ts ./scripts/verify-m048-s03.test.ts`
  - downstream guard because S02/S03 consume the S01 report shape / summary surface
- `! rg -n "^## M050 Timeout-Truth Verifier Surfaces$" docs/runbooks/review-requested-debug.md`
- `rg -n "^## M048 .*Verifier Surfaces$|verify:m048:s01|verify:m048:s02|verify:m048:s03" docs/runbooks/review-requested-debug.md`
- `bun run tsc --noEmit`

If Task 4 (type cleanup) is included, add:
- `bun test ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts`

## Recommendation
Treat S03 as a **small debt-retirement slice**:
- fix the parser false-green in `src/review-audit/phase-timing-evidence.ts`
- fix the tri-state outcome wording in `scripts/verify-m048-s01.ts`
- fix the one stale `M050` runbook header
- consciously choose whether to fold in or defer the separate `TimeoutReviewDetailsProgress` type comment

That path is low-risk, directly tied to the closed PR evidence, and consistent with the loaded skills:
- **systematic-debugging** → fix root cause before surface copy
- **test-driven-development** → add failing regressions before editing code
- **gh** → use GitHub API evidence, not memory, for what PR #87 actually left behind

No new architecture, no library research, and no broad docs sweep are needed.