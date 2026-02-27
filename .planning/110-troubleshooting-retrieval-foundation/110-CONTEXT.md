# Phase 110: Troubleshooting Retrieval Foundation — Context

**Phase goal:** The system can retrieve similar resolved issues and assemble resolution-focused thread context for troubleshooting synthesis.

**Requirements:** TSHOOT-01, TSHOOT-02, TSHOOT-03

---

## Thread Assembly Priority

**Comment selection strategy: Tail-first, then semantic.**
- Always include the last N comments before closure (where the fix/answer typically lives)
- Fill remaining budget with comments semantically similar to the queried issue
- This means tail comments are guaranteed; semantic selection only used for earlier comments

**Character budget: Adaptive based on match count.**
- Fixed total ceiling with per-issue budget varying by how many matches exist
- Fewer matches = larger budget per issue (e.g., 8K for 1 match, 3K each for 3+ matches)
- Researcher should determine exact ceiling and scaling formula

**Issue body handling: Summarize long bodies.**
- Always include the resolved issue's body in assembled context
- Bodies over ~500 chars: truncate to first paragraph + last paragraph
- Short bodies included in full

**Budget distribution across matches: Weighted by similarity.**
- Higher-scoring resolved issues get proportionally more of the total budget
- E.g., top match might get 50% of budget, second 30%, third 20%
- Researcher should determine exact weighting formula

---

## Similarity Threshold & Ranking

**Candidate retrieval: Top 10.**
- Retrieve 10 candidates from vector search before applying threshold filter
- Wide enough net for good recall, threshold handles precision

**Similarity floor: Configurable per-repo.**
- Default: 0.65 cosine similarity
- Config key: `triage.troubleshooting.similarityThreshold`
- Repos can tune up (stricter) or down (more lenient) based on their corpus

**Max results after filtering: Configurable, default 3.**
- Config key: `triage.troubleshooting.maxResults`
- 3 resolved issues is the default — enough for focused guidance without overwhelming

**Search mode: Hybrid (vector + full-text, deduplicated).**
- Run both vector search and full-text search in parallel
- Merge results, deduplicate by issue number
- Catches exact keyword matches (error messages, component names) that embeddings might miss
- Both searches apply the same state filter

---

## Fallback Behavior Chain

**Wiki query strategy: Both original + extracted.**
- When no resolved issues pass the threshold, run wiki search with:
  1. Original query (issue title + body terms)
  2. Extracted keywords (error messages, component names, symptoms)
- Merge wiki results from both approaches

**Wiki result count: Top 2 pages.**
- Wiki is a fallback, not primary — keep it tight
- 2 pages provides enough context without bloating the response

**No-match behavior: Silent.**
- If both resolved issues AND wiki return nothing useful, do NOT comment on the issue
- No noise — only speak when there's something actionable to say
- The troubleshooting handler should return early with no side effects

**Source attribution: Blended but cited.**
- When both resolved issues and wiki results exist, mix information naturally
- Cite each piece inline: `[Issue #X]` or `[Wiki: Page Name]`
- Don't use separate sections — present a coherent narrative with provenance

---

## State Filtering Scope

**Resolved definition: Closed (any reason).**
- Filter: `state = 'closed'`
- Includes closed-as-completed AND closed-as-not-planned
- Simple, inclusive filter — the thread assembly handles relevance

**Pull requests: Include merged PRs only.**
- Merged PRs contain fix descriptions highly relevant to troubleshooting
- Closed-unmerged PRs are noise — exclude them
- Filter: exclude rows where `is_pull_request = true` unless merged (requires checking merge state or a merged flag)
- Note: current `issues` table has `is_pull_request` boolean but may not track merge status — researcher should verify schema

**Locked issues: Include normally.**
- Locked issues often contain valuable resolved discussions
- No special treatment needed

**Filter implementation: SQL for state, post-filter for edge cases.**
- Apply `state = 'closed'` in the SQL WHERE clause (efficient, reduces DB work)
- Post-filter in application code for PR merge status checks (flexible, avoids complex SQL)
- This hybrid approach keeps the pgvector query clean while handling edge cases

---

## Deferred Ideas

_(None raised during discussion)_

---

*Created: 2026-02-27 via discuss-phase workflow*
