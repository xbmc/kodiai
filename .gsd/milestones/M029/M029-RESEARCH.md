# M029 — Research

**Date:** 2026-03-21

## Summary

M029 is a targeted quality correction with four independent layers of work: a prompt fix, a content filter, a page-selection relevance threshold, and a one-time issue cleanup operation. The code changes are surgical — each touches a single function or query — but they must all land before re-generation to prevent the pipeline from producing and publishing more garbage. The proof harness verifying the final state is the right final delivery artifact, following the M027/M028 pattern.

The root cause of reasoning prose is a gap in `buildVoicePreservingPrompt`: the prompt instructs the LLM to match voice and preserve templates but never says "output only replacement wiki text — do not explain what you are doing." The LLM's default behavior when given an analytical task without an explicit output-format constraint is to narrate its reasoning. No amount of voice-matching guidance fixes this; it requires an explicit prohibition.

The post-generation content filter is the reliable enforcement gate. The prompt fix reduces frequency; the filter is the deterministic contract.

---

## Codebase Map

### Generation pipeline

```
scripts/generate-wiki-updates.ts          CLI entry point
  └── createUpdateGenerator()             src/knowledge/wiki-update-generator.ts
        ├── page selection query          (INNER JOIN wiki_pr_evidence, no score filter)
        ├── matchPatchesToSection()       section-level token overlap (MIN_OVERLAP_SCORE=2)
        └── createVoicePreservingPipeline()
              ├── extractPageStyle()      src/knowledge/wiki-voice-analyzer.ts
              ├── buildVoicePreservingPrompt()   ← PRIMARY CHANGE TARGET
              ├── generateSectionUpdate() LLM call
              └── generateWithVoicePreservation()  src/knowledge/wiki-voice-validator.ts
                    ├── checkTemplatePreservation()
                    ├── checkHeadingLevels()
                    ├── validateVoiceMatch()  (LLM validator)
                    └── [missing] isReasoningProse()   ← NEW GATE NEEDED HERE
```

### Publishing pipeline

```
scripts/publish-wiki-updates.ts
  └── createWikiPublisher()               src/knowledge/wiki-publisher.ts
        ├── upsertWikiPageComment()       marker scan → update or create
        └── formatPageComment()           renders suggestion content
```

### Relevant DB tables

- `wiki_pr_evidence` — `heuristic_score INTEGER NOT NULL DEFAULT 0` — page-level match quality, **no minimum enforced in page selection**
- `wiki_update_suggestions` — `suggestion TEXT`, `grounding_status`, `published_at`, `published_comment_id BIGINT` (migration 031)
- `wiki_style_cache` — cached style extractions (TTL 7 days)

---

## Key Findings

### Finding 1: Prompt Does Not Prohibit Reasoning Prose

`buildVoicePreservingPrompt` has no instruction banning "I'll analyze", "Let me first", etc. The LLM's default behavior when given an analytical task without an explicit output-format constraint is to narrate its reasoning. Fix: add a `## Output Contract` section explicitly banning reasoning starters.

### Finding 2: No Post-Generation Content Filter

`generateWithVoicePreservation` runs template, heading, voice checks but none detect reasoning prose. A reasoning prose suggestion can pass all existing checks. Add `isReasoningProse()` — a deterministic pattern-based function — before the voice validator.

### Finding 3: No Heuristic Score Threshold in Page Selection

The page selection query in `createUpdateGenerator` includes any page with any PR evidence record regardless of `heuristic_score`. The staleness detector already classifies score >= 3 as "High." Adding `AND wpe.heuristic_score >= 3` eliminates obvious false positives.

### Finding 4: Issue Cleanup Script Is Missing

No `scripts/cleanup-wiki-issue.ts` exists. Approach: scan-then-delete by marker presence (`<!-- kodiai:wiki-modification:NNN -->`), not by hardcoded ID ranges. Auth pattern: follows `cleanup-legacy-branches.ts` exactly.

### Finding 5: Voice Validator Won't Catch Reasoning Prose

The LLM-based `validateVoiceMatch()` may score reasoning prose as voice-matching. The content filter must run BEFORE voice validation, not as alternative.

### Finding 6: Test Suite Is Clean Baseline

31+24+39+20 tests passing, 0 failing. New tests are additive.

---

## Recommended Slice Order

1. **S01: Prompt Fix + Content Filter** — pure code, deterministic tests, proves core contract
2. **S02: Heuristic Score Threshold** — pure code (mocked SQL), sets relevance bar
3. **S03: Issue Cleanup Script** — one-time operational tool, dry-run safety
4. **S04: Re-generation, Re-publication, Proof Harness** — integration + M028-pattern JSON verifier

## Candidate Requirements

- **R033** — Generation output is pattern-verified before storage (deterministic content filter)
- **R034** — Page selection enforces minimum evidence quality threshold (heuristic_score >= 3)
