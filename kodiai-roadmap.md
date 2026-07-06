# Kodiai Roadmap — Phases, Milestones, and GitHub Issues

**Authored:** 2026-04-20
**Codebase:** `/Users/keith/src/kodiai`
**Baseline:** M052 complete, M027–M029 + M031–M032 queued, M053 not yet started
**Framework:** Get Shit Done v2 (mirrors existing `.gsd/milestones/MnXX/` convention)

---

## How to read this document

The roadmap is organized into five **phases** by urgency and theme. Each phase contains one or more **milestones**, and each milestone is broken into **slices** — one slice per GitHub issue. Every slice issue is written in the shape the Kodiai GSD v2 verifier stack already expects:

- A CONTEXT-doc-style problem statement (why this exists, user-visible outcome, scope, non-goals).
- Acceptance criteria as a checkbox list, phrased as success-criteria results.
- Files created or modified, with exact paths.
- A verify script contract (command, `status_code` on pass, nested check IDs) so the slice can be mechanically closed.
- Cross-links to DECISIONS.md entries that should be created with the slice.

When a slice's title already matches a queued milestone with an existing CONTEXT.md (M027, M028, M029, M031, M032), the slice points back to that document rather than redefining scope.

Numbering picks up at **M053** for net-new milestones, preserving the queued numbers. QUEUE.md needs a full refresh — see M054/S01.

---

## Phase 1 — Stop the Bleeding

**Theme:** Fix production-visible defects and the one foot-gun sitting in the main source tree.

**Sequencing rationale:** M029 is causing complaints on `xbmc/wiki#5` *today*, so contributor-facing noise stops first. M028 is the right-shaped replacement for whatever M029 produces, so it lands immediately after. M027 restores retrieval trust. M053 is a one-hour chore but it removes an unsafe-eval import path from `src/` before any further security work (Phase 4) lands on top of it.

| Milestone | Title | Slices | Status |
|---|---|---|---|
| M029 | Wiki Generation Quality & Issue Cleanup | existing CONTEXT.md | queued |
| M028 | Wiki Modification-Only Publishing | existing CONTEXT.md | queued |
| M027 | Embedding Integrity & Timeout Hardening | existing CONTEXT.md | queued |
| M053 | Unsafe `new Function()` Removal | S01 | new |

### M029 — Wiki Generation Quality & Issue Cleanup *(already queued)*

Context already lives at `.gsd/milestones/M029/M029-CONTEXT.md`. This roadmap does not redefine the scope; it confirms M029 is the first milestone to execute.

**Acceptance criteria snapshot (from existing CONTEXT.md, summarized):**

- [ ] `buildVoicePreservingPrompt()` in `src/knowledge/wiki-voice-analyzer.ts` bans meta-commentary (`"I'll analyze..."`, `"Let me first..."`, `"Looking at..."`) with explicit negative exemplars.
- [ ] Post-generation content filter rejects any candidate whose top-level prose matches agent-reasoning heuristics; rejections are logged and never published.
- [ ] `xbmc/wiki` issue #5 junk comments are deleted by `scripts/cleanup-wiki-issue.ts` with dry-run support.
- [ ] Full re-run of `scripts/generate-wiki-updates.ts` followed by `scripts/publish-wiki-updates.ts` produces zero reasoning-prose outputs against a fixture corpus and against live xbmc evidence.
- [ ] `verify:m029` (umbrella) and any remaining slice verifiers pass; forbidden-evidence defense rejects any reappearance of banned phrases.

**Open follow-up:** Promote from queued to active in QUEUE.md when execution begins (see M054/S01).

### M028 — Wiki Modification-Only Publishing *(already queued)*

Context at `.gsd/milestones/M028/M028-CONTEXT.md`.

**Acceptance criteria snapshot:**

- [ ] `src/knowledge/wiki-update-types.ts` replaces suggestion+rationale shape with a modification-only artifact: `{ kind: "replace-section" | "insert-section" | "full-page"; pagePath; before?; after; citations[]; }`.
- [ ] `src/knowledge/wiki-publisher.ts` emits the new shape; `WHY:` / rationale framing is removed from every publish path.
- [ ] Existing published wiki comments are retrofitted or annotated by a one-shot `scripts/retrofit-wiki-comments.ts`, with fixture coverage.
- [ ] Hybrid section/full-page publishing is chosen by a stable heuristic (section diff size + citation density) with tests.
- [ ] `verify:m028` umbrella script passes; slice verifiers preserve the modification-only contract as forbidden-evidence checks (any `WHY:` token in a publish payload is a hard fail).

### M027 — Embedding Integrity & Timeout Hardening *(already queued)*

Context at `.gsd/milestones/M027/M027-CONTEXT.md`. All four slices already have `verify:m027:s01`..`s04` wired; this milestone is unusual in that its verify scaffolding exists but the code work has not shipped.

**Acceptance criteria snapshot:**

- [ ] Audit surfaces stale/missing embeddings across `learning_memories`, `review_comments`, `wiki_pages`, `code_snippets`, `issues`, `issue_comments` corpora, emitting row-level evidence.
- [ ] Online repair/backfill scripts (including `scripts/embedding-comparison.ts` and `scripts/embedding-audit.ts`) complete within their declared timeouts; root cause for current timeouts documented in a new `.gsd/DECISIONS.md` entry.
- [ ] Query-time retrieval confirmed to actually consult embeddings (not fall back silently) via a proof-surface log tag.
- [ ] `verify:m027:s01`..`s04` all pass on a live dry-run against xbmc/xbmc.

### M053 — Unsafe `new Function()` Removal

```yaml
id: M053
title: Unsafe new Function() removal from src/
status: queued
added: 2026-04-20
requirement_refs: []
key_decisions:
  - id: D-M053-01
    title: Live-check templates must never use new Function() inside src/
```

#### Issue: M053/S01 — Delete or relocate `src/phase28-inline-minconfidence-live-check.ts`

**What this is.** A one-off live-check script was committed to `src/` alongside `index.ts` and `config.ts` and never cleaned up. Its body:

```typescript
export function runTemplate(template: string, payload: Record<string, unknown>): unknown {
  // Intentionally unsafe for live review validation.
  const evaluator = new Function("payload", `with (payload) { return ${template}; }`);
  return evaluator(payload);
}
```

is an `eval` by another name. It is not imported by anything under `src/` today (grep confirms zero consumers), which means the only cost of removing it is proving nothing transitively uses it. It is a live footgun: any future module can import it and weaponize it.

**Why now.** Phase 4 (M031 security hardening) will add env allowlists and secret scanning on publish paths. Landing those guards with a reachable-from-`src/` `new Function()` expression in the tree contradicts the contract M031 is trying to establish. One-line fix, high signal-to-noise.

**Acceptance criteria.**

- [ ] `src/phase28-inline-minconfidence-live-check.ts` no longer exists under `src/`. If the live-check is still needed, it lives at `scripts/phase28-inline-minconfidence-live-check.ts` with a script-level comment that says "one-off diagnostic, not for import from src/".
- [ ] `bun test` passes.
- [ ] A repo-wide grep for `new Function(` returns zero hits under `src/`. Any remaining matches in `scripts/` or `fixtures/` are annotated with a comment explaining the intent.
- [ ] `.gsd/DECISIONS.md` gets a new entry (D-M053-01) stating the contract: `new Function()` and equivalent dynamic evaluators are forbidden in `src/`.

**Files to touch.**

- `src/phase28-inline-minconfidence-live-check.ts` — delete (or `git mv` to `scripts/`).
- `.gsd/DECISIONS.md` — append D-M053-01.
- `.gsd/milestones/M053/M053-SUMMARY.md` — create using the M051 template.

**Verify contract.**

- Command: `bun run verify:m053`
- Script: `scripts/verify-m053.ts`
- Report type: `M053_Report`
- Status codes: `m053_ok` (pass), `m053_unsafe_eval_in_src` (any `new Function(` match under `src/`), `m053_missing_decision_record` (D-M053-01 not present).
- Check IDs: `no_new_function_in_src`, `phase28_file_absent_or_relocated`, `decision_record_present`.

**Blocks:** Phase 4 (M031) should not start until this lands.

---

## Phase 2 — Truthful Planning Surface

**Theme:** Make `.gsd/` and the top-level docs match reality. Every gap here is a documentation lie that costs future-you context.

**Sequencing rationale:** This phase can run in parallel with Phase 1 because it touches zero runtime code. Do it now while the memory of what happened in M035–M052 is fresh.

| Milestone | Title | Slices |
|---|---|---|
| M054 | GSD v2 Planning Artifact Repair | S01, S02, S03, S04 |
| M055 | Top-Level Docs Accuracy Pass | S01, S02, S03 |

### M054 — GSD v2 Planning Artifact Repair

```yaml
id: M054
title: GSD v2 planning artifact repair
status: queued
added: 2026-04-20
key_decisions:
  - id: D-M054-01
    title: Retrospective milestone folders use a reduced CONTEXT+SUMMARY shape
```

#### Issue: M054/S01 — Reconcile QUEUE.md with shipped milestones

**What this is.** `.gsd/QUEUE.md` still lists M044, M045, M046, and M047 as "Status: queued" — but all four appear complete in PROJECT.md and have `.gsd/milestones/` folders with `status: complete` in their SUMMARY YAML. M048 through M052 have verify scripts in `package.json` and are referenced in PROJECT.md but do not appear in QUEUE.md at all. QUEUE.md was last coherent around M043.

**Why now.** QUEUE.md is the single source of truth for "what's next" in GSD v2. Right now it's actively misleading — a future you (or agent) reading it would think M044–M047 are queued.

**Acceptance criteria.**

- [ ] M044, M045, M046, M047 are removed from QUEUE.md "Pending Milestones" and referenced only as complete (or dropped entirely if PROJECT.md's milestone list covers them).
- [ ] M048, M049, M050, M051, M052 are all referenced in QUEUE.md with correct status: `complete` (not `queued`).
- [ ] M027, M028, M029, M031, M032 remain queued with unchanged `Added` dates and context links.
- [ ] All new milestones from this roadmap (M053–M060) are added to QUEUE.md with status `queued`, `Added: 2026-04-20`, and a one-line summary matching this document's milestone table.
- [ ] A new "Completed Milestones" section is added (or PROJECT.md's list is treated as the source of truth and QUEUE.md links to it).

**Files to touch.**

- `.gsd/QUEUE.md` — full rewrite of Pending Milestones section; add Completed section or reference to PROJECT.md.

**Verify contract.**

- Command: `bun run verify:m054:s01`
- Script: `scripts/verify-m054-s01.ts`
- Check IDs: `queue_contains_all_queued_context_docs`, `queue_omits_completed_milestones`, `queue_lists_new_m053_through_m060`.
- Status codes: `m054_s01_ok`, `m054_s01_stale_entry`, `m054_s01_missing_entry`.

#### Issue: M054/S02 — Retrospective milestone folders for M035–M043

**What this is.** `.gsd/milestones/` has folders for M001–M034, M044–M047, and M051. The following nine milestones are **referenced as complete** in PROJECT.md but have **no folder at all**: M035, M036, M037, M038, M039, M040, M041, M042, M043.

Some have verify scripts in `package.json` (M036 has `verify:m036:s01..s03`; M037 `s01..s03`; M038 `s02..s03`; M040 `s02..s03`; M041 `s02..s03`; M042 `s01..s03`), so the slice structure can be reconstructed from the verify script list plus git history. Others (M035, M039, M043) have no verify scripts and have to be reconstructed from CHANGELOG and commits.

**Why now.** Without these folders, the "lessons learned" context for roughly a quarter of the project's history is in git history only. Any future context-gathering by an agent (or human) is starved.

**Acceptance criteria.**

- [ ] `.gsd/milestones/M035/` through `.gsd/milestones/M043/` each exist with at least:
    - `MnXX-CONTEXT.md` (retrospective — "what was going on at the time, reconstructed from commits/CHANGELOG").
    - `MnXX-SUMMARY.md` (with YAML frontmatter: `id`, `title`, `status: complete`, `completed_at` best-effort from git log, `key_files` from largest diffs).
- [ ] For milestones with existing verify scripts (M036–M038, M040–M042), each slice folder `slices/SXX/` is created with a minimal `SXX-SUMMARY.md` linking to the verify script.
- [ ] For milestones without verify scripts (M035, M039, M043), the SUMMARY explicitly flags "no verifier shipped; reconstructed from git log".
- [ ] A short `.gsd/DECISIONS.md` entry (D-M054-01) records the retrospective-folder convention: a reduced CONTEXT+SUMMARY shape is acceptable when full planning artifacts were never written.

**Files to touch.**

- `.gsd/milestones/M035/`..`.gsd/milestones/M043/` — create (nine folders).
- `.gsd/DECISIONS.md` — append D-M054-01.

**Verify contract.**

- Command: `bun run verify:m054:s02`
- Script: `scripts/verify-m054-s02.ts`
- Check IDs: `folder_exists_for_each_milestone`, `summary_has_required_frontmatter`, `decision_record_present`.
- Status codes: `m054_s02_ok`, `m054_s02_missing_folder`, `m054_s02_missing_summary`.

#### Issue: M054/S03 — Retrospective milestone folders for M048–M052

**What this is.** Companion to S02. M048, M049, M050, M052 are referenced in PROJECT.md and have verify scripts, but no `.gsd/milestones/` folder. M051 is the only recent complete milestone with a folder. M052 in particular shipped in `v0.30 (2026-04-19)` per `CHANGELOG.md` and introduced `POST /webhooks/slack/relay/:sourceId` — but the planning/slice artifacts are gone.

**Why now.** Same as S02, but for the most recent milestones. These are higher-value to reconstruct because the context is still recoverable and because M052 introduced a net-new public surface (Slack webhook relay) that is currently undocumented in `.gsd/`.

**Acceptance criteria.**

- [ ] `.gsd/milestones/M048/`, `M049/`, `M050/`, `M052/` each exist with `CONTEXT.md` and `SUMMARY.md`.
- [ ] M048 SUMMARY captures: the operator/verifier proof-surface debt seam (shared with M051), the tri-state phase-timing wording, and which slices exist (`verify:m048:s01`, `s02`, `s03`).
- [ ] M049 SUMMARY captures whatever `verify:m049:s02` validates.
- [ ] M050 SUMMARY flags "no verifier shipped; reconstructed from git log".
- [ ] M052 SUMMARY captures: `POST /webhooks/slack/relay/:sourceId`, `SLACK_WEBHOOK_RELAY_SOURCES`, the fixture-backed `verify:m052` proof command, and the relay runbook. Slices S01 and S02 get their own `SXX-SUMMARY.md` mirroring `scripts/verify-m052-s01.ts` and `scripts/verify-m052-s02.ts`.

**Files to touch.**

- `.gsd/milestones/M048/`..`.gsd/milestones/M052/` — create (four folders; M051 already exists).

**Verify contract.**

- Command: `bun run verify:m054:s03`
- Script: `scripts/verify-m054-s03.ts`
- Check IDs: `folder_exists_m048`, `folder_exists_m049`, `folder_exists_m050`, `folder_exists_m052`, `m052_slice_folders_present`, `summaries_reference_verify_scripts`.
- Status codes: `m054_s03_ok`, `m054_s03_missing_folder`, `m054_s03_missing_slice`.

#### Issue: M054/S04 — Fill verify-script gaps for complete milestones

**What this is.** Four milestones are marked complete but have no verify script entry in `package.json`:

- **M043** (Restore Mention Review Publication) — complete per PROJECT.md, but no `verify:m043`.
- **M050** — referenced with scripts but no `verify:m050`.
- **M051** — complete; `scripts/verify-m051.ts` does not exist; `package.json` has no `verify:m051`.
- **M028/S01** — `verify:m028:s02`, `s03`, `s04` exist but `verify:m028:s01` is missing (the gap is conspicuous).

Separately, two orphaned scripts on disk are not in `package.json`:

- `scripts/verify-m052-s01.ts` and `scripts/verify-m052-s02.ts` exist but only the umbrella `verify:m052` is registered.

**Why now.** M051's proof surfaces (mention completion logs, publish-resolution logs with `lane=interactive-review`) are described in PROJECT.md as the contract, but there's no single command that proves them. If a regression reintroduces the retired `ai-review` team trigger, there's nothing in CI that will catch it.

**Acceptance criteria.**

- [ ] `scripts/verify-m051.ts` exists and asserts: (a) `@kodiai review` is the only manual rereview trigger in config and code paths, (b) mention completion logs + publish-resolution logs carry `lane=interactive-review` and `taskType=review.full`, (c) team-only `pull_request.review_requested` deliveries surface as `skipReason=team-only-request`, (d) R055 requirement evidence.
- [ ] `package.json` gains `"verify:m051": "bun scripts/verify-m051.ts"`.
- [ ] `package.json` gains `"verify:m052:s01"` and `"verify:m052:s02"` wired to the existing on-disk scripts.
- [ ] Decide the right scope for M043 and M050 — either write `verify:m043` / `verify:m050` or record in each milestone's SUMMARY that no verifier will be shipped and explain why. M028/S01 gets its own slice if the contract is reconstructible.
- [ ] `bun run verify:m051`, `verify:m052:s01`, `verify:m052:s02` all pass.

**Files to touch.**

- `scripts/verify-m051.ts` — create.
- `package.json` — add entries.
- `.gsd/milestones/M043/M043-SUMMARY.md`, `.gsd/milestones/M050/M050-SUMMARY.md` — document verifier-absence decision if that's the path.

**Verify contract.**

- Command: `bun run verify:m054:s04`
- Script: `scripts/verify-m054-s04.ts`
- Check IDs: `verify_m051_script_exists`, `verify_m051_registered`, `verify_m052_slice_scripts_registered`, `complete_milestones_have_verifier_or_rationale`.
- Status codes: `m054_s04_ok`, `m054_s04_missing_script`, `m054_s04_unregistered_script`.

### M055 — Top-Level Docs Accuracy Pass

```yaml
id: M055
title: Top-level docs accuracy pass
status: queued
added: 2026-04-20
```

#### Issue: M055/S01 — README + CHANGELOG alignment

**What this is.** `README.md` states "30 milestones shipped (v0.1 through v0.30)." The actual shipped count per `.gsd/milestones/` + PROJECT.md is well above 50; `CHANGELOG.md` is up to date through `v0.30 (2026-04-19)` / M052. The README's featureset list also predates M045–M047's contributor-experience redesign and M052's Slack webhook relay.

**Acceptance criteria.**

- [ ] README milestone count matches the most recent completed milestone.
- [ ] README feature list mentions: contributor experience contract (M045), contributor tier calibration (M046/M047), manual rereview contract (M051), Slack webhook relay (M052).
- [ ] Nightly workflows (`.github/workflows/nightly-issue-sync.yml`, `nightly-reaction-sync.yml`) are described in README — what they do, what they sync, what happens on failure.
- [ ] CHANGELOG has a short entry for each M053+ milestone as they ship (this slice adds a template section).

**Files to touch.**

- `README.md`, `CHANGELOG.md`.

**Verify contract.**

- Command: `bun run verify:m055:s01`
- Script: `scripts/verify-m055-s01.ts`
- Check IDs: `readme_milestone_count_current`, `readme_mentions_recent_features`, `readme_documents_nightly_workflows`.
- Status codes: `m055_s01_ok`, `m055_s01_stale_count`, `m055_s01_missing_feature_mention`.

#### Issue: M055/S02 — LICENSE and CONTRIBUTING expansion

**What this is.** The repo has `CONTRIBUTING.md`, `CHANGELOG.md`, and `README.md` but no `LICENSE` file. Usage rights are legally ambiguous. `CONTRIBUTING.md` is 99 lines and covers the test suite + PR process, but does not cover: migration `.down.sql` requirement, `.gsd/` planning structure, milestone/slice naming convention, verify-script contract, or the "every slice summary must reference its verify script" rule.

**Acceptance criteria.**

- [ ] `LICENSE` file exists at repo root. Decide: Apache-2.0, MIT, or Business Source License? Record the choice in a DECISIONS.md entry (D-M055-01).
- [ ] `CONTRIBUTING.md` gains sections for: GSD v2 planning layout (`.gsd/`), milestone folder convention (link to M051 as exemplar), verify script contract, migration rules (up + down required, CI-gated), test-writing expectations (every new `src/` file ships with a `.test.ts` sibling unless justified).
- [ ] `package.json` gains an `"engines"` constraint — see M058/S02 which will close the same gap from the CI side. This slice just writes the contributor expectation.

**Files to touch.**

- `LICENSE` — create.
- `CONTRIBUTING.md` — expand.
- `.gsd/DECISIONS.md` — append D-M055-01 (license choice rationale).

**Verify contract.**

- Command: `bun run verify:m055:s02`
- Script: `scripts/verify-m055-s02.ts`
- Check IDs: `license_file_present`, `contributing_covers_gsd_v2`, `contributing_covers_migration_rules`, `contributing_covers_verify_contract`.
- Status codes: `m055_s02_ok`, `m055_s02_missing_license`, `m055_s02_missing_section`.

#### Issue: M055/S03 — `docs/` runbook audit

**What this is.** `docs/` exists but has not been inventoried against current operational surfaces. Things likely missing: deploy rollback runbook (what do you do when a migration without `.down.sql` needs to be reverted?), key rotation for `GITHUB_PRIVATE_KEY` / `ANTHROPIC_API_KEY`, Slack webhook relay operational guidance (M052 added the runbook but may not cover failure modes), ACA job debugging (how to inspect a failed job's `result.json`).

**Acceptance criteria.**

- [ ] `docs/` is inventoried in a single `docs/INDEX.md` listing every doc and its purpose.
- [ ] At minimum the following runbooks exist (new or updated): `docs/runbooks/deploy-rollback.md`, `docs/runbooks/key-rotation.md`, `docs/runbooks/aca-job-debugging.md`, `docs/runbooks/nightly-sync-failures.md`.
- [ ] Each runbook references at least one structured log tag, one command, and the owning milestone or decision.
- [ ] Any command mentioned in a runbook actually exists in `package.json` or `scripts/`.

**Files to touch.**

- `docs/INDEX.md`, `docs/runbooks/*.md`.

**Verify contract.**

- Command: `bun run verify:m055:s03`
- Script: `scripts/verify-m055-s03.ts`
- Check IDs: `docs_index_present`, `required_runbooks_present`, `runbook_commands_resolve`.
- Status codes: `m055_s03_ok`, `m055_s03_missing_runbook`, `m055_s03_broken_command_reference`.

---

## Phase 3 — Code Safety Net

**Theme:** Close the test and rollback gaps that would bite on a bad deploy. Harden CI so these gaps can't silently reappear.

**Sequencing rationale:** M056 first because schema rollbacks unblock operational safety for everything else. M057 second because test coverage gaps will reveal themselves as CI churn once we land M058's broadened matrix. M058 last because the CI changes only pay off after coverage is actually there to run.

| Milestone | Title | Slices |
|---|---|---|
| M056 | Migration Rollback Completeness | S01, S02, S03 |
| M057 | Core Handler & Webhook Test Backfill | S01, S02, S03, S04 |
| M058 | CI Workflow Hardening | S01, S02, S03 |

### M056 — Migration Rollback Completeness

```yaml
id: M056
title: Migration rollback completeness
status: queued
added: 2026-04-20
```

#### Issue: M056/S01 — Down-migrations for early gaps (012, 013, 016, 025, 026)

**What this is.** `src/db/migrations/` is missing `.down.sql` for: `012-wiki-staleness-run-state`, `013-review-clusters`, `016-issue-triage-state`, `025-wiki-style-cache`, `026-guardrail-audit`. These predate M033–M036 and have likely been live in production for months. The original gap analysis missed them because it only scanned the recent migrations.

**Why now.** If any of these tables needs to be dropped or altered for a rollback, there's no canonical rollback DDL. Each has to be reconstructed from memory under pressure.

**Acceptance criteria.**

- [ ] `.down.sql` exists for 012, 013, 016, 025, 026 and drops the tables/columns/indexes the up migration created, in reverse order.
- [ ] Each down migration is tested by running `up` → `down` → `up` against a fresh Postgres + pgvector container and confirming the schema diff is empty.
- [ ] No production data loss risk is introduced: down migrations document any data that would be lost and require a `CONFIRM_DATA_LOSS=1` env guard where applicable.

**Files to touch.**

- `src/db/migrations/012-wiki-staleness-run-state.down.sql` — create.
- `src/db/migrations/013-review-clusters.down.sql` — create.
- `src/db/migrations/016-issue-triage-state.down.sql` — create.
- `src/db/migrations/025-wiki-style-cache.down.sql` — create.
- `src/db/migrations/026-guardrail-audit.down.sql` — create.

**Verify contract.**

- Command: `bun run verify:m056:s01`
- Script: `scripts/verify-m056-s01.ts`
- Check IDs: `down_file_present_per_up`, `up_down_up_schema_diff_empty`, `data_loss_guarded`.
- Status codes: `m056_s01_ok`, `m056_s01_missing_down`, `m056_s01_schema_drift_after_roundtrip`.

#### Issue: M056/S02 — Down-migrations for M033–M036 + missing 030

**What this is.** Migrations 033–036 ship without `.down.sql`:

- `033-canonical-code-corpus.sql`
- `034-review-graph.sql`
- `035-generated-rules.sql`
- `036-suggestion-cluster-models.sql`

And the migration sequence has a real gap: `029-embedding-repair-state.sql` is followed by `031-wiki-comment-identity.sql` — there is no `030-*.sql` file on disk. The `.gsd/milestones/M030/` folder exists (planning artifact) but no corresponding database migration shipped under the 030 slot.

**Acceptance criteria.**

- [ ] `.down.sql` exists for 033, 034, 035, 036 with the same round-trip test as S01.
- [ ] A decision is made about slot 030: either (a) write a no-op `030-reserved.sql` + `.down.sql` with an explanatory comment referencing the M030 planning folder, or (b) document in `.gsd/DECISIONS.md` (D-M056-01) that 030 is intentionally skipped and add a comment to the migration runner explaining the gap.
- [ ] `up` → `down` → `up` test passes across 033–036 against the pgvector container.

**Files to touch.**

- `src/db/migrations/033-canonical-code-corpus.down.sql` — create.
- `src/db/migrations/034-review-graph.down.sql` — create.
- `src/db/migrations/035-generated-rules.down.sql` — create.
- `src/db/migrations/036-suggestion-cluster-models.down.sql` — create.
- `src/db/migrations/030-reserved.sql` + `.down.sql` **or** `.gsd/DECISIONS.md` entry D-M056-01.

**Verify contract.**

- Command: `bun run verify:m056:s02`
- Script: `scripts/verify-m056-s02.ts`
- Check IDs: `down_file_present_033_036`, `slot_030_resolved`, `round_trip_passes`.
- Status codes: `m056_s02_ok`, `m056_s02_missing_down`, `m056_s02_slot_030_ambiguous`.

#### Issue: M056/S03 — CI gate: no new `.sql` without `.down.sql`

**What this is.** Once S01 and S02 close the historical gap, the only way to prevent it from reopening is to make CI reject any PR that adds a `.sql` migration without an `.down.sql` sibling.

**Acceptance criteria.**

- [ ] A `scripts/check-migrations-have-downs.ts` script lists every `src/db/migrations/*.sql` and asserts each has a matching `.down.sql` unless annotated in an allowlist (for existing intentional exceptions from S02).
- [ ] `.github/workflows/ci.yml` runs this check on every PR.
- [ ] A DECISIONS.md entry (D-M056-02) records the contract: "Every forward migration ships with a rollback migration or an allowlisted rationale."

**Files to touch.**

- `scripts/check-migrations-have-downs.ts` — create.
- `.github/workflows/ci.yml` — add step.
- `.gsd/DECISIONS.md` — append D-M056-02.

**Verify contract.**

- Command: `bun run verify:m056:s03` (which itself invokes `check-migrations-have-downs.ts`).
- Check IDs: `ci_step_registered`, `allowlist_minimal`, `decision_record_present`.
- Status codes: `m056_s03_ok`, `m056_s03_ci_step_missing`, `m056_s03_allowlist_bloat`.

### M057 — Core Handler & Webhook Test Backfill

```yaml
id: M057
title: Core handler and webhook test backfill
status: queued
added: 2026-04-20
```

#### Issue: M057/S01 — Webhook layer tests

**What this is.** `src/webhook/` is the entry point for every GitHub event Kodiai sees. It has five source files and zero test files:

- `src/webhook/verify.ts` — wraps `@octokit/webhooks-methods.verify()` for signature validation.
- `src/webhook/dedup.ts` — deduplicates deliveries.
- `src/webhook/router.ts` — dispatches events to handlers.
- `src/webhook/filters.ts` — drops app-originated events (self-event filter invariant called out in PROJECT.md).
- `src/webhook/types.ts` — type definitions.

The self-event filter is explicitly referenced as a **truthfulness invariant** in PROJECT.md ("self-generated reviewer/team requests cannot be used as proof for human manual rereview behavior"). That invariant has no test.

**Acceptance criteria.**

- [ ] `src/webhook/verify.test.ts` covers: valid signature, invalid signature, missing header, wrong algorithm prefix, timing-safe failure, `@octokit/webhooks-methods` throw path.
- [ ] `src/webhook/dedup.test.ts` covers: first-seen delivery accepted, duplicate rejected, race condition (concurrent deliveries with same id).
- [ ] `src/webhook/router.test.ts` covers: known event types routed to correct handlers, unknown event types dropped with log tag, handler exceptions surfaced (not silently swallowed).
- [ ] `src/webhook/filters.test.ts` covers: app-originated event filter (the self-event invariant), bot-originated event handling, human-originated event pass-through, the specific `pull_request.review_requested` with team-only target case (must produce `skipReason=team-only-request` per M051 contract).
- [ ] All four test files pass in CI.

**Files to touch.**

- `src/webhook/verify.test.ts`, `src/webhook/dedup.test.ts`, `src/webhook/router.test.ts`, `src/webhook/filters.test.ts` — create.

**Verify contract.**

- Command: `bun run verify:m057:s01`
- Script: `scripts/verify-m057-s01.ts`
- Check IDs: `webhook_verify_test_present`, `self_event_filter_invariant_tested`, `team_only_skip_reason_tested`, `tests_pass`.
- Status codes: `m057_s01_ok`, `m057_s01_missing_test`, `m057_s01_invariant_not_covered`.

#### Issue: M057/S02 — `ci-failure.ts` handler tests

**What this is.** `src/handlers/ci-failure.ts` is a 341-LOC handler that processes `check_suite.completed` events, classifies CI failures, tracks flakiness, and upserts CI analysis comments. It has no `.test.ts` sibling. Every other handler in `src/handlers/` that has comparable complexity has tests.

**Acceptance criteria.**

- [ ] `src/handlers/ci-failure.test.ts` covers: `check_suite.completed` payload parsing, missing base-ref handling, failure classification categories (each path), flakiness stat integration, comment upsert (create vs. update), error handling when GitHub API is unreachable.
- [ ] Test uses fixtures under `fixtures/webhooks/check_suite/` (create if missing).
- [ ] `bun test src/handlers/ci-failure.test.ts` passes.

**Files to touch.**

- `src/handlers/ci-failure.test.ts` — create.
- `fixtures/webhooks/check_suite/` — add fixtures if missing.

**Verify contract.**

- Command: `bun run verify:m057:s02`
- Script: `scripts/verify-m057-s02.ts`
- Check IDs: `ci_failure_test_present`, `fixture_corpus_present`, `all_classification_paths_covered`.
- Status codes: `m057_s02_ok`, `m057_s02_missing_test`, `m057_s02_path_uncovered`.

#### Issue: M057/S03 — `fork-manager.ts` + `gist-publisher.ts` tests

**What this is.** Every other file in `src/jobs/` has a `.test.ts` sibling (`aca-launcher.test.ts`, `queue.test.ts`, `review-work-coordinator.test.ts`, `workspace.test.ts`). Only `src/jobs/fork-manager.ts` and `src/jobs/gist-publisher.ts` are missing tests. Fork management deals with GitHub fork operations; gist publishing is a write-mode output path.

**Acceptance criteria.**

- [ ] `src/jobs/fork-manager.test.ts` covers: fork creation happy path, fork-already-exists idempotency, auth failure, rate-limit handling.
- [ ] `src/jobs/gist-publisher.test.ts` covers: gist creation with expected filename and visibility, update vs. create flow, failure handling, any secret-scrub behavior (important for publish-path secret scanning called out in M031).
- [ ] Both tests pass.

**Files to touch.**

- `src/jobs/fork-manager.test.ts`, `src/jobs/gist-publisher.test.ts` — create.

**Verify contract.**

- Command: `bun run verify:m057:s03`
- Script: `scripts/verify-m057-s03.ts`
- Check IDs: `fork_manager_test_present`, `gist_publisher_test_present`, `publish_path_secret_scrub_covered`.
- Status codes: `m057_s03_ok`, `m057_s03_missing_test`.

#### Issue: M057/S04 — Resolve `prepare-agent-workspace.test.ts` orphan + audit for other orphans

**What this is.** `src/execution/prepare-agent-workspace.test.ts` exists but `src/execution/prepare-agent-workspace.ts` does not. The test is testing nothing real. Possible paths:

1. Source was deleted and test was left behind → delete test.
2. Source was never written and test was committed prematurely → write source to satisfy test, or delete test.
3. Functionality moved into another file → rename test or update to point at new source.

While we're in there, audit `src/**/*.test.ts` for any other orphans.

**Acceptance criteria.**

- [ ] The `prepare-agent-workspace.test.ts` ambiguity is resolved with an explicit decision: delete, write source, or rename + point at new source.
- [ ] Repo-wide scan confirms every `.test.ts` has a sibling source (or justified via an allowlist).
- [ ] `bun test` still passes.

**Files to touch.**

- `src/execution/prepare-agent-workspace.test.ts` — delete, rename, or keep and add missing source.
- `scripts/check-orphaned-tests.ts` — new sibling-check script, wired into CI under M058/S03.

**Verify contract.**

- Command: `bun run verify:m057:s04`
- Script: `scripts/verify-m057-s04.ts`
- Check IDs: `prepare_agent_workspace_resolved`, `no_orphaned_tests`, `ci_step_registered`.
- Status codes: `m057_s04_ok`, `m057_s04_orphan_remaining`.

### M058 — CI Workflow Hardening

```yaml
id: M058
title: CI workflow hardening
status: queued
added: 2026-04-20
```

#### Issue: M058/S01 — Broaden the CI test matrix

**What this is.** The current `.github/workflows/ci.yml` has an explicit enumerated directory list for the first test invocation:

```
bun test --max-concurrency=2 scripts src/contributor src/enforcement src/execution \
  src/feedback src/handlers src/jobs src/lib src/review-audit src/review-graph \
  src/routes src/slack src/structural-impact src/telemetry src/triage
```

and a second invocation just for `src/knowledge`. Directories not covered: `src/webhook` (entry point for every event!), `src/db`, `src/llm`, and any root `src/*.ts` files.

**Acceptance criteria.**

- [ ] CI runs tests across **every** directory under `src/`, either by removing the explicit enumeration or by replacing it with an explicit "all of src/" invocation that still respects the known flakiness split.
- [ ] The flakiness split comment is preserved and explains what was changed and why.
- [ ] `src/webhook/*.test.ts` (from M057/S01) is actually executed by CI on every PR.
- [ ] `bun test` from a clean checkout produces identical results locally and in CI.

**Files to touch.**

- `.github/workflows/ci.yml`.

**Verify contract.**

- Command: `bun run verify:m058:s01`
- Script: `scripts/verify-m058-s01.ts`
- Check IDs: `ci_invokes_webhook_tests`, `ci_covers_all_src_subdirs`, `flakiness_split_preserved`.
- Status codes: `m058_s01_ok`, `m058_s01_subdir_uncovered`.

#### Issue: M058/S02 — Pin Bun version + add `engines` constraint

**What this is.** `.github/workflows/ci.yml` uses `bun-version: latest`. `package.json` has no `"engines"` field. A Bun release that introduces a behavior change will silently break CI and won't match any local pin.

**Acceptance criteria.**

- [ ] `package.json` gains `"engines": { "bun": ">=X.Y.Z" }` where `X.Y.Z` is the currently-tested Bun version.
- [ ] CI pins `bun-version` to the same `X.Y.Z` (not `latest`).
- [ ] A `.bun-version` or equivalent file at repo root matches, so local dev and CI agree.
- [ ] CONTRIBUTING.md mentions the Bun version contract (overlaps with M055/S02).

**Files to touch.**

- `package.json`, `.github/workflows/ci.yml`, `.bun-version` (new), `CONTRIBUTING.md`.

**Verify contract.**

- Command: `bun run verify:m058:s02`
- Script: `scripts/verify-m058-s02.ts`
- Check IDs: `engines_constraint_present`, `ci_pins_bun_version`, `bun_version_files_agree`.
- Status codes: `m058_s02_ok`, `m058_s02_unpinned_bun`, `m058_s02_version_mismatch`.

#### Issue: M058/S03 — Lint step + orphaned-test + migration-down gates

**What this is.** CI currently runs `bun test` and `bunx tsc --noEmit`. No linter, no orphaned-test check (S04 of M057 introduces one), no migration-down check (M056/S03 introduces one). We want all three wired into CI.

**Acceptance criteria.**

- [ ] CI runs `bunx eslint src scripts` (or whichever linter the team chooses; record in DECISIONS.md D-M058-01).
- [ ] CI runs `bun run verify:m056:s03` (migration-down gate).
- [ ] CI runs `bun run verify:m057:s04`'s orphaned-test check.
- [ ] Lint rules include, at minimum: no `console.log` in `src/`, no unused exports, no default exports in handler files (to match existing convention).

**Files to touch.**

- `.github/workflows/ci.yml`, `eslint.config.js` (or equivalent), `.gsd/DECISIONS.md`.

**Verify contract.**

- Command: `bun run verify:m058:s03`
- Script: `scripts/verify-m058-s03.ts`
- Check IDs: `lint_configured`, `lint_runs_in_ci`, `migration_down_gate_runs`, `orphan_test_gate_runs`, `decision_record_present`.
- Status codes: `m058_s03_ok`, `m058_s03_gate_missing`.

---

## Phase 4 — Security Hardening

**Theme:** Close the credential-exfiltration attack surface documented in M031-CONTEXT.md, then isolate the agent subprocess per M032-CONTEXT.md.

**Sequencing rationale:** This phase comes *after* Phase 3 because (a) M057/S01's webhook tests will be needed to prove the signature/verification seam doesn't regress during hardening, (b) M056/S03's migration gate prevents any security migration from being merged without a rollback, (c) M053 must already be done so there's no `new Function()` to worry about. M031 and M032 are already queued in QUEUE.md with context docs; this phase is about **promoting them from queued to active** once Phase 3 lands.

| Milestone | Title | Notes |
|---|---|---|
| M031 | Security Hardening | already queued; context at `.gsd/milestones/M031/M031-CONTEXT.md` |
| M032 | Agent Process Isolation | already queued; context at `.gsd/milestones/M032/M032-CONTEXT.md` |

### M031 — Security Hardening *(already queued)*

Context at `.gsd/milestones/M031/M031-CONTEXT.md`. Summary per QUEUE.md: "Defense-in-depth against credential exfiltration: agent env allowlist, git remote token sanitization, outgoing secret scan on all publish paths, prompt-level refusal instructions, CLAUDE.md security policy in workspace."

**Roadmap-level delta for this milestone (do not redefine the full scope):**

- [ ] Outgoing secret scan applies to **every publish path**, including `src/jobs/gist-publisher.ts` (tested in M057/S03), Slack relay (M052 surface), wiki publisher (M028 output), and mention publish-resolution.
- [ ] `verify:m031` script (already exists in `package.json`) must pass. Today it is wired but M031 has not been executed; promote to active.
- [ ] D-M053-01 (no `new Function()` in `src/`) is reconfirmed here as an enforced invariant.

### M032 — Agent Process Isolation *(already queued)*

Context at `.gsd/milestones/M032/M032-CONTEXT.md`.

**Roadmap-level delta:**

- [ ] `verify:m032` (already registered) passes.
- [ ] The /proc/<ppid>/environ attack path called out in the context doc is explicitly covered by a proof-surface check (script inspects the live ACA job's env; orchestrator env is not reachable).

---

## Phase 5 — Long-Tail Cleanup

**Theme:** Lower-priority housekeeping that makes the next year of work easier but doesn't block anything shipping.

**Sequencing rationale:** Run last; tolerate partial completion. If time is short, M060 can be skipped entirely and re-planned when specific knowledge-subsystem regressions surface.

| Milestone | Title | Slices |
|---|---|---|
| M059 | Script Registry & Orphan Audit | S01, S02 |
| M060 | Knowledge Subsystem Test Backfill | S01, S02 |

### M059 — Script Registry & Orphan Audit

```yaml
id: M059
title: Script registry and orphan audit
status: queued
added: 2026-04-20
```

#### Issue: M059/S01 — `scripts/REGISTRY.md`

**What this is.** `scripts/` contains 120+ files. Many are verifier harnesses, some are one-off backfills, some are diagnostic tools that were committed and never revisited. There's no single document that says what each script is for.

**Acceptance criteria.**

- [ ] `scripts/REGISTRY.md` lists every `*.ts` under `scripts/` with: purpose, owning milestone (if applicable), whether it's a recurring job (cron/workflow) or one-off, and an archive status.
- [ ] Every script referenced by `package.json` and every `.github/workflows/*.yml` is cross-linked.
- [ ] Scripts identified as dead (no importers, no workflow references, no human memory of purpose) are either moved to `scripts/archive/` or deleted, with the choice recorded.

**Files to touch.**

- `scripts/REGISTRY.md` — create.
- `scripts/archive/` — may be created if anything is archived.

**Verify contract.**

- Command: `bun run verify:m059:s01`
- Script: `scripts/verify-m059-s01.ts`
- Check IDs: `registry_present`, `registry_covers_every_script`, `package_json_scripts_cross_linked`.
- Status codes: `m059_s01_ok`, `m059_s01_missing_entry`.

#### Issue: M059/S02 — Orphan script sweep

**What this is.** After S01's registry exists, do a sweep: any `scripts/*.ts` that has no workflow reference, no `package.json` entry, no `docs/` reference, and no DECISIONS.md mention is a candidate for deletion.

**Acceptance criteria.**

- [ ] `scripts/verify-m059-s02.ts` identifies orphans automatically (using the S01 registry as ground truth).
- [ ] Each orphan is either retained (with explicit justification in the registry) or deleted.
- [ ] The sweep does not delete anything listed in `scripts/REGISTRY.md` as active.

**Files to touch.**

- `scripts/*` — possible deletions, each recorded in the PR description.

**Verify contract.**

- Command: `bun run verify:m059:s02`
- Check IDs: `no_uncategorized_orphans`, `all_deletions_registry_authorized`.
- Status codes: `m059_s02_ok`, `m059_s02_unclassified_orphan`.

### M060 — Knowledge Subsystem Test Backfill

```yaml
id: M060
title: Knowledge subsystem test backfill
status: queued
added: 2026-04-20
```

#### Issue: M060/S01 — Test the highest-centrality knowledge files

**What this is.** `src/knowledge/` has roughly 20 `.ts` files without `.test.ts` siblings. Some are pure type files (`cluster-types.ts`, `code-snippet-types.ts`, `issue-types.ts`, `wiki-staleness-types.ts`, `wiki-voice-types.ts`) and can stay untested. Others are substantive logic that affects retrieval quality: `wiki-popularity-scorer.ts`, `isolation.ts`, `wiki-linkshere-fetcher.ts`. Test the substantive ones.

**Acceptance criteria.**

- [ ] `src/knowledge/wiki-popularity-scorer.test.ts` covers the scoring function with representative + adversarial inputs.
- [ ] `src/knowledge/isolation.test.ts` covers the isolation boundary (what does "isolated" mean here — per-repo? per-workspace? — and prove the invariant).
- [ ] `src/knowledge/wiki-linkshere-fetcher.test.ts` covers the fetcher's success + failure paths.
- [ ] Pure type files are explicitly listed in a new `src/knowledge/TEST_EXEMPTIONS.md` with justification.

**Files to touch.**

- Three new `.test.ts` files; one `TEST_EXEMPTIONS.md`.

**Verify contract.**

- Command: `bun run verify:m060:s01`
- Script: `scripts/verify-m060-s01.ts`
- Check IDs: `scorer_test_present`, `isolation_test_present`, `fetcher_test_present`, `exemptions_documented`.
- Status codes: `m060_s01_ok`, `m060_s01_missing_test`.

#### Issue: M060/S02 — M027 overlap reconciliation

**What this is.** M027 (queued) is about embedding integrity across multiple corpora — `learning_memories`, `review_comments`, `wiki_pages`, `code_snippets`, `issues`, `issue_comments`. Some of the knowledge files this phase tests (M060/S01) are the same files M027 will exercise through its verify scripts. Before finalizing M060, reconcile which tests belong in M027's slice harnesses vs. M060's unit tests.

**Acceptance criteria.**

- [ ] `.gsd/milestones/M027/` SUMMARY notes which files are covered by M027 slice tests vs. M060 unit tests.
- [ ] No file is double-tested without reason; no file is untested after both milestones land.
- [ ] A DECISIONS.md entry (D-M060-01) states the contract: knowledge-layer unit tests go in M060; corpus-level integrity tests go in M027.

**Files to touch.**

- `.gsd/milestones/M027/M027-SUMMARY.md` (update once M027 lands), `.gsd/DECISIONS.md`.

**Verify contract.**

- Command: `bun run verify:m060:s02`
- Check IDs: `m027_m060_overlap_documented`, `no_double_coverage`, `decision_record_present`.
- Status codes: `m060_s02_ok`, `m060_s02_overlap_undocumented`.

---

## Execution order (recommended)

Ordered by a single criterion: **what unblocks the most downstream work, soonest.**

1. **M029** — external-contributor-visible wiki defect.
2. **M028** — wiki modification-only contract, natural follow-up to M029.
3. **M053** — one-hour removal of unsafe eval before Phase 4.
4. **M054/S01** — refresh QUEUE.md. 30-minute task, massively improves orientation for every subsequent milestone.
5. **M027** — embedding integrity audit. Silent retrieval degradation is expensive.
6. **M054/S02, S03, S04** — retrospective milestone folders + verify-script gaps.
7. **M056** — migration rollback completeness (prerequisite for any future schema work).
8. **M057** — webhook + handler test backfill (prerequisite for trusting Phase 4 changes).
9. **M058** — CI hardening, lands the gates from M056/S03 and M057/S04 + bun pinning + lint.
10. **M055** — README/CHANGELOG/LICENSE/CONTRIBUTING/docs pass (can run in parallel with M056–M058).
11. **M031** — promote from queued to active; security hardening.
12. **M032** — promote from queued to active; agent process isolation.
13. **M059** — script registry cleanup (can run in parallel with M031/M032).
14. **M060** — knowledge test backfill (lowest priority; may be deferred).

---

## Appendix A — Corrections to the existing gap analysis

| Gap-analysis item | Correction |
|---|---|
| Zone 2.3 (migrations 033–036 missing downs) | **Undercounted.** Also missing: 012, 013, 016, 025, 026. Nine total, not four. |
| Zone 2.4 (migration 030 missing) | Confirmed — no `030-*.sql` in `src/db/migrations/`. The `.gsd/milestones/M030/` planning folder exists but does not imply a shipped migration. |
| Zone 2.6 (M052 undocumented) | **Partially incorrect.** `CHANGELOG.md v0.30 (2026-04-19)` explicitly describes M052 as "Truthful Manual Rereview & Slack Webhook Relay" and references `verify:m052`. The real gap is the missing `.gsd/milestones/M052/` folder and the unregistered `scripts/verify-m052-s01.ts` / `verify-m052-s02.ts`. |

## Appendix B — New gaps not in the original analysis

1. `src/webhook/` — five source files, zero tests; includes the self-event filter invariant explicitly called out in PROJECT.md.
2. `src/handlers/ci-failure.ts` — 341 LOC, no test sibling.
3. CI workflow test matrix enumerates directories explicitly and excludes `src/webhook`, `src/db`, `src/llm`, and root files.
4. `bun-version: latest` in CI; no `engines` in `package.json`.
5. `verify:m028:s01`, `verify:m043`, `verify:m050`, `verify:m051` missing from `package.json`.
6. `scripts/verify-m052-s01.ts` + `verify-m052-s02.ts` exist on disk but are not in `package.json`.
7. Queued M031/M032 already have verify scripts registered — a planning/execution ordering mismatch worth addressing in M054/S04's decision record.

## Appendix C — Slice-to-GitHub-issue mapping

Each heading starting with `#### Issue:` corresponds to one GitHub issue. Suggested issue title template:

```
[M0XX/S0Y] <slice title>
```

Suggested labels: `gsd-v2`, `phase-1` / `phase-2` / ..., `milestone-m0XX`, plus a domain label (`wiki`, `security`, `ci`, `docs`, `migrations`, `tests`).

Every issue body should open with the "What this is" paragraph from this document, followed by "Why now", "Acceptance criteria", "Files to touch", "Verify contract", and "Blocks / Blocked by" (from the execution order above).
