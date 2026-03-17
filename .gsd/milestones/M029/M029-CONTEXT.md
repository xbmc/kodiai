# M029: Wiki Generation Quality & Issue Cleanup

**Gathered:** 2026-03-16
**Status:** Queued — pending auto-mode execution.

## Project Description

The wiki generation pipeline runs correctly end-to-end but produces low-quality output: the LLM outputs reasoning prose ("I'll analyze the evidence...", "Let me first read the current section...") instead of actual replacement wiki text. Additionally, pages are being targeted for updates when the matched PR evidence has no semantic connection to the page content (e.g., C++ source changes triggering updates to "Music library" or "Main Page"). The result is that xbmc/wiki issue #5 is currently filled with useless comments.

## Why This Milestone

M028 proved the publication pipeline works correctly — comments are posted with identity markers, upsert logic works, regression guards are in place. But the content being published is garbage: the LLM treating the generation task as an agentic reasoning task instead of a content-production task, and the page-targeting system matching pages by superficial token overlap rather than genuine semantic relevance.

The issue is visible to external contributors on xbmc/wiki issue #5 (there's already a human complaint comment calling the output non-actionable). This needs to be fixed before the pipeline produces any more noise.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Run `bun scripts/generate-wiki-updates.ts` and get stored suggestions that contain actual replacement wiki text — not reasoning prose
- Run `bun scripts/publish-wiki-updates.ts --issue-number 5` and have only PR-relevant pages with real content posted to xbmc/wiki
- Look at xbmc/wiki issue #5 and see only the summary table plus high-quality modification-only comments tied to specific PRs
- Trust that a "grounded" suggestion label actually means the content is substantive wiki text, not an analysis of why the section mayor may not need updating

### Entry point / environment

- Entry point: `scripts/generate-wiki-updates.ts`, `scripts/publish-wiki-updates.ts`, xbmc/wiki issue #5
- Environment: production — requires live DB, Voyage AI, LLM provider, GitHub App auth
- Live dependencies involved: Azure PostgreSQL, LLM generation pipeline (via `taskRouter`), GitHub App for issue #5 cleanup

## Completion Class

- Contract complete means: `buildVoicePreservingPrompt` explicitly bans meta-commentary; a post-generation content filter rejects suggestions that are reasoning/analysis rather than wiki content; `checkGrounding` or its guardrail equivalent rejects suggestions with empty `citing_prs` and short content
- Integration complete means: re-generating pages produces stored suggestions that pass a content-quality check (actual wiki text, not agent reasoning); xbmc/wiki issue #5 is cleaned up and contains only modification-only comments for PR-relevant pages
- Operational complete means: the pipeline does not publish to pages where the matched PR evidence is purely internal C++ changes with no wiki documentation relevance

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- A generation run produces stored suggestions where every published suggestion contains substantive wiki text (not reasoning prose), verifiable by checking that no stored suggestion body starts with or primarily contains "I'll", "Let me", "I need to", "I will analyze" etc.
- xbmc/wiki issue #5 has the summary table comment plus at least one high-quality modification comment where the content is actual wiki replacement text tied to a real PR
- The grounding/quality filter rejects agent-reasoning suggestions as a test-verifiable contract (unit test: feed "I'll analyze the evidence from PR #27909" → rejected; feed real wiki content with PR citation → accepted)

## Risks and Unknowns

- **Page relevance filtering may be over-aggressive** — tightening the PR evidence → wiki page relevance score could result in zero pages being targeted. Need a balance that allows genuinely relevant matches (e.g., an API change in a C++ file that corresponds to documented behavior) while rejecting purely internal changes.
- **LLM behavior is non-deterministic** — even with a fixed prompt, the model may still output reasoning prose for some sections. The post-generation filter is the reliable gate, not just the prompt.
- **Re-generation overwrites stored suggestions** — the current `storeSuggestion` DELETE+INSERT approach means re-running generation will replace existing published rows' source data. Need to decide whether to wipe and regenerate or add new rows alongside existing ones.
- **What counts as "relevant" PR evidence** — the current heuristic matching (token overlap between PR diff content and wiki section content) produces false positives for generic sections like "Introduction" on any page that shares vocabulary with any PR. May need a minimum heuristic score threshold.

## Existing Codebase / Prior Art

- `src/knowledge/wiki-voice-analyzer.ts` — `buildVoicePreservingPrompt()` — the prompt that needs to ban meta-commentary; `createVoicePreservingPipeline()` — the pipeline calling the LLM and returning `VoicePreservedUpdate[]`
- `src/knowledge/wiki-update-generator.ts` — `matchPatchesToSection()` (line 81) — PR-to-section matching via heuristic overlap score; `processPage()` (line 469) — main generation loop; `checkGrounding()` (line 268) — grounding check (currently deprecated, replaced by guardrail pipeline); `buildGroundedSectionPrompt()` (line 160) — original prompt (still has `WHY:` instruction, not used by voice pipeline)
- `src/knowledge/wiki-update-generator.ts` — `createUpdateGenerator()` (line ~332) — page selection query joins `wiki_page_popularity` with `wiki_pr_evidence` by `matched_page_id` (line 383)
- `src/knowledge/wiki-staleness-detector.ts` / `src/knowledge/wiki-pr-matcher.ts` — upstream systems that populate `wiki_pr_evidence` with `heuristic_score` values
- `scripts/generate-wiki-updates.ts` — CLI entry point
- `scripts/publish-wiki-updates.ts` — CLI entry point with `--issue-number` flag

## Relevant Requirements

No new formal requirements — this is a quality correction to the existing R025/R026 contract. The generation output must actually be wiki content, not reasoning prose, for R025/R026 to be meaningfully satisfied.

## Scope

### In Scope

- Fix `buildVoicePreservingPrompt` to explicitly ban meta-commentary and require actual replacement content output
- Add a post-generation content filter that rejects suggestions identified as reasoning/analysis prose rather than wiki text (pattern-based heuristic: starts with "I'll", "Let me", "I need to", "I will", "Looking at", contains no MediaWiki markup and no PR citation and is short reasoning text)
- Add a minimum `heuristicScore` threshold for PR evidence → section matching to filter out low-relevance page targeting
- Delete all non-summary-table comments from xbmc/wiki issue #5 (comments 4044181807–4049128966) using the GitHub API
- Delete all current kodiai-marker comments from xbmc/wiki issue #5 (IDs 4071499246–4071616057) that contain garbage content
- Re-run generation and publication for pages with genuinely relevant PR evidence
- Add tests: unit test for the content filter (reasoning text → rejected, real wiki content → accepted); regression test that the prompt contains an explicit no-meta-commentary instruction

### Out of Scope / Non-Goals

- Redesigning the staleness detection or page popularity scoring
- Changing the wiki PR evidence matching algorithm fundamentally — just raising the minimum quality threshold
- Publishing direct wiki commits or PRs
- Fixing `buildGroundedSectionPrompt` (not used by the voice pipeline)
- Adding new wiki pages to the corpus

## Technical Constraints

- Comment deletion on GitHub requires the GitHub App installation token — use the same `getInstallationOctokit` pattern used by the publisher
- Re-generation must not re-publish garbage — clean the DB and/or apply the quality filter before the publish run
- The content filter should be deterministic (pattern-based), not LLM-based, to avoid adding cost and latency to an already expensive pipeline
- Tests must not require live GitHub or LLM access — mock the generation function

## Integration Points

- `buildVoicePreservingPrompt` in `src/knowledge/wiki-voice-analyzer.ts` — prompt fix lives here
- `createVoicePreservingPipeline` in `src/knowledge/wiki-voice-analyzer.ts` — filter hooks in here, between generation and storage
- `matchPatchesToSection` in `src/knowledge/wiki-update-generator.ts` — heuristic score threshold filter here
- GitHub API via `getInstallationOctokit('xbmc', 'wiki')` + `getRepoInstallationContext` — for issue comment deletion
- `wiki_update_suggestions` table — stale garbage rows need to be cleared before re-generation

## Open Questions

- What heuristic score threshold is appropriate for PR evidence matching? The current code doesn't enforce a minimum. Need to check the distribution of scores in the DB to pick a sensible floor.
- Should the issue cleanup be a standalone script or part of `publish-wiki-updates.ts`? Leaning toward standalone `scripts/cleanup-wiki-issue.ts` since it's a one-time operation with destructive GitHub mutations — keep it separate and explicit.
- Should existing published DB rows be deleted before re-generation, or should re-generation add new rows that supersede on the next publish? Current DELETE+INSERT in `storeSuggestion` means re-running generation will naturally replace them.
