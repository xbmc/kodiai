---
gsd_state_version: 1.0
milestone: v0.25
milestone_name: Wiki Content Updates
status: completed
stopped_at: Completed 126-05-PLAN.md (phase 126 complete)
last_updated: "2026-03-07T15:13:29.525Z"
last_activity: 2026-03-07 -- Completed 126-05 (Audit Store Wiring and Review Authoritative Mode)
progress:
  total_phases: 7
  completed_phases: 7
  total_plans: 19
  completed_plans: 19
  percent: 100
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-03-05)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.25 Wiki Content Updates -- Phase 123: Update Generation

## Current Position

Phase: 126 of 126 (Global Anti-Hallucination Guardrails)
Plan: 5 of 5 complete
Status: Phase 126 complete
Last activity: 2026-03-07 -- Completed 126-05 (Audit Store Wiring and Review Authoritative Mode)

Progress: [██████████] 100%

## Accumulated Context

### Roadmap Evolution

- Phase 125 added: Voice-preserving updates — preserve existing formatting, voice, tone, and style when generating wiki page update suggestions
- Phase 126 added: Global Anti-Hallucination Guardrails — system-wide framework for detecting and preventing fabricated content across all output surfaces

### Decisions

All decisions through v0.24 archived to `.planning/PROJECT.md` Key Decisions table.

- Wiki store uses parameterized embeddingModel with voyage-code-3 default for backward compat (120-01)
- Wiki sync scheduler uses wikiEmbeddingProvider so new pages get voyage-context-3 embeddings (120-01)
- contextualizedEmbedChunks batch helper uses 30s timeout for larger payloads (120-01)
- Backfill script uses batch page-level embedding with per-chunk fallback on token limit errors (120-02)
- Comparison benchmark generates query embeddings on the fly for both models against existing DB vectors (120-02)
- [Phase 120]: Backfill script uses batch page-level embedding with per-chunk fallback on token limit errors (120-02)
- Min-max normalization with zero-division guard for wiki popularity composite scoring (121-01)
- Fire-and-forget citation logging via void + .catch() pattern in retrieval pipeline (121-01)
- Deduplicate page_ids within single retrieval call before citation INSERT (121-01)
- Default to 365 days since edit when last_modified is null for popularity scoring (121-02)
- Direct SQL DISTINCT ON query for page dedup in scorer rather than WikiPageStore methods (121-02)
- Popularity store declared unconditionally so both retriever and scorer can access it (121-03)
- Scorer starts unconditionally (not gated on Slack config) since popularity scoring is independent (121-03)
- [Phase 122]: parseIssueReferences called with {prBody, commitMessages} object signature (actual API) not (text, source) as plan assumed
- [Phase 122]: Stopwords filtered from both chunk tokens AND path tokens to prevent any contribution from ubiquitous domain terms
- [Phase 122]: Heading tokens take priority: if a token appears in both heading and body, heading weight (3x) applies
- [Phase 122]: affectingCommitShas kept as empty array for backward compat during PR pipeline transition
- [Phase 122]: Patch content capped at 3000 chars in LLM prompt to prevent token bloat
- [Phase 125]: Template check uses retry-once-then-drop: regenerate once on missing templates, drop suggestion entirely on second failure
- [Phase 125]: Formatting novelty is advisory-only: novel formatting encouraged, flagged but never blocks
- [Phase 125]: Generation prompt reversed from "restrict to existing formatting" to "improve formatting freely"
- [Phase 125]: Bun.hash for content-hash cache invalidation; spread sampling first/middle/last 2 chunks; extractWikiConventions scans all chunks
- [Phase quick-18]: PR title prefix detection uses keyword matching on issue title content (feat/fix/refactor)
- [Phase 126]: Allowlist uses substring matching on lowercase claim text for simplicity and performance
- [Phase 126]: Context classifier checks allowlist first, then external-knowledge patterns, then diff delegation, then word overlap
- [Phase 126]: Fire-and-forget audit logging via void + .catch() pattern consistent with citation logging (121-01)
- [Phase 126]: Review adapter wraps existing claim-classifier.ts and output-filter.ts rather than reimplementing -- zero behavior change
- [Phase 126]: LLM classifier batches up to 10 claims per Haiku call to minimize overhead
- [Phase 126]: Pipeline collects all ambiguous claims first, then makes single batched LLM call instead of per-claim calls
- [Phase 126]: Wiki adapter preserves {{template}} markers regardless of classification and grounds via PR patch content
- [Phase 126]: Review handler runs guardrail alongside existing classify/filter flow (audit logging, not replacing)
- [Phase 126]: Mention/Slack handlers skip guardrail for short template messages to avoid false-positive filtering
- [Phase 126]: Wiki handler falls back to legacy checkGrounding on pipeline error (dual-path safety)
- [Phase 126]: Triage excluded from wiring -- confirmed template-only output with zero LLM prose
- [Phase 126]: AuditStore created once per handler init (stateless, holds sql reference) not per-request
- [Phase 126]: Review guardrail output applied via map marking removed findings as suppressed (preserves array structure)
- [Phase 126]: filterAction type extended with guardrail-suppressed and guardrail-rewritten values

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- Wiki corpus migrating from voyage-code-3 to voyage-context-3; all other corpora stay on voyage-code-3
- voyage-context-3 uses different API: `contextualizedEmbed()` with `inputs: string[][]`, not `/v1/embeddings`
- wiki-store.ts now parameterized (no longer hardcodes voyage-code-3) -- RESOLVED in 120-01
- kodi.wiki has NO PageViewInfo extension -- use inbound links + citation frequency + edit recency instead
- GitHub secondary rate limit caps at ~80 req/min for content creation -- need 3s delays between comments
- Must verify GitHub App installation on xbmc/wiki before publishing phase
- Fail-open philosophy: embedding/retrieval failures logged but never block critical path
- Bun `streamText()` has production build failure (oven-sh/bun#25630) -- use `generateText()` exclusively
- Agent SDK owns agentic tasks; Vercel AI SDK owns non-agentic tasks only

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to.

### Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 16 | Parse Windows package lists and harden pipeline against all-null enrichment | 2026-03-03 | cd571d7945 | [16-parse-windows-package-lists-and-harden-p](./quick/16-parse-windows-package-lists-and-harden-p/) |
| 17 | Add patch-to-PR feature: detect "create a patch" as write intent on PR surfaces | 2026-03-03 | b0d41ac420 | [17-add-patch-to-pr-feature-when-asked-to-cr](./quick/17-add-patch-to-pr-feature-when-asked-to-cr/) |
| 18 | Improve PR title and description generation for write-mode PRs | 2026-03-05 | c470d79a89 | [18-improve-pr-title-and-description-generat](./quick/18-improve-pr-title-and-description-generat/) |
| 19 | Add anti-hallucination guardrails to write-mode prompt and diff scanner | 2026-03-05 | e4b9f22d7b | [19-add-anti-hallucination-guardrails-to-wri](./quick/19-add-anti-hallucination-guardrails-to-wri/) |
| 20 | Improve commit message quality with conventional-commit format | 2026-03-05 | e9e63be6f6 | [20-improve-commit-message-quality-guideline](./quick/20-improve-commit-message-quality-guideline/) |
| 21 | Expand PR surface write intent detection for implementation verbs and confirmations | 2026-03-05 | 2720d8ae58 | [21-expand-pr-surface-write-intent-detection](./quick/21-expand-pr-surface-write-intent-detection/) |

## Session Continuity

**Last session:** 2026-03-07T15:08:39Z
**Stopped At:** Completed 126-05-PLAN.md (phase 126 complete)
**Resume file:** None
