# M028: Wiki Modification-Only Publishing — Context

**Gathered:** 2026-03-11
**Status:** Queued — pending auto-mode execution.

## Project Description

Kodiai already detects stale wiki content, generates grounded wiki update suggestions from PR evidence, stores them in `wiki_update_suggestions`, and publishes them as structured comments to tracking issues in `xbmc/wiki`. That pipeline was built in M025 around a suggestion-oriented contract: generate section rewrites, include a `WHY:` explanation, store `whySummary`, and publish issue comments that explain what should change.

The user no longer wants suggestion-style wiki feedback. They want the wiki workflow to publish only concrete modifications to the page content itself — modern/current updates expressed as replacement wiki text, not commentary about what Kodiai thinks should change.

## Why This Milestone

M025 solved grounding, voice preservation, and publishing, but its output contract is wrong for the user's actual workflow. The current publisher explicitly emits explanatory prose (`**Why:** ...`) and suggestion framing, which makes the comments less actionable. The linked xbmc/wiki issue comment is evidence that the system is currently optimizing for review/discussion rather than for application.

This milestone changes the wiki update product contract from **suggestion + rationale** to **publishable modifications + minimal metadata**. It also covers retrofitting already-published wiki issue output so the existing tracking thread can be superseded by modification-only artifacts.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Read wiki update output that consists of concrete replacement content for the page, without opinionated rationale text.
- Use generated wiki issue comments as direct page-update artifacts, with only minimal citations/metadata needed to trace where the modifications came from.

### Entry point / environment

- Entry point: `scripts/generate-wiki-updates.ts`, `scripts/publish-wiki-updates.ts`, and the resulting `xbmc/wiki` tracking issue comments
- Environment: local generation/publishing tooling plus live GitHub issue publication to the wiki repo
- Live dependencies involved: PostgreSQL (`wiki_update_suggestions`), GitHub App auth for `xbmc/wiki`, existing wiki staleness + PR evidence pipeline, LLM generation pipeline

## Completion Class

- Contract complete means: generated wiki artifacts are modification-only, with no opinion/rationale prose in the stored or published output contract.
- Integration complete means: the existing wiki generation and publishing pipeline can produce and publish the new modification artifacts using the real `xbmc/wiki` issue workflow.
- Operational complete means: already-published suggestion-style wiki comments can be retrofitted or superseded in a deterministic way, and future runs continue using the new contract.

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- A generated wiki update artifact contains only concrete page modifications (replacement section text or full-page replacement text), plus minimal citations/metadata, and does not include `WHY:`/opinion prose.
- The publisher posts modification-only wiki comments to the tracking issue flow in `xbmc/wiki`, replacing the current suggestion-style issue comment format.
- Existing already-published wiki issue comments can be retrofitted, superseded, or otherwise made consistent with the new contract in a reproducible way.

## Risks and Unknowns

- **Modernization scope may drift into opinion** — the user wants pages to feel more modern/current, but not to receive explanatory opinion text; planning must define how much editorial inference is acceptable without reintroducing subjective commentary.
- **Current schema and publisher are suggestion-shaped** — `whySummary`, suggestion labels, and issue formatting are wired through storage, tests, and publisher output; changing the contract will touch multiple layers.
- **Granularity may vary by page** — the user chose a hybrid model (full-page output for broad changes, section replacements for narrower ones), so planning must define when each mode applies.
- **Retrofit mechanics are not yet settled** — existing issue comments may need regeneration, follow-up replacement comments, or some other supersession strategy rather than in-place edits.

## Existing Codebase / Prior Art

- `src/knowledge/wiki-update-generator.ts` — current generation contract requires `WHY:` and stores suggestion-oriented outputs.
- `src/knowledge/wiki-publisher.ts` — current publish format renders `suggestion`, `whySummary`, voice warnings, and PR links into tracking-issue comments.
- `src/knowledge/wiki-update-types.ts` — current stored type model is built around `suggestion` + `whySummary` rather than a first-class modification artifact.
- `scripts/generate-wiki-updates.ts` — current generation entrypoint for stale-page update artifacts.
- `scripts/publish-wiki-updates.ts` — current issue-comment publisher to `xbmc/wiki`.
- `src/db/migrations/023-wiki-update-suggestions.sql` and follow-up migrations — current persistence model for wiki suggestions and publishing state.
- `M025` milestone artifacts — prior art for grounded wiki update suggestion generation and publishing.

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R025 — Wiki outputs are modification-only, not suggestion/rationale oriented.
- R026 — Published wiki comments include only concrete replacement content plus minimal citations/metadata.
- R027 — Wiki modification artifacts support hybrid granularity: section replacement by default, full-page replacement when many sections change.
- R028 — Existing published suggestion-style wiki issue comments can be retrofitted or superseded.
- R029 — Regression checks prevent `WHY:`/opinion-style wiki publication from reappearing.

## Scope

### In Scope

- Replace suggestion-style wiki generation with modification-only artifact generation.
- Remove explanatory `WHY:` prose and similar opinionated framing from stored and published wiki outputs.
- Keep minimal machine-usable metadata such as section headings and cited PR links.
- Support hybrid granularity: section replacements for focused changes, full-page modifications when many sections change.
- Replace the current tracking-issue comment format in `xbmc/wiki`.
- Retrofit or supersede already-published suggestion-style wiki comments like the linked example.
- Add tests and deterministic verification for the new output contract.

### Out of Scope / Non-Goals

- Changing the core stale-page detection heuristics.
- Reworking unrelated wiki embedding, popularity, or staleness subsystems unless required by the new output contract.
- Publishing direct wiki commits or PRs; the user chose modification-only issue output, not direct repository writes.
- General-purpose prose quality tuning outside the wiki update pipeline.

## Technical Constraints

- The new contract must eliminate opinion/rationale prose from published wiki outputs.
- The existing tracking-issue workflow in `xbmc/wiki` remains the publication surface.
- Minimal citations/metadata may remain, but no explanatory prose about what Kodiai thinks should change.
- Hybrid output mode must be deterministic enough for operators and tests to verify.
- Retrofit behavior for old comments must be reproducible and safe for externally visible GitHub issue history.

## Integration Points

- `wiki_update_suggestions` storage model — may need schema and type contract changes to represent modification artifacts rather than suggestion/rationale pairs.
- Wiki generation pipeline — must emit modification-only content from grounded PR evidence.
- Wiki publisher — must replace current issue comment rendering in `xbmc/wiki`.
- GitHub issue history in `xbmc/wiki` — existing externally visible comments need a retrofit/supersession path.
- M025 wiki update system — this milestone is a direct follow-on and contract correction to that work.

## Open Questions

- Exact rule for switching from section replacement to full-page output is still open — current thinking is hybrid mode based on breadth of page impact.
- Retrofit mechanism for existing issue comments is still open — current thinking is to supersede or regenerate deterministically rather than leave mixed old/new output in the same workflow.
