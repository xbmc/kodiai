# M047 S03 Research — Integrated M047 coherence verifier

## Executive read
S03 is a scripts-only composition slice. S01 and S02 already shipped truthful runtime/downstream proof surfaces, M045 S03 still guards contract drift, and M046 already emits the replace verdict plus M047 change contract. The missing work is a top-level `verify:m047` harness that composes those existing reports into one operator-facing milestone proof. Unless the new composition exposes hidden drift, this slice should stay inside `scripts/` plus `package.json`; changing product code would be a smell.

## Relevant requirements
- **R048 (primary)** — end-to-end proof that review/output, retrieval, Slack/profile, and contributor-model paths use the same shipped behavior.
- **R046 (supporting)** — preserve the M045 contributor-experience contract truthfully while proving the shipped surfaces stay coherent.

## Commands run
- `bun run verify:m047:s01 -- --json` → PASS; six runtime truth scenarios present.
- `bun run verify:m047:s02 -- --json` → PASS; embeds S01 and proves downstream Slack/profile/retrieval/identity matrix.
- `bun run verify:m045:s03 -- --json` → PASS; preserves the M045 contract-drift guard across GitHub/retrieval/Slack/identity.
- `bun run verify:m046 -- --json` → PASS; preserves the replace verdict, retained/excluded counts, and the M047 change contract.

## Skill discovery
- Already installed and directly relevant enough: `test` — the right execution skill once implementation starts.
- Per the `find-skills` skill, the most relevant external Bun-focused skill I found was:
  - `npx skills add sickn33/antigravity-awesome-skills@bun-development` — highest-signal Bun result (1.7K installs)
- Promising but not necessary for this slice’s current scope:
  - `npx skills add stablyai/agent-slack@agent-slack` — only useful if S03 unexpectedly reopens live Slack integration instead of proof composition.

## What exists now
1. **`scripts/verify-m047-s01.ts`**
   - Canonical runtime stored-profile truth harness.
   - Owns review/prompt/Review Details evidence.
   - Scenario ids: `linked-unscored`, `legacy`, `stale`, `calibrated`, `opt-out`, `coarse-fallback-cache`.

2. **`scripts/verify-m047-s02.ts`**
   - Canonical downstream stored-profile proof surface.
   - Embeds `evaluateM047S01()` once and adds Slack/profile, link/opt-in continuity, retrieval, and identity-suppression checks.
   - Scenario ids: `linked-unscored`, `legacy`, `stale`, `calibrated`, `malformed`, `opt-out`.

3. **`scripts/verify-m045-s03.ts`**
   - Existing cross-surface contract-drift guard.
   - Embeds `evaluateM045S01()` and verifies retrieval, Slack surfaces, and identity-link copy.
   - This is the milestone’s supporting R046 guard; S03 should preserve it, not replace it.

4. **`scripts/verify-m046.ts`**
   - Existing integrated calibration harness.
   - Embeds M046 S01/S02, validates retained/excluded counts, exposes the replace verdict, and materializes `m047ChangeContract`.

5. **`package.json`**
   - Has `verify:m047:s01`, `verify:m047:s02`, `verify:m045:s03`, and `verify:m046`.
   - Does **not** have `verify:m047`; this slice still needs the milestone-level entrypoint.

## Key findings and surprises
- The clean composition root is **not** `S01 + S02 + M045 S03 + M046 S01 + M046 S02`. It is just:
  - `evaluateM047S02()`
  - `evaluateM045S03()`
  - `evaluateM046()`
  because each of those already preserves its own nested evidence. Reaching deeper would duplicate work and create another drift seam.

- `koprajs` is the safest exact anchor for the top-level `calibrated-retained` scenario. In M046, `koprajs` has:
  - live prompt tier: `newcomer`
  - intended prompt tier: `established`
  which matches the shipped S01/S02 `calibrated` scenario better than `fuzzard` does. `fuzzard` is still valuable supporting evidence for the replace verdict, but its intended `senior` tier does not line up exactly with the current S01/S02 calibrated fixture.

- `fkoemep` is the exact stale/degraded anchor. M046 already marks it stale with missing review evidence, and S01/S02 already show the runtime/degraded behavior that should result.

- The only awkward milestone scenario is coarse fallback. The clean runtime proof is `coarse-fallback-cache` in S01, but there is no matching linked-profile Slack surface by design. The top-level report should say **not applicable** for profile surfaces here rather than inventing a fake linked row. If the milestone insists on a downstream Slack/profile facet, the nearest honest proxy is S02 `legacy` or `malformed`, not the cache-only S01 case.

- Following the `writing-plans` skill’s “file structure before tasks” rule, the natural file boundary is tight: one new milestone script, one new test file, one package.json edit. There is no evidence yet that S03 needs `src/` changes.

## Boundary contracts that matter
- Keep these stable:
  - `src/contributor/experience-contract.ts` vocabulary (`profile-backed`, `coarse-fallback`, `generic-*`)
  - `scripts/verify-m047-s01.ts` scenario ids/check ids
  - `scripts/verify-m047-s02.ts` scenario ids/check ids
  - `scripts/verify-m045-s03.ts` check ids/report structure
  - `scripts/verify-m046.ts` verdict + `m047ChangeContract` structure

- Do not re-derive:
  - stored-profile truth classification
  - Slack/profile continuity semantics
  - calibration verdict/change contract

The new harness should compose the authoritative reports, not reconstruct them from lower-level helpers.

## Constraints imposed by the current codebase
- There is no shared proof-harness utility module. Current verifiers keep validation helpers inline (`normalize*`, `passCheck`, `failCheck`, etc.). S03 should match that local style unless the new script becomes unmanageable.
- The milestone acceptance path is explicit: `bun run verify:m047 -- --json`. A top-level CLI parser like M046’s `parseM046Args()` is the safest precedent for this milestone-level command.
- Top-level JSON should preserve nested report objects, not only flatten them into new checks. The roadmap explicitly wants nested M045/M046 evidence preserved.
- S02 already evaluates S01 internally. Top-level code should not call S01 again unless it is intentionally bypassing S02 for a scenario composer, which would create a second truth path.

## What should be proven first
1. **Scenario mapping**
   - Decide the five milestone scenario ids and exactly which nested evidence powers each one.
   - Recommended mapping:
     - `linked-unscored` → S02 `linked-unscored` + embedded S01 `linked-unscored`
     - `calibrated-retained` → S02 `calibrated` + S01 `calibrated` + M046 row `koprajs` (and optionally `fuzzard` as supporting detail)
     - `stale-degraded` → S02 `stale` + S01 `stale` + M046 row `fkoemep`
     - `opt-out` → S02 `opt-out` + S01 `opt-out` + M045/S02 identity-suppression evidence
     - `coarse-fallback` → S01 `coarse-fallback-cache` + M045 retrieval `coarse-fallback` (with Slack/profile explicitly N/A) **or** S02 `legacy` if product wants a stored-profile downstream example instead of pure cache fallback

2. **Nested report preservation**
   - Validate `evaluateM047S02`, `evaluateM045S03`, and `evaluateM046` report shapes before building milestone checks.

3. **Operator-facing integrated checks**
   - Export stable `M047_CHECK_IDS`.
   - Build scenario-level checks plus nested-report-preservation checks.

4. **CLI + package wiring**
   - `scripts/verify-m047.ts`
   - `scripts/verify-m047.test.ts`
   - `package.json` → `verify:m047`

## Recommended slice boundaries and order
### Unit 1 — New milestone proof harness
**Files**
- Create: `scripts/verify-m047.ts`
- Modify: `package.json`

**Responsibilities**
- call `evaluateM047S02`, `evaluateM045S03`, and `evaluateM046`
- validate nested report shapes and failure states
- export stable top-level types/check ids
- render human + JSON output
- own `parseM047Args()` and `buildM047ProofHarness()`

### Unit 2 — Integrated scenario composer
**Files**
- Modify: `scripts/verify-m047.ts`

**Responsibilities**
- build milestone scenario summaries from nested reports
- avoid re-running lower-level business logic
- attach enough detail for operators to see:
  - review contract state/source/fallback
  - review details status
  - retrieval hint behavior
  - Slack/profile continuity state
  - identity suppression state when applicable
  - contributor-model evidence from the M046 row/verdict/change contract

### Unit 3 — Top-level regression tests
**Files**
- Create: `scripts/verify-m047.test.ts`

**Responsibilities**
- pin exports/check ids/arg parser/package script
- happy path with real nested evaluators
- injected failure cases for:
  - malformed nested report
  - failed nested report
  - missing integrated scenario evidence
  - calibrated-retained drift
  - stale/degraded drift
  - human/JSON output alignment and non-zero exit codes

## Verification plan
- `bun test ./scripts/verify-m047.test.ts`
- `bun run verify:m047 -- --json`
- `bun run verify:m047:s02 -- --json`
- `bun run verify:m045:s03 -- --json`
- `bun run verify:m046 -- --json`
- `bun run tsc --noEmit`

If the implementation reuses real nested evaluators in the happy-path test, a focused regression bundle is reasonable:
- `bun test ./scripts/verify-m047.test.ts ./scripts/verify-m047-s02.test.ts ./scripts/verify-m045-s03.test.ts ./scripts/verify-m046.test.ts`

## Bottom line for roadmap planner
This slice is narrower than the milestone language makes it sound. The product behavior is already in place; S03 is the missing composition layer. Keep the work inside `scripts/verify-m047.ts`, `scripts/verify-m047.test.ts`, and `package.json` unless the new proof exposes a real inconsistency. Reuse `evaluateM047S02`, `evaluateM045S03`, and `evaluateM046` as the only composition inputs. Use `koprajs` as the exact retained-contributor anchor, `fkoemep` as the stale anchor, preserve full nested report JSON, and be explicit when a surface is truly not applicable instead of fabricating fake coherence.