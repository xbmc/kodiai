# M028 — Research

**Date:** 2026-03-12

## Summary

The current wiki pipeline is contractually suggestion-shaped end to end. `src/knowledge/wiki-update-generator.ts` instructs the model to begin with `WHY:`, `parseGeneratedSuggestion()` splits output into `whySummary` + `suggestion`, `src/knowledge/wiki-update-types.ts` persists that pair as the primary artifact, and `src/knowledge/wiki-publisher.ts` renders every section with `**Why:** ...` plus optional voice-warning prose. This is not a formatting-only problem. The storage model, prompt, parser, formatter, CLI summaries, and tests all encode the old suggestion+rationale contract.

Primary recommendation: treat M028 as a first-class artifact contract migration, not a comment-template tweak. Introduce an explicit modification artifact shape that can represent either a section replacement or a full-page replacement, keep citations/trace metadata separate from replacement content, and make publisher output a thin renderer of that artifact. Prove the new contract first with dry-run/unit-level checks before any live GitHub mutation. Then add a deterministic supersession path for already-published suggestion comments, preferably by posting replacement comments with explicit supersession markers rather than trying to silently rewrite history in place.

The highest-risk boundary is hybrid granularity. The existing table only supports one row per `(page_id, section_heading)` and has no first-class `mode`/`scope` field, so full-page output cannot be added cleanly with a null/sentinel heading hack without making rendering and verification brittle. The second high-risk boundary is retrofit state: the DB stores `published_issue_number` but not published comment IDs, so reproducible supersession/edit behavior will be hard unless M028 adds durable linkage or a deterministic comment marker scan.

## Recommendation

Take the milestone in this order:

1. **Define and persist the new artifact contract first**
   - Add a first-class modification shape with explicit mode (`section` vs `page`) and target scope.
   - Keep replacement text separate from citations/metadata.
   - Remove `whySummary` and suggestion-oriented parsing from the generation boundary.
2. **Reuse the existing generation/grounding/voice stack, but narrow its output contract**
   - Keep patch matching, grounding guardrails, and voice validation.
   - Change only what the model must emit and what gets stored/published.
   - Voice warnings should likely remain internal metadata, not published prose.
3. **Refactor publisher around artifact rendering, then add retrofit/supersession**
   - Reuse existing GitHub issue comment creation/update patterns.
   - Prefer explicit supersession comments or deterministic upsert markers over ad hoc manual cleanup.
4. **Ship a machine-checkable verifier before live rollout**
   - Follow the M027 JSON-first proof-harness pattern.
   - Assert both stored artifacts and rendered comments contain no `WHY:`/suggestion-style prose.

### Candidate requirements worth making explicit

These are not auto-binding, but they are the gaps most likely to matter during execution:

- **Candidate R030 — Persisted artifact mode is explicit and machine-checkable.**
  R027 requires hybrid granularity, but today there is no durable field that distinguishes section replacement from full-page replacement. Without that, verification becomes string heuristics.
- **Candidate R031 — Published wiki comments have durable linkage to the exact GitHub comment used for publication/supersession.**
  R028 says retrofit must be reproducible, but current state stores only `published_issue_number`, not `published_comment_id` or supersession metadata.
- **Candidate R032 — Operators can preview retrofit actions without mutating GitHub.**
  A dry-run/reporting surface for “these old comments would be superseded/updated” would reduce risk before external changes.

### Requirement notes against current Active requirements

- **Table stakes:** R025, R026, and R029 are table stakes. If the DB rows still store rationale text or the formatter can still emit `**Why:**`, the milestone is not done.
- **Needs explicit contract detail:** R027 is underspecified unless the mode-selection rule is persisted or at least rendered deterministically enough for tests.
- **Operational continuity risk:** R028 is the requirement most likely to slip if comment identity/supersession state is not designed up front.
- **Likely optional:** published voice-mismatch warnings are not clearly wanted anymore. They are not minimal metadata and should probably become internal-only unless the user explicitly wants them kept.
- **Clearly out of scope:** direct wiki commits/PRs, staleness heuristic changes, or broad content-quality rework beyond the artifact contract.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| GitHub comment upsert/supersession behavior | Existing `issues.listComments` + `issues.updateComment` scan/update pattern in `src/handlers/ci-failure.ts` and reusable `issues.updateComment` calls elsewhere | The repo already has a proven comment-marker update pattern; reuse it instead of inventing another GitHub mutation wrapper. |
| Machine-checkable milestone proof | JSON-first verifier pattern in `scripts/verify-m027-s02.ts`, `scripts/verify-m027-s03.ts`, and `scripts/verify-m027-s04.ts` | M027 already established the project’s preferred proof style: stable check IDs, raw evidence preserved, human summary rendered from the same envelope. |
| Grounding and style preservation | Existing patch matching, guardrail pipeline, and voice-preserving pipeline in `src/knowledge/wiki-update-generator.ts`, `src/lib/guardrail/adapters/wiki-adapter.ts`, and `src/knowledge/wiki-voice-*` | M028 is a contract migration, not a reason to rebuild grounding or voice logic. Reuse these layers and narrow their output. |
| GitHub issue comment API client behavior | Octokit REST methods already used throughout the repo; docs confirm create/update/delete/list patterns are standard | No need for raw HTTP or a custom GitHub client. The codebase already standardizes on Octokit. |

## Existing Code and Patterns

- `src/knowledge/wiki-update-types.ts` — Current artifact contract is the core thing that must change. It encodes `suggestion`, `whySummary`, grounding state, citations, and voice flags. Reuse this as the boundary file, but make it modification-first.
- `src/knowledge/wiki-update-generator.ts` — Current generator hard-codes the old product shape: prompt says `Begin with "WHY:"`, parser extracts `whySummary`, storage writes `why_summary`, and grounding checks operate on suggestion text. This is the root contract seam.
- `src/knowledge/wiki-publisher.ts` — Current publisher is suggestion-oriented in both data fetch and rendering. `formatPageComment()` emits `**Why:**` and voice-warning prose; publish flow groups rows as section suggestions by page and only records `published_issue_number`.
- `src/knowledge/wiki-publisher-types.ts` — Page grouping currently assumes `suggestions: [...]` rather than a generic modification artifact list. This type will need to carry mode/scope metadata if full-page publishing is added.
- `src/db/migrations/023-wiki-update-suggestions.sql` — The schema is not neutral. Column names and comments are suggestion-shaped, and the unique index only models one artifact per page section.
- `src/db/migrations/024-wiki-update-publishing.sql` — Publishing state currently tracks only `published_at` and `published_issue_number`. That is insufficient for deterministic retrofit/supersession of individual comments.
- `src/db/migrations/027-wiki-update-grounding-status.sql` — Grounding status already evolved once without replacing the whole pipeline. That is a useful precedent for incremental schema migration rather than rewrite-from-scratch.
- `scripts/generate-wiki-updates.ts` — Existing CLI already has a safe dry-run mode and summary output. Reuse the entrypoint, but update its language and counters to modification artifacts rather than “suggestions generated/dropped”.
- `scripts/publish-wiki-updates.ts` — Existing publish CLI already supports dry-run and file output preview. This is the right place to add retrofit preview/reporting rather than creating a separate ad hoc script unless retrofit turns out operationally distinct enough to justify one.
- `src/handlers/ci-failure.ts` — Reusable pattern for comment marker scan → update existing comment else create new. Useful if M028 chooses in-place supersession/upsert instead of always posting new comments.
- `src/execution/mcp/issue-comment-server.ts` — Confirms the repo already treats `issues.updateComment` as standard behavior and has error handling around it.

## Constraints

- The current generator prompt/parser/storage stack is explicitly built around `WHY:` and `why_summary`; removing rationale text requires changing all three layers together.
- The current DB uniqueness model is `page_id + COALESCE(section_heading, '')`. That fits section replacements only and is awkward for hybrid section/full-page artifacts.
- Publisher grouping assumes all rows for a page are comparable section suggestions. Full-page mode needs either a separate mode field or explicit renderer branching.
- Current publish state stores only `published_issue_number`; there is no durable `published_comment_id` for deterministic retrofit or comment updates.
- Existing tests explicitly assert `WHY:` behavior in `src/knowledge/wiki-update-generator.test.ts` and `**Why:**` rendering in `src/knowledge/wiki-publisher.test.ts`. Those tests will fail until the contract is deliberately rewritten.
- External GitHub mutation is high-risk and must remain dry-run/testable before any live retrofit pass.

## Common Pitfalls

- **Treating this as a formatter tweak** — It is not. If only `formatPageComment()` changes, stale `why_summary` data and `WHY:`-dependent parsing will continue to shape generation/storage and regress later. Change prompt, parser, types, schema, and renderer together.
- **Encoding full-page mode with a null or magic section heading** — That will collide with the existing “Introduction/lead section” meaning and make queries/rendering ambiguous. Use a first-class mode/scope field.
- **Keeping voice warnings in published comments by inertia** — They are commentary, not modification content. Unless explicitly required, keep them as internal review metadata only.
- **Retrofitting without durable comment identity** — Right now the DB can tell you which issue a page was published into, not which comment. Add durable linkage or use explicit supersession markers and comment scanning intentionally.
- **Editing external history before proving the new contract locally** — First prove dry-run output and stored rows are modification-only. Then do GitHub mutations.
- **Overbuilding around direct wiki writes** — The milestone keeps the tracking-issue publication surface. Do not drift into commit/PR automation.

## Open Risks

- The hybrid mode rule could become subjective unless the threshold is made deterministic enough for tests and operator expectations.
- Supersession strategy may be contentious: updating old comments in place is cleaner, but posting explicit superseding comments is safer/auditable given current state limitations.
- Existing rows in `wiki_update_suggestions` may need migration or regeneration if they only exist in the old suggestion+rationale shape.
- If “minimal metadata” is interpreted strictly, even current PR-link rendering and voice-warning UI need pruning decisions before implementation starts.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| PostgreSQL schema work | `wshobson/agents@postgresql-table-design` | available via `npx skills add wshobson/agents@postgresql-table-design`; relevant if schema redesign gets tricky |
| PostgreSQL performance/review | `github/awesome-copilot@postgresql-optimization` | available via `npx skills add github/awesome-copilot@postgresql-optimization`; useful only if migration/query performance becomes a concern |
| GitHub App / issue-comment workflow | none directly relevant found | `npx skills find "GitHub App"` returned unrelated results |
| MediaWiki/wiki publishing | none found | `npx skills find "MediaWiki"` found no skills |

## Sources

- The artifact contract is currently suggestion-shaped end to end: prompt requires `WHY:`, parser extracts `whySummary`, storage writes `why_summary`, and render output includes `**Why:**` (source: `src/knowledge/wiki-update-generator.ts`, `src/knowledge/wiki-update-types.ts`, `src/knowledge/wiki-publisher.ts`)
- The DB schema and publish tracking are currently optimized for per-section suggestions and issue-level publish state, not hybrid modification artifacts with durable comment linkage (source: `src/db/migrations/023-wiki-update-suggestions.sql`, `src/db/migrations/024-wiki-update-publishing.sql`)
- Existing tests hard-lock the old contract, so they can be used as migration checkpoints and regression targets during rewrite (source: `src/knowledge/wiki-update-generator.test.ts`, `src/knowledge/wiki-publisher.test.ts`)
- The repo already has a reusable GitHub comment scan/update pattern for safe upsert behavior (source: `src/handlers/ci-failure.ts`)
- The project already prefers JSON-first, stable-check-ID verifiers that preserve raw evidence and render human output from the same envelope (source: `scripts/verify-m027-s02.ts`, `scripts/verify-m027-s04.ts`)
- Octokit’s standard REST client supports the issue comment create/update/list/delete workflow this milestone needs for comment supersession and retrofit tooling (source: Context7 docs for `/octokit/rest.js`, query: `issues createComment updateComment deleteComment listComments`)
