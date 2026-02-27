# Domain Pitfalls

**Domain:** Adding historical issue ingestion, duplicate detection, PR-issue linking, and auto-triage to an existing GitHub App with PostgreSQL + pgvector
**Researched:** 2026-02-26
**Confidence:** MEDIUM-HIGH (patterns verified against existing codebase pipelines from v0.18/v0.19; GitHub API behavior verified via official docs; pgvector threshold behavior verified via official repo)

---

## Critical Pitfalls

Mistakes that cause data corruption, broken detection, noisy spam, or require architectural rework.

---

### Pitfall 1: Embedding the Full Issue Body Produces Weak Similarity Signals

**What goes wrong:**
Embedding the entire issue body (title + body + comments concatenated) into a single vector produces diluted embeddings that fail to distinguish genuinely duplicate issues from merely topically related ones. A bug report about "video stuttering on Raspberry Pi 4" and one about "audio sync on Raspberry Pi 4" end up with high similarity because they share platform context, not because they describe the same bug.

**Why it happens:**
Issue bodies in xbmc/xbmc are long (template-driven with system info, logs, steps to reproduce). The embedding model averages all tokens, so boilerplate sections (Kodi version, OS, logs) dominate the vector while the actual problem description (1-2 sentences) gets drowned out.

**Consequences:**
- False-positive duplicate detection: bot comments "this may be a duplicate of #X" on unrelated issues
- User trust erodes rapidly -- a few bad duplicate suggestions and maintainers disable the feature
- The 0.3 cosine distance threshold (from `findSimilar`) that works for code snippets fails for issues

**Prevention:**
Embed a **synthesized summary** rather than the raw body. Extract title + "Description" or "Bug description" section text only, skip logs/system-info/steps-to-reproduce boilerplate. The existing template parser from v0.21 already identifies sections -- reuse it to extract the problem statement. Alternatively, use an LLM to generate a 1-2 sentence problem summary and embed that.

**Detection:**
- Manual spot-check: run `findSimilar` on 20 known-duplicate pairs and 20 known-unrelated pairs
- If precision < 80% at any threshold, the embedding input needs refinement
- Monitor the distance distribution -- if duplicates and non-duplicates overlap heavily, the signal is too weak

**Which phase should address:** Historical ingestion phase (embedding strategy must be decided before bulk ingestion, as re-embedding 4,900+ issues is expensive)

---

### Pitfall 2: Cosine Distance vs. Cosine Similarity Confusion in Thresholds

**What goes wrong:**
pgvector's `<=>` operator returns **cosine distance** (0 = identical, 2 = opposite), not cosine similarity (1 = identical, 0 = orthogonal). The existing `findSimilar` method uses `<= threshold` with a default of 0.7, which is cosine distance. But developers commonly think in similarity terms and set thresholds accordingly. A "0.85 similarity threshold" translates to a 0.15 distance threshold -- getting this wrong means either flagging everything as a duplicate or flagging nothing.

**Why it happens:**
The distinction between cosine distance and cosine similarity is a known source of confusion (documented in pgvector issue #72 and supabase issue #12244). The existing codebase already uses distance correctly in `findSimilar`, but anyone tuning thresholds needs to understand the inversion.

**Consequences:**
- Threshold too high (distance > 0.5): floods issues with false-positive duplicate warnings
- Threshold too low (distance < 0.05): misses almost all real duplicates
- Silently wrong behavior that looks like "the feature doesn't work" with no errors

**Prevention:**
- Document the threshold as cosine distance explicitly in code comments and config
- Use named constants: `const DUPLICATE_DISTANCE_THRESHOLD = 0.25` with a comment explaining "0.25 distance = 0.75 similarity"
- The threshold MUST be tuned empirically against xbmc/xbmc data, not guessed. Seed a test set of known duplicates from the issue tracker first.
- Add a `triage.duplicateThreshold` config option in `.kodiai.yml` so repos can tune without code changes

**Detection:**
- If duplicate detection reports 0 duplicates across 4,900 issues, threshold is too tight
- If it reports >500 duplicates, threshold is too loose
- Log the actual distance values in detection results for observability

**Which phase should address:** Duplicate detection phase

---

### Pitfall 3: Auto-Triage on `issues.opened` Without Idempotency Creates Comment Spam on Webhook Redelivery

**What goes wrong:**
GitHub redelivers webhooks when it doesn't receive a timely 2xx response (or on manual redeliver). Without idempotency, the auto-triage handler posts duplicate guidance comments and applies labels multiple times. The existing per-issue cooldown (30 min with body-hash reset from v0.21) was designed for `@kodiai` mention-triggered triage, not webhook-triggered auto-triage where redelivery can happen within seconds.

**Why it happens:**
The existing triage path is mention-triggered (user explicitly asks via `@kodiai`). Auto-triage on `issues.opened` fires automatically, and GitHub's webhook delivery guarantees "at least once" not "exactly once." The current cooldown uses body-hash as the reset mechanism, but on redelivery the body hasn't changed, so the cooldown should block it -- BUT the cooldown window starts when the first triage completes, and if the first triage is still in-flight when the redeliver arrives, both proceed.

**Consequences:**
- Two or three identical triage comments on the same issue
- Labels applied (then re-applied, which is a no-op but wastes API calls)
- Maintainers see spam and lose trust in auto-triage

**Prevention:**
Use the `X-GitHub-Delivery` header as a dedup key (already used for review handler dedup in `routes/webhooks.ts`). Additionally, implement a per-issue advisory lock or atomic claim before triage begins:
```sql
INSERT INTO issue_triage_runs (repo, issue_number, delivery_id, started_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (repo, issue_number) WHERE completed_at IS NULL
DO NOTHING
RETURNING id;
```
If the INSERT returns no rows, another triage is in-flight -- skip. The existing pattern from `review-idempotency.ts` (run-state check) is the template to follow.

**Detection:**
- Monitor for multiple triage comments on the same issue within 60 seconds
- Log delivery_id alongside triage actions for correlation

**Which phase should address:** Auto-triage phase (must be solved before wiring `issues.opened` webhook)

---

### Pitfall 4: Historical Ingestion Exhausts GitHub API Rate Limit and Blocks Production Webhooks

**What goes wrong:**
Ingesting 4,900+ issues with their comments requires thousands of API calls. The GitHub REST API allows 5,000 requests/hour for authenticated apps. If the backfill runs without throttling, it consumes the entire rate limit budget, causing production webhook handlers (PR reviews, mentions) to fail with 403 rate limit errors.

**Why it happens:**
The existing review-comment backfill (v0.18) already handles this with `adaptiveRateDelay`, but the issue backfill is a different scale. Issues require: (1) paginated list of all issues, (2) per-issue comment fetch for issues with comments, (3) timeline events for PR cross-references. At 100 issues/page, that's ~50 pages for issues alone, plus potentially thousands of comment-fetch calls.

**Consequences:**
- Production PR reviews fail or timeout during backfill window
- Rate limit errors cascade: webhook handler fails, GitHub retries, retry also fails
- Backfill itself fails partway through with no resume capability

**Prevention:**
- Copy the `adaptiveRateDelay` pattern from `review-comment-backfill.ts` -- it already works well
- Reserve at least 50% of rate limit budget for production traffic: stop backfill when `x-ratelimit-remaining / x-ratelimit-limit < 0.5`
- Implement cursor-based resume (sync state table) exactly like the review comment backfill does
- Run initial backfill during low-traffic hours or as a separate script (not in the main server process)
- Batch comment fetching: only fetch comments for issues where `comment_count > 0`
- Consider using the GraphQL API for initial bulk fetch (500 nodes per query vs 100 per REST page)

**Detection:**
- Monitor `x-ratelimit-remaining` in backfill logs (already done in review backfill pattern)
- Alert if remaining drops below 1000 during production hours

**Which phase should address:** Historical ingestion phase (first phase, foundational)

---

### Pitfall 5: PR-Issue Linking via Body Text Regex Misses Implicit References and Creates False Positives

**What goes wrong:**
Scanning PR bodies for `#123`, `fixes #123`, `closes #123` patterns seems straightforward but has multiple failure modes. PRs that mention issue numbers in context ("similar to the approach in #123") get linked as fixes. PRs in forks reference different issue numbers. Long-running repos like xbmc/xbmc have issue numbers that collide with PR numbers (both share the same number space).

**Why it happens:**
GitHub's own issue-reference parser is sophisticated (it handles keyword-close references, cross-repo references, commit message references). Reimplementing it via regex is error-prone. The REST API's timeline events endpoint provides the actual cross-references that GitHub has already parsed.

**Consequences:**
- False links: "PR #5000 fixes issue #123" when #123 is actually a PR, not an issue
- Missed links: PR references issue in commit message but not in body
- Over-linking: every PR that mentions any number gets linked

**Prevention:**
Use GitHub's Timeline Events API (`GET /repos/{owner}/{repo}/issues/{issue_number}/timeline`) to discover cross-references rather than parsing text. The `cross-referenced` event type includes the source PR. For semantic linking (finding PRs that address an issue without explicit references), embed the issue summary and search against PR title+description embeddings -- but treat this as a LOW confidence signal and never auto-link, only suggest.

For text-based reference extraction as a fallback:
- Only match keyword-close patterns: `(fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved) #\d+`
- Verify the referenced number is actually an issue (not a PR) via `is_pull_request` field
- Require the reference to be in the PR body or title, not just any comment

**Detection:**
- Sample 50 linked pairs and manually verify accuracy
- Track link source (timeline API vs text match vs semantic) for quality comparison

**Which phase should address:** PR-issue linking phase

---

## Moderate Pitfalls

---

### Pitfall 6: Nightly Sync Job Overlaps With In-Flight Webhooks, Creating Stale-Read Races

**What goes wrong:**
The nightly incremental sync fetches issues updated since the last sync. Meanwhile, webhooks for `issues.opened`, `issues.edited`, and `issue_comment.created` also update the same rows. If the sync job reads an issue from the API, then a webhook updates it in the database, then the sync job writes its (now-stale) version, the webhook's changes are lost.

**Prevention:**
Use `github_updated_at` as a write guard. The sync job should use:
```sql
UPDATE issues SET ... WHERE repo = $1 AND issue_number = $2
  AND (github_updated_at IS NULL OR github_updated_at < $3)
```
This ensures the sync never overwrites a more recent version. The existing `upsert` method in `issue-store.ts` uses `ON CONFLICT DO UPDATE` without a timestamp guard -- this needs to be fixed.

Alternatively, since webhooks provide real-time updates, the nightly sync only needs to catch issues that were missed (webhook delivery failures, server downtime). Design the sync as a gap-filler, not a full refresh.

**Detection:**
- Compare `github_updated_at` in DB vs GitHub API for a sample of recently-edited issues
- Log when sync overwrites a row that was updated more recently by a webhook

**Which phase should address:** Nightly sync phase

---

### Pitfall 7: Embedding Provider Rate Limits During Bulk Ingestion

**What goes wrong:**
Voyage AI (the configured embedding provider) has its own rate limits separate from GitHub's. Bulk-embedding 4,900 issue titles/bodies plus thousands of comments can hit Voyage's rate limit, causing embedding failures. The existing pattern is fail-open (store without embedding), but issues stored without embeddings are invisible to duplicate detection and semantic search.

**Prevention:**
- Batch embedding requests (Voyage supports batch endpoints)
- Add backoff/retry on 429 responses from Voyage, separate from GitHub rate limiting
- Track embedding success rate during backfill; if it drops below 90%, pause and retry
- After backfill, run a sweep to fill NULL embeddings (similar to `backfill-language.ts` pattern)
- Budget: 4,900 issues + ~15,000 comments = ~20,000 embedding calls; at Voyage's typical limits this may take hours

**Detection:**
- `SELECT COUNT(*) FROM issues WHERE embedding IS NULL AND repo = 'xbmc/xbmc'` should approach 0 after backfill
- Log embedding failure rate per batch

**Which phase should address:** Historical ingestion phase

---

### Pitfall 8: Auto-Triage Fires on Issues Created by Bots, Creating Noise Loops

**What goes wrong:**
Dependabot, Renovate, stale-bot, and other GitHub bots create issues. Auto-triage on `issues.opened` fires on these, posting guidance comments on bot-generated issues that no human will read. Worse, if the triage comment triggers the bot to respond, you get a feedback loop.

**Prevention:**
- Filter by `sender.type` in the webhook payload: skip if `type === "Bot"`
- Also filter by known bot logins (reuse `DEFAULT_BOT_LOGINS` set from `review-comment-backfill.ts`)
- Add a config option `triage.ignoreBotIssues: true` (default true) in `.kodiai.yml`
- The existing `BotFilter` interface in `webhook/types.ts` already provides `shouldProcess()` -- wire it into the auto-triage path

**Detection:**
- Monitor for triage comments on issues authored by `[bot]` suffix users
- Alert on triage-to-triage comment chains (kodiai commenting on its own triage output)

**Which phase should address:** Auto-triage phase

---

### Pitfall 9: Duplicate Detection on Closed Issues Overwhelms New Issue Comments

**What goes wrong:**
Most of xbmc/xbmc's ~4,900 issues are closed. When a new issue is opened, duplicate detection searches the entire corpus and returns closed issues from years ago as "duplicates." While technically similar, these old closed issues are often resolved, no longer relevant, or about deprecated features. Flooding the new issue with "this might be a duplicate of #1234 (closed 2019)" is unhelpful.

**Prevention:**
- Weight open issues higher than closed issues in duplicate ranking (2x boost for open, 0.5x for closed-and-old)
- Apply a recency decay: issues closed more than 12 months ago get a penalty
- Cap the number of reported duplicates (max 3) and require minimum confidence
- Provide context in the duplicate comment: include the state (open/closed), closing date, and label set of the candidate
- Allow `triage.duplicateStates: ["open"]` config to restrict detection to open issues only

**Detection:**
- Track what percentage of reported duplicates are closed issues
- If >80% of suggestions point to closed issues, the feature is generating noise

**Which phase should address:** Duplicate detection phase

---

### Pitfall 10: Issue-Number vs. PR-Number Ambiguity in the Shared Number Space

**What goes wrong:**
GitHub issues and PRs share a single incrementing number space. The `issues` table has an `is_pull_request` boolean, but if the backfill ingests data from the Issues API (`GET /repos/{owner}/{repo}/issues`), it returns BOTH issues and PRs mixed together. Storing PRs in the issue corpus pollutes duplicate detection (a PR is not a duplicate of an issue on the same topic).

**Why it happens:**
GitHub's List Issues REST endpoint returns PRs as well (they have a `pull_request` key in the response). The existing `IssueInput` type has `isPullRequest: boolean` which suggests this was anticipated, but the backfill must actually filter on it.

**Prevention:**
- During backfill: skip items where `response.pull_request` is present (these are PRs)
- In `findSimilar`: add `AND is_pull_request = false` to the WHERE clause
- In search queries: default to `is_pull_request = false` unless explicitly searching PRs
- During webhook processing for `issues.opened`: the event payload distinguishes issues from PRs, so this is only a backfill concern

**Detection:**
- `SELECT COUNT(*) FROM issues WHERE is_pull_request = true AND repo = 'xbmc/xbmc'` -- should be 0 if filtering correctly
- If duplicate detection suggests PRs as duplicates of issues, filtering is broken

**Which phase should address:** Historical ingestion phase

---

### Pitfall 11: Nightly Sync "Since" Parameter Misalignment Creates Gaps or Duplicate Processing

**What goes wrong:**
The nightly sync uses a `since` timestamp to fetch issues updated after the last sync. If the sync state records `lastSyncedAt` as the time the sync completed (rather than the latest `updated_at` from the fetched data), there's a gap: issues updated between the start and end of the previous sync run are missed.

**Why it happens:**
This exact bug existed in early versions of the wiki sync until it was fixed. The review comment backfill correctly uses `lastCommentDate` (the actual data timestamp) rather than `Date.now()`. The issue sync must follow the same pattern.

**Prevention:**
- Set `lastSyncedAt` to the maximum `github_updated_at` value from the fetched batch, not `new Date()`
- Use the `since` parameter on the GitHub Issues API: `GET /repos/{owner}/{repo}/issues?since=2024-01-01T00:00:00Z&sort=updated&direction=asc`
- Overlap by 5 minutes (subtract 5 min from lastSyncedAt before using as `since`) to account for clock skew
- The existing `updateSyncState` pattern from review comment store is the correct template

**Detection:**
- Compare issue count in DB vs GitHub API count periodically
- Issues that were edited during a sync window but not in the DB indicate a gap

**Which phase should address:** Nightly sync phase

---

## Minor Pitfalls

---

### Pitfall 12: Large Issue Bodies Exceed Embedding Model Token Limits

**What goes wrong:**
Some xbmc/xbmc issues include full log dumps, crash stacktraces, or paste-all-config outputs that run thousands of tokens. Voyage Code 3's context window is 16K tokens, but embeddings degrade in quality for very long inputs. Sending a 10K-token issue body produces a poor embedding.

**Prevention:**
- Truncate embedding input to the first 1024 tokens of meaningful content (title + description section)
- Strip code blocks and log sections before embedding (they add noise)
- The existing `chunkReviewThread` pattern (1024-token sliding window) could be adapted, but for issues a single embedding per issue is cleaner than multiple chunks

**Which phase should address:** Historical ingestion phase

---

### Pitfall 13: Config Gate for Auto-Triage Missing Leaves It Firing on All Repos

**What goes wrong:**
Auto-triage on `issues.opened` fires on every repo that has the Kodiai app installed, not just repos that opted in. If a repo hasn't configured `.kodiai.yml` with `triage.enabled: true`, auto-triage should not fire. The existing mention-triggered triage has this gate, but the new webhook handler might bypass it.

**Prevention:**
- Load `.kodiai.yml` config before processing any auto-triage webhook
- Default `triage.autoTriageOnOpen` to `false` -- repos must explicitly opt in
- Separate config flags: `triage.enabled` (mention-triggered) vs `triage.autoTriageOnOpen` (webhook-triggered)
- The existing config loading pattern in review/mention handlers is the template

**Which phase should address:** Auto-triage phase

---

### Pitfall 14: Timeline Events API Rate Cost for PR-Issue Linking at Scale

**What goes wrong:**
Using the Timeline Events API to discover PR-issue cross-references requires one API call per issue. For 4,900 issues, that's 4,900 additional API calls just for linking -- nearly the entire hourly rate limit budget.

**Prevention:**
- Only fetch timeline events for issues that have `comment_count > 0` or are `state: closed` (closed issues are more likely to have linked PRs)
- Cache timeline results; they rarely change for closed issues
- Consider a two-pass approach: (1) text-match `fixes #N` patterns in PR bodies during PR corpus traversal (already have PR data from review comments), (2) use timeline API only for issues that had no text-match links
- Run PR-issue linking as a background job, not blocking the main backfill

**Which phase should address:** PR-issue linking phase

---

### Pitfall 15: Retrieval Integration Creates N+1 Query Pattern

**What goes wrong:**
When the issue corpus is wired into `createRetriever()` as the 5th corpus alongside code, review comments, wiki, and code snippets, the fan-out pattern adds another parallel query per retrieval call. If the issue search query is slow (HNSW scan on 4,900 rows + full-text search), it drags down the overall retrieval latency for PR reviews and mentions.

**Prevention:**
- Ensure HNSW index `ef_search` is tuned appropriately (default 40 is fine for 4,900 rows)
- Add the issue corpus search behind a feature flag initially
- Measure p95 latency of issue search independently before wiring into the unified pipeline
- The existing `Promise.allSettled` fan-out in `retrieval.ts` means a slow corpus doesn't block others, but it does increase total wait time

**Which phase should address:** Late phase when wiring issues into cross-corpus retrieval

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Historical ingestion | Rate limit exhaustion (Pitfall 4), weak embeddings (Pitfall 1), PR/issue confusion (Pitfall 10) | Adaptive rate delay, extract problem summary for embedding, filter `is_pull_request` |
| Duplicate detection | Distance/similarity confusion (Pitfall 2), closed-issue noise (Pitfall 9) | Named constants with comments, recency weighting, state filtering |
| PR-issue linking | False regex matches (Pitfall 5), timeline API cost (Pitfall 14) | Use Timeline API for ground truth, text-match as supplement, batch over time |
| Auto-triage webhook | Duplicate comments on redelivery (Pitfall 3), bot issues (Pitfall 8), missing config gate (Pitfall 13) | Delivery-ID dedup + advisory lock, bot filter, default-off config |
| Nightly sync | Stale-read race (Pitfall 6), since-parameter gap (Pitfall 11) | Timestamp write guard, use data timestamps not wall clock |
| Retrieval integration | N+1 latency (Pitfall 15) | Feature flag, independent latency measurement, HNSW tuning |

---

## Integration Pitfalls (Specific to Adding to Existing System)

These pitfalls are specific to adding v0.22 features on top of the existing Kodiai codebase.

### INT-1: Issue Store Upsert Lacks Timestamp Guard

The current `issue-store.ts` `upsert()` method uses `ON CONFLICT DO UPDATE SET` without checking whether the incoming data is newer than what's already stored. This is safe for one-writer scenarios but breaks when webhooks and nightly sync both write to the same rows. The review comment store uses `ON CONFLICT DO NOTHING` (append-only) which sidesteps this, but the issue store uses `DO UPDATE` which is vulnerable. Add a `WHERE github_updated_at < EXCLUDED.github_updated_at` guard to the ON CONFLICT clause.

### INT-2: Event Router Has No `issues.opened` Registration Yet

The event router currently handles `pull_request.*`, `issue_comment.created`, `pull_request_review_comment.*`, `pull_request_review.submitted`, and `check_suite.completed`. There is no handler for `issues.opened`, `issues.edited`, or `issues.closed`. Adding these registrations is straightforward but must be done carefully to avoid conflicting with the existing `issue_comment.created` handler (which currently routes to the mention handler, not to an issue-sync handler).

### INT-3: Existing Cooldown Mechanism Needs Extension for Auto-Triage

The v0.21 per-issue cooldown (30 min, body-hash reset) lives somewhere in the triage pipeline. For auto-triage, this needs to be extended with: (1) delivery-ID dedup (webhook layer), (2) in-flight claim (database layer), (3) cooldown (application layer). All three are needed because they protect against different failure modes.

### INT-4: IssueStore Missing Sync State Table

The review comment store has `review_comment_sync_state` for cursor-based resume. The wiki store has its own sync state. The issue store needs an equivalent `issue_sync_state` table with `repo`, `last_synced_at`, `last_page_cursor`, `total_issues_synced`, `backfill_complete`. The schema for this should mirror the review comment sync state pattern exactly.

### INT-5: Cross-Corpus Retrieval Wiring Requires Careful Dedup Tuning

When adding issue results to the unified retrieval pipeline, issues about the same topic as wiki pages or code will create near-duplicate results across corpora. The existing `deduplicateChunks` with cosine threshold 0.90 handles this for the current four corpora, but issue text is structured differently (conversational vs. documentation vs. code). The dedup threshold may need per-corpus-pair tuning. Test with real queries before shipping.

---

## Sources

- [pgvector cosine distance vs similarity -- GitHub issue #72](https://github.com/pgvector/pgvector/issues/72)
- [pgvector distance operator confusion -- Supabase issue #12244](https://github.com/supabase/supabase/issues/12244)
- [GitHub REST API rate limits documentation](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [GitHub Timeline Events API](https://docs.github.com/en/rest/issues/timeline)
- [GitHub community discussion on issue-PR cross-references](https://github.com/orgs/community/discussions/24492)
- [GitHub webhook redelivery handling](https://github.com/orgs/community/discussions/151676)
- Existing codebase: `src/knowledge/review-comment-backfill.ts` (rate limiting, resume, thread grouping patterns)
- Existing codebase: `src/knowledge/issue-store.ts` (upsert, findSimilar, search interfaces)
- Existing codebase: `src/knowledge/wiki-sync.ts` (scheduled sync, dedup, gap detection patterns)
- Existing codebase: `src/triage/triage-agent.ts` (template parsing, guidance generation)
- Existing codebase: `src/handlers/review-idempotency.ts` (idempotency patterns)
