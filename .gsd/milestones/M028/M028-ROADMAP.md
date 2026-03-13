# M028: Wiki Modification-Only Publishing

**Vision:** Kodiai’s wiki update pipeline produces directly usable wiki modification artifacts, publishes only replacement content plus minimal trace metadata to the existing `xbmc/wiki` tracking issue flow, and can supersede already-published suggestion-style comments so the live workflow no longer presents the old contract.

## Success Criteria

- Running the wiki generation entrypoint produces persisted artifacts whose primary content is replacement wiki text only, with explicit section-or-page scope metadata and no `WHY:`/rationale prose.
- Running the wiki publish flow renders tracking-issue comments that contain only concrete replacement content plus minimal citations/trace metadata, with no opinionated framing, voice-warning prose, or suggestion language.
- The pipeline can deterministically choose section replacement for narrow updates and full-page replacement for broad updates, and that choice is visible in stored artifacts and publish previews.
- Operators can deterministically identify and supersede already-published suggestion-style wiki comments so the live `xbmc/wiki` thread reflects the new contract instead of a mixed old/new format.
- Regression checks fail if stored artifacts, publish previews, or live-rendered comments reintroduce `WHY:` blocks or other suggestion-oriented prose.

## Key Risks / Unknowns

- The current pipeline is suggestion-shaped end to end — prompt, parser, types, schema, CLI summaries, and publisher rendering all assume `WHY:` plus suggestion text, so a partial rewrite would leave hidden regressions.
- Hybrid granularity is not modeled explicitly today — without a first-class mode/scope contract, full-page output will be ambiguous and brittle in storage, rendering, and tests.
- Retrofit behavior is operationally risky — current publish state tracks issue numbers but not durable comment identity, so superseding old comments reproducibly needs explicit linkage or deterministic marker scanning.
- The user-visible contract lives on GitHub, not only in local scripts — dry-run correctness alone is insufficient if the real `xbmc/wiki` issue flow still posts or preserves suggestion-style output.

## Proof Strategy

- The current pipeline is suggestion-shaped end to end → retire in S01 by proving the real generate + publish-dry-run entrypoints emit persisted and rendered modification artifacts with no `WHY:`/rationale contract anywhere in the main path.
- Hybrid granularity is not modeled explicitly today → retire in S01 by proving generated artifacts and publish previews carry an explicit section/page mode that operators and tests can inspect directly.
- Retrofit behavior is operationally risky → retire in S02 by proving the publisher can deterministically identify prior wiki comments, preview supersession actions, and target stable comment identities instead of ad hoc manual cleanup.
- The user-visible contract lives on GitHub, not only in local scripts → retire in S03 and S04 by proving the real `xbmc/wiki` publication flow emits modification-only comments for future runs and that final integrated acceptance re-checks live publish/supersession behavior plus regression guards together.

## Verification Classes

- Contract verification: unit/integration tests for artifact parsing/rendering, mode-selection rules, schema/type contracts, comment formatting, and negative checks that ban `WHY:`/suggestion prose in stored and rendered output.
- Integration verification: real `scripts/generate-wiki-updates.ts` and `scripts/publish-wiki-updates.ts` runs against production-wired Postgres plus the real GitHub issue-comment client path, starting in dry-run and ending with live publication/supersession.
- Operational verification: deterministic retrofit preview/reporting, durable published comment linkage or marker scan behavior, and idempotent rerun behavior for already-superseded wiki comments.
- UAT / human verification: minimal operator review of generated comment readability; milestone proof remains primarily machine-checkable.

## Milestone Definition of Done

This milestone is complete only when all are true:

- The wiki generation, persistence, and publish layers all use a modification-first contract rather than a suggestion-plus-rationale contract.
- Shared types, schema, CLI summaries, and comment rendering are wired together around explicit section/page modification artifacts and minimal metadata only.
- The real entrypoints (`scripts/generate-wiki-updates.ts` and `scripts/publish-wiki-updates.ts`) are exercised through the actual `xbmc/wiki` tracking-issue workflow, not only fixture renderers.
- Success criteria are re-checked with real generation/publish output, including retrofit or supersession behavior for existing suggestion-style comments.
- Final integrated acceptance passes: modification-only artifacts are generated, published comments stay modification-only, historical suggestion comments are reproducibly superseded, and regression guards fail on any reintroduced `WHY:`/opinion text.

## Requirement Coverage

- Covers: R025, R026, R027, R028, R029
- Partially covers: none
- Leaves for later: none
- Orphan risks: none — every active M028 requirement is mapped below

### Requirement Ownership Map

- **R025 — Wiki outputs are modification-only** → primary: S01; support: S03, S04
- **R026 — Published wiki comments contain only modification content plus minimal metadata** → primary: S03; support: S01, S04
- **R027 — Wiki modification artifacts support hybrid granularity** → primary: S01; support: S03, S04
- **R028 — Existing published wiki suggestion comments can be retrofitted or superseded** → primary: S02; support: S03, S04
- **R029 — Regression checks prevent opinion-style wiki publishing from returning** → primary: S04; support: S01, S02, S03

### Coverage Summary

- Active requirements: 5
- Mapped to slices: 5
- Deferred from this milestone: 0
- Blocked during planning: 0

## Slices

- [ ] **S01: Modification Artifact Contract Through Real Entry Points** `risk:high` `depends:[]`
  > After this: operators can run the real wiki generate + publish-dry-run commands and inspect persisted/rendered outputs that are modification-only, explicitly scoped as section or page replacements, and free of `WHY:`/suggestion prose.
- [ ] **S02: Deterministic Retrofit & Comment Identity Surface** `risk:high` `depends:[S01]`
  > After this: operators can preview exactly which existing `xbmc/wiki` comments will be updated or superseded, using stable comment identity or deterministic markers rather than manual thread cleanup.
- [ ] **S03: Live Modification-Only Wiki Publishing** `risk:medium` `depends:[S01,S02]`
  > After this: the real `xbmc/wiki` tracking issue flow publishes modification-only comments for new wiki updates and can supersede prior suggestion-style output through the same live publisher path.
- [ ] **S04: Final Integrated Publication & Retrofit Proof** `risk:medium` `depends:[S01,S02,S03]`
  > After this: a single production-style acceptance path proves the assembled system end to end — generation persists the new artifact contract, publication renders only modification text, retrofit leaves the live thread contract-consistent, and regression checks catch any return of `WHY:`/opinion prose.

## Boundary Map

### S01 → S02

Produces:
- A first-class modification artifact contract in `src/knowledge/wiki-update-types.ts` with explicit mode/scope (`section` vs `page`), replacement text, and separate citations/trace metadata.
- Generator/parser/storage behavior that no longer emits or persists `whySummary`/suggestion-first content on the main wiki-update path.
- A dry-run publication render contract that downstream retrofit logic can treat as the canonical replacement comment body.
- Deterministic mode-selection rules that make section/page scope machine-checkable in tests and operator output.

Consumes:
- nothing (first slice)

### S02 → S03

Produces:
- Durable publication linkage for wiki comments: persisted comment identity and/or deterministic marker scan rules that tell the publisher exactly which live comment to update or supersede.
- A retrofit preview/report contract from `scripts/publish-wiki-updates.ts` showing planned comment actions without mutating GitHub.
- Idempotent supersession behavior for already-retrofitted pages so reruns stay reproducible.

Consumes:
- S01 modification artifact contract, canonical dry-run render output, and explicit section/page mode.

### S03 → S04

Produces:
- The live `xbmc/wiki` publication behavior for both future modification-only comments and historical suggestion-comment supersession.
- Stable operator-visible publication state showing which issue/comment now represents the canonical wiki modification artifact for a page.
- Contract tests and live-facing checks that prove rendered comments contain only replacement content plus allowed metadata.

Consumes:
- S01 modification artifact contract.
- S02 comment-identity and retrofit-preview surfaces.
