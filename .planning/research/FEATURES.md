# Feature Landscape

**Domain:** GitHub issue intelligence -- historical ingestion, duplicate detection, PR-issue linking, auto-triage
**Researched:** 2026-02-26
**Milestone:** v0.22 Issue Intelligence
**Confidence:** HIGH for ingestion and auto-triage, MEDIUM for duplicate thresholds, MEDIUM for PR-issue linking

## Existing Foundation (Already Built)

These features are production and form the base for v0.22:

| Existing Capability | Module | How v0.22 Extends It |
|---------------------|--------|---------------------|
| Issue corpus with `issues`/`issue_comments` tables, HNSW vector indexes | `knowledge/issue-store.ts`, migration 014 | Backfill populates these tables; duplicate detection queries them |
| `IssueStore.findSimilar()` with cosine distance threshold | `knowledge/issue-store.ts` | Duplicate detection wraps this with high-confidence gating |
| `IssueStore.searchByEmbedding()` and `searchByFullText()` | `knowledge/issue-store.ts` | PR-issue linking uses these for semantic matching |
| `IssueStore.upsert()` with ON CONFLICT DO UPDATE | `knowledge/issue-store.ts` | Backfill and nightly sync use idempotent upsert |
| `IssueStore.upsertComment()` with ON CONFLICT DO UPDATE | `knowledge/issue-store.ts` | Comment backfill uses idempotent upsert |
| Triage validation agent with template parsing | `triage/triage-agent.ts` | Auto-triage reuses this agent, triggered by webhook instead of @mention |
| `github_issue_label` and `github_issue_comment` MCP tools | `execution/mcp/issue-*-server.ts` | Auto-triage uses these same tools |
| 18-month PR review comment backfill pipeline | `knowledge/review-comment-backfill.ts` | Issue backfill follows identical pattern: paginated fetch, embed, store, sync state |
| Nightly wiki sync job with scheduled interval | `knowledge/wiki-sync.ts` | Nightly issue sync follows same scheduler pattern |
| Adaptive rate limiting (1.5s/3s delays based on remaining) | `knowledge/review-comment-backfill.ts` | Reuse same `adaptiveRateDelay` pattern for issue API calls |
| Webhook deduplication via `X-GitHub-Delivery` header | `webhook/dedup.ts` | Auto-triage idempotency builds on existing dedup |
| Per-issue cooldown with body-hash reset | Triage agent | Prevents duplicate auto-triage comments |
| `.kodiai.yml` config gating (`triage.enabled`) | `execution/config.ts` | Auto-triage adds `triage.autoTriageOnOpen` config flag |
| Voyage AI embedding provider | `knowledge/types.ts` | Same provider embeds issue title+body for corpus |
| Cross-corpus RRF retrieval | `knowledge/cross-corpus-rrf.ts` | Issue corpus wired as 6th source in retrieval fan-out |

## Table Stakes

Features users expect. Missing = product feels incomplete for the stated v0.22 goals.

| Feature | Why Expected | Complexity | Dependencies on Existing | Notes |
|---------|--------------|------------|--------------------------|-------|
| **Historical issue backfill** | Cannot do duplicate detection or PR-issue linking without a populated corpus. Every similar tool (Simili, Similar Issues AI) requires a corpus of existing issues. This is the foundational prerequisite. | MEDIUM | `IssueStore.upsert()`, `IssueStore.upsertComment()`, Voyage AI embeddings, Octokit pagination | Follow review-comment-backfill pattern exactly: paginated `GET /repos/{owner}/{repo}/issues`, filter `is_pull_request: false`, adaptive rate delay, sync state tracking, cursor-based resume. xbmc/xbmc has ~3000+ closed issues -- expect ~30+ pages at 100/page. GitHub Issues API returns PRs too; must filter `pull_request` field. |
| **Issue embedding on ingest** | Vector similarity search requires embeddings. Every issue needs `title + body` embedded via Voyage AI. Without embeddings, `findSimilar()` and `searchByEmbedding()` return nothing. | LOW | Voyage AI `EmbeddingProvider`, existing `IssueStore.upsert()` accepts `embedding` field | Embed `"${title}\n\n${body}"` as a single document. No chunking needed -- issues are typically 200-2000 tokens, well within Voyage AI's context window. Batch embedding (10-20 at a time) reduces API calls. |
| **Nightly incremental sync** | Issues get updated (closed, relabeled, edited) constantly. Without sync, the corpus drifts from reality. The wiki sync job is the direct precedent. | LOW | Wiki sync scheduler pattern, `IssueStore.upsert()` idempotent update | Use `since` parameter on Issues API to fetch only recently updated issues. Store `last_synced_at` in sync state table. Process updates and new issues. Also sync comments via `GET /repos/{owner}/{repo}/issues/comments?since=...`. |
| **High-confidence duplicate detection** | The primary intelligence feature. Users who file a duplicate want to be pointed to the existing issue. Maintainers want duplicates caught before manual triage. Every issue bot in this space (Simili, AI Duplicate Detector, Probot duplicate-issues) offers this. | MEDIUM | `IssueStore.findSimilar()`, embedded corpus, triage agent | Two-phase approach: (1) vector similarity via `findSimilar()` with strict threshold to get candidates, (2) LLM confirmation to reduce false positives. Critical: threshold must be strict enough to avoid false positives -- a wrongly-flagged duplicate erodes trust faster than a missed one. |
| **Duplicate detection comment** | When a likely duplicate is found, post a comment linking to the candidate issue(s). Users expect to see why their issue was flagged and which issue it duplicates. | LOW | `github_issue_comment` MCP tool, duplicate detection results | Comment should include: similarity score (human-readable), link to candidate issue(s), disclaimer that this is automated and may be wrong. Do NOT auto-close -- that is an anti-feature. |
| **Auto-triage on `issues.opened`** | Currently triage requires `@kodiai` mention. Auto-fire on open is the natural next step and is how VS Code, Hono, and most mature triage bots operate. Config-gated (default off). | MEDIUM | Webhook event router, triage agent, `.kodiai.yml` config | Wire `issues.opened` event in event router. Must be idempotent (webhook dedup + per-issue cooldown). Gate behind `triage.autoTriageOnOpen: true` in config. Run triage agent with same logic as mention-triggered path. |
| **Config gate for auto-triage** | Repos must opt in to automatic triage. Default-on would surprise maintainers. Every mature bot (VS Code triage bot, GitHub Agentic Workflows) has explicit configuration. | LOW | `.kodiai.yml` config schema | Add `triage.autoTriageOnOpen: boolean` (default `false`). When `true`, `issues.opened` fires triage. When `false`, only `@kodiai` mention triggers triage. |

## Differentiators

Features that set Kodiai apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Dependencies on Existing | Notes |
|---------|-------------------|------------|--------------------------|-------|
| **PR-issue linking via reference parsing** | Parse PR body/title/commits for `fixes #123`, `closes #456`, `relates to #789` patterns. GitHub does this natively for closing keywords, but Kodiai can (a) detect non-closing references like "relates to", (b) surface these in PR review context, and (c) validate that referenced issues actually exist. | LOW | PR review handler, Octokit Issues API | Regex: `/(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?|relates?\s+to)\s+#(\d+)/gi`. Parse PR body + commit messages. Validate issue numbers exist. Include linked issue context in PR review prompt. |
| **Semantic PR-issue linking** | When a PR has no explicit issue reference, use semantic search to find related issues. Embed the PR title+description, search the issue corpus. Surface likely related issues in the review. | MEDIUM | `IssueStore.searchByEmbedding()`, PR review pipeline, Voyage AI | Only trigger when no explicit references found. Use strict threshold (distance < 0.3) to avoid noise. Present as "possibly related" not "definitely linked". Value: helps maintainers connect PRs to open issues they forgot to reference. |
| **Issue corpus in cross-corpus retrieval** | Wire issue corpus as a source in the existing RRF retrieval fan-out. When reviewing a PR or answering a mention, include relevant issues as context. | MEDIUM | `knowledge/cross-corpus-rrf.ts`, `knowledge/retrieval.ts` | Add issue store to `createRetriever()` options. Add `[issue: #N]` citation format. Weight issues slightly lower than code/review/wiki (0.9x) since issues are less authoritative than code patterns. |
| **Duplicate candidate ranking** | Instead of just showing the top-1 duplicate, show top-3 candidates with similarity scores and status (open/closed). Closed duplicates are still useful -- they tell the user the issue was already resolved. | LOW | `IssueStore.findSimilar()` already returns ranked list | Cap at 3 candidates. Include title, number, state, and human-friendly similarity percentage. Group by open vs closed. |
| **Area classification labels** | Automatically classify issues into area labels (e.g., `area:video`, `area:music`, `area:pvr`) based on issue content. VS Code does this with ML models at 0.75 confidence threshold. | HIGH | Label taxonomy in `.kodiai.yml`, LLM classification, `github_issue_label` MCP tool | Requires per-repo label taxonomy configuration. Use LLM (non-agentic task via AI SDK) to classify. Only apply label when confidence exceeds configurable threshold (default 0.75). VS Code's two-model approach is worth studying but may be overkill for v0.22 MVP. |
| **Backfill progress reporting** | Log and report backfill progress with page counts, embedding counts, rate limit status. The review comment backfill already does this -- issue backfill should match. | LOW | Logger, backfill pipeline | Follow exact logging pattern from `review-comment-backfill.ts`: per-batch logs with commentsInBatch, embeddings generated/failed, totalSoFar, rateRemaining. |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Auto-close duplicate issues** | Even VS Code only auto-closes after 60 days on low-vote items. False-positive closures destroy trust instantly. The AI Duplicate Detector docs explicitly warn about this. User who filed the issue feels dismissed. | Comment with duplicate candidates and let maintainer decide. Apply a `potential-duplicate` label at most. |
| **Auto-assign issues to developers** | Requires deep org knowledge, creates social problems when wrong. VS Code's two-model approach has 75% accuracy -- 25% wrong assignments annoy people. Not aligned with v0.22 goals. | Defer to future milestone. Could use contributor profiles + area labels to suggest, but not assign. |
| **Auto-close for template violations** | Explicitly called out as anti-feature in v0.21 requirements. "Even VS Code only auto-closes after 60 days on low-vote items." Alienates new contributors. | Comment with guidance, apply `needs-info` label, let maintainer decide. |
| **YAML issue form schema support** | xbmc/xbmc uses `.md` templates. Out of scope per v0.21 decision. No target repo currently needs YAML forms. | Continue with `.md` template parser. Add YAML support when a target repo needs it. |
| **Full-text search as primary duplicate signal** | BM25 finds keyword matches but misses semantic duplicates ("player crashes" vs "video playback segfault"). Used alone, it produces too many false positives from common keywords. | Use full-text as a secondary signal alongside vector similarity. RRF merge if using both. |
| **Real-time duplicate detection on every comment** | Scanning for duplicates on every issue comment update is wasteful. Only the initial issue body matters for duplicate detection. | Trigger duplicate detection on `issues.opened` only, not on subsequent edits or comments. |
| **Cross-repo duplicate detection** | Adds massive complexity. Different repos have different contexts. A "video crash" in xbmc/xbmc is not the same as in xbmc/repo-plugins. | Scope all duplicate detection to same repo. |
| **Automated issue prioritization/severity** | Subjective, context-dependent, creates false sense of urgency. Maintainers should prioritize based on their roadmap and domain knowledge. | Surface data (reaction count, comment count, duplicate count) but let humans prioritize. |

## Feature Dependencies

```
Historical issue backfill
  --> Issue embedding on ingest (backfill generates embeddings)
  --> Nightly incremental sync (sync keeps corpus current after backfill)
  --> High-confidence duplicate detection (requires populated corpus)
      --> Duplicate detection comment (requires detection results)
      --> Duplicate candidate ranking (extends detection output)
  --> Issue corpus in cross-corpus retrieval (requires populated corpus)
  --> Semantic PR-issue linking (requires populated corpus)

Auto-triage on issues.opened
  --> Config gate for auto-triage (must be configurable)
  (reuses existing triage agent -- no new dependency)

PR-issue linking via reference parsing
  (standalone -- only needs PR body text parsing)
  --> Semantic PR-issue linking (fallback when no explicit refs)
      (requires populated issue corpus)

Area classification labels
  (requires label taxonomy in config + populated corpus for context)
```

## MVP Recommendation

**Phase 1 -- Corpus Population (must be first):**
1. Historical issue backfill with embeddings
2. Nightly incremental sync
3. Issue corpus wired into cross-corpus retrieval

**Phase 2 -- Detection and Linking (requires corpus):**
4. High-confidence duplicate detection with LLM confirmation
5. Duplicate detection comment with candidate ranking
6. PR-issue linking via reference parsing

**Phase 3 -- Auto-Triage (requires detection):**
7. Auto-triage on `issues.opened` with config gate
8. Semantic PR-issue linking (enhancement to PR reviews)

**Defer to v0.23+:**
- Area classification labels (HIGH complexity, needs label taxonomy design)
- Auto-assign (social complexity, accuracy requirements)

**Rationale:** The dependency chain is strict -- you cannot detect duplicates without a corpus, and you cannot auto-triage effectively without duplicate detection wired in. Backfill first, then detection, then automation.

## Complexity Estimates

| Feature | Complexity | Rationale |
|---------|------------|-----------|
| Historical issue backfill | MEDIUM | Follows review-comment-backfill pattern closely, but needs issue-specific filtering (exclude PRs), comment pagination, and sync state table. ~300-400 lines. |
| Issue embedding on ingest | LOW | Built into backfill pipeline. `title + body` -> Voyage AI -> store. ~50 lines. |
| Nightly incremental sync | LOW | Follows wiki-sync scheduler pattern. `since` parameter on Issues API. ~150 lines. |
| Duplicate detection | MEDIUM | Vector search + LLM confirmation. Threshold tuning is the hard part -- needs empirical testing. ~200-300 lines. |
| Duplicate comment | LOW | Format results, call `github_issue_comment`. ~100 lines. |
| Auto-triage on `issues.opened` | MEDIUM | Webhook routing + idempotency + config gating + existing triage agent. Integration complexity, not algorithmic. ~200 lines. |
| PR-issue linking (reference) | LOW | Regex parsing of PR body + commit messages. ~100 lines. |
| Semantic PR-issue linking | MEDIUM | Embedding PR description, searching issue corpus, filtering by threshold. ~200 lines. |
| Cross-corpus retrieval wiring | MEDIUM | Add issue store to `createRetriever()`, update RRF weights, add `[issue: #N]` citations. Touches multiple files. ~150 lines across files. |

## Threshold Guidance (Duplicate Detection)

Research on cosine similarity thresholds for duplicate detection:

| Threshold (cosine distance) | Behavior | Risk |
|-----------------------------|----------|------|
| < 0.15 | Near-identical text. Very high confidence. | Misses semantic duplicates with different wording. |
| 0.15 - 0.25 | High semantic similarity. Good for "likely duplicate" with LLM confirmation. | Sweet spot for candidate generation. |
| 0.25 - 0.40 | Related but not necessarily duplicate. | Too noisy for duplicate flagging. Good for "related issues" surfacing. |
| > 0.40 | Loosely related or unrelated. | Unusable for duplicate detection. |

**Recommendation:** Use distance < 0.25 as candidate threshold, then LLM confirmation on top-3 candidates. This matches the existing `findSimilar()` default threshold of 0.7 (which is cosine similarity, not distance -- distance = 1 - similarity, so 0.7 similarity = 0.3 distance). Tighten to 0.25 distance for higher precision.

The existing `IssueStore.findSimilar()` uses `threshold: number = 0.7` which represents cosine distance (not similarity). This is too permissive for duplicate detection. Override with `threshold: 0.25` when calling for duplicate candidates.

## Sources

- [Simili Bot - AI-powered semantic duplicate detection](https://github.com/similigh/simili-bot)
- [AI Duplicate Detector - Relations and duplicates detection](https://github.com/mackgorski/ai-duplicate-detector)
- [Probot duplicate-issues](https://github.com/probot/duplicate-issues)
- [Similar Issues AI GitHub App](https://github.com/apps/similar-issues-ai)
- [VS Code Automated Issue Triaging](https://github.com/microsoft/vscode/wiki/Automated-Issue-Triaging)
- [GitHub Agentic Workflows - Issue Triage](https://github.github.io/gh-aw/blog/2026-01-13-meet-the-workflows/)
- [GitHub REST API - Issues endpoints](https://docs.github.com/en/rest/issues/issues)
- [GitHub pagination guide](https://docs.github.com/en/rest/guides/traversing-with-pagination)
- [Linking PRs to issues - GitHub Docs](https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue)
- [Zilliz - Embeddings for duplicate detection](https://zilliz.com/ai-faq/how-do-i-use-embeddings-for-duplicate-detection)
- [Cosine similarity threshold research](https://www.emergentmind.com/topics/cosine-similarity-threshold)
- [AI-powered GitHub app to link issues in PRs](https://dev.to/gitcommitshow/ai-powered-github-app-to-automatically-link-issues-in-a-pr-4idj)
- [Potential Duplicates Bot - Damerau-Levenshtein approach](https://github.com/Bartozzz/potential-duplicates-bot)
