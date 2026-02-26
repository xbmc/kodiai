# Phase 98: Contributor Profiles & Identity Linking - Research

**Researched:** 2026-02-25
**Domain:** Identity management, expertise scoring, adaptive prompt engineering
**Confidence:** HIGH

## Summary

Phase 98 adds contributor profiles that link GitHub and Slack identities, infer expertise from activity signals, auto-compute author tiers from those scores, and adapt review prompts based on the contributor's expertise in the specific area under review. The existing codebase already has a simple `author-classifier.ts` (3 static tiers from `authorAssociation` + PR count) and an `author_cache` table -- this phase replaces that with a richer, data-driven system.

The core technical challenges are: (1) a new `contributor_profiles` table + `contributor_expertise` table with proper schema, (2) a Slack slash command endpoint (new route, since Kodiai currently only handles Events API), (3) GitHub API calls for commit/PR history to seed expertise, (4) a scoring/decay engine, and (5) wiring the new profile data into the existing `buildAuthorExperienceSection()` prompt builder. No new external libraries are needed -- this is pure postgres.js + Octokit + Slack Web API work within the existing stack.

**Primary recommendation:** Build incrementally: schema + store first, then slash commands, then expertise scorer, then prompt adaptation. The existing `classifyAuthor()` function becomes a fallback for contributors without profiles.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Linking initiated via Slack slash command: `/kodiai link <github-username>`
- Trust-based verification -- accept the claim at face value (internal teams, low abuse risk)
- Kodiai proactively suggests links via Slack DM when it detects likely matches (e.g., same display name on GitHub and Slack)
- Unlinking via `/kodiai unlink` removes the cross-platform link but keeps expertise data intact
- No GitHub-side linking command -- Slack is the single entry point
- Expertise scored on two dimensions: programming language AND codebase file area (e.g., "TypeScript: 0.8, src/api/: 0.9")
- Four signals feed into scores: commit history, PR review activity, PR authorship, recency weighting
- Author tiers auto-computed from expertise scores (percentile-based: top 20% = senior, bottom 20% = newcomer)
- High-expertise contributors get: no basic explanations, higher confidence threshold, terser tone, architecture/design focus
- Newcomers get: explanations of WHY, links to docs, friendlier tone, learning-oriented framing
- Adaptation is invisible -- no indicators or badges
- Cross-area behavior uses overall tier
- Profiles are opt-out (built automatically)
- Opt-out via `/kodiai profile opt-out`; soft freeze (stop collecting, keep existing)
- Contributors can view their own profile via `/kodiai profile`

### Claude's Discretion
- Expertise score refresh strategy (incremental on PR events vs periodic batch vs hybrid)
- Exact tier thresholds and number of tiers
- Score decay curve and time constants
- Heuristic matching algorithm for identity suggestions
- Exact prompt engineering for adapted review tones

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROF-01 | Contributor profile table stores GitHub username, Slack user ID, display name, expertise topics, and author tier | New `contributor_profiles` table + `contributor_expertise` table via migration 011; store module with CRUD operations |
| PROF-02 | GitHub/Slack identity linking via explicit Slack command with optional heuristic suggestions (never auto-linked) | New Slack slash command route + handler; heuristic name-matching for DM suggestions; `conversations.open` + `chat.postMessage` for DMs |
| PROF-03 | Expertise inference derives per-topic scores from commit history, review comment topics, and language usage | Expertise scorer module using Octokit `listCommits` + `listPullRequests` + review_comments table; two-dimensional scoring (language + file area) |
| PROF-04 | Adaptive review depth: lighter review for high-expertise contributors in their expertise areas, more explanation for newcomers | Enhanced `buildAuthorExperienceSection()` with 4+ tiers and area-aware prompts; confidence threshold adjustment in prompt |
| PROF-05 | Privacy opt-out flag per contributor; no profile built without consent mechanism | `opted_out` boolean column on profile; slash command handler for opt-out; fallback to generic review for opted-out contributors |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| postgres (postgres.js) | existing | Profile + expertise tables | Already used for all persistent data |
| @octokit/rest | existing | GitHub API for commit/PR history | Already used throughout handlers |
| hono | existing | New slash command route | Already the HTTP framework |
| zod | existing | Input validation for slash commands | Already used in config.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | existing | Logging | All store and handler operations |
| Slack Web API (fetch) | existing | DM for identity suggestions | SlackClient already wraps chat.postMessage |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw postgres.js SQL | Drizzle/Kysely ORM | Project decision: postgres.js tagged-template SQL is the standard (see PROJECT.md) |
| Slack SDK (@slack/bolt) | Raw fetch to Slack API | Project already uses raw fetch in slack/client.ts -- consistent, zero new deps |
| External identity service | In-app linking | Overkill for single-workspace, trust-based internal team |

**Installation:**
```bash
# No new dependencies required -- all within existing stack
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── contributor/              # NEW module
│   ├── profile-store.ts      # CRUD for contributor_profiles + contributor_expertise
│   ├── profile-store.test.ts
│   ├── expertise-scorer.ts   # Score calculation from activity signals
│   ├── expertise-scorer.test.ts
│   ├── tier-calculator.ts    # Percentile-based tier assignment
│   ├── tier-calculator.test.ts
│   ├── identity-matcher.ts   # Heuristic GitHub/Slack name matching
│   ├── identity-matcher.test.ts
│   └── types.ts              # Shared types
├── slack/
│   ├── slash-command-handler.ts      # NEW: /kodiai link|unlink|profile commands
│   ├── slash-command-handler.test.ts
│   └── client.ts             # EXTENDED: add postDirectMessage(), postEphemeralMessage()
├── routes/
│   └── slack-commands.ts     # NEW: Hono route for slash command webhook
├── db/migrations/
│   ├── 011-contributor-profiles.sql
│   └── 011-contributor-profiles.down.sql
├── execution/
│   └── review-prompt.ts      # MODIFIED: enhanced buildAuthorExperienceSection()
├── lib/
│   └── author-classifier.ts  # MODIFIED: add fallback delegation to profile store
└── handlers/
    └── review.ts             # MODIFIED: inject profile lookup into author tier resolution
```

### Pattern 1: Contributor Profile Store (postgres.js tagged-template)
**What:** CRUD store for contributor profiles and expertise, following existing createKnowledgeStore pattern
**When to use:** All profile reads/writes
**Example:**
```typescript
// Follows existing store pattern from src/knowledge/store.ts
export function createContributorProfileStore(opts: {
  sql: Sql;
  logger: Logger;
}): ContributorProfileStore {
  const { sql, logger } = opts;

  return {
    async getByGithubUsername(username: string) {
      const [row] = await sql`
        SELECT * FROM contributor_profiles
        WHERE github_username = ${username}
        AND opted_out = false
      `;
      return row ?? null;
    },

    async getBySlackUserId(slackUserId: string) {
      const [row] = await sql`
        SELECT * FROM contributor_profiles
        WHERE slack_user_id = ${slackUserId}
      `;
      return row ?? null;
    },

    async linkIdentity(params: { slackUserId: string; githubUsername: string; displayName: string }) {
      await sql`
        INSERT INTO contributor_profiles (slack_user_id, github_username, display_name)
        VALUES (${params.slackUserId}, ${params.githubUsername}, ${params.displayName})
        ON CONFLICT (github_username) DO UPDATE SET
          slack_user_id = ${params.slackUserId},
          display_name = ${params.displayName},
          updated_at = now()
      `;
    },

    async getExpertise(profileId: number) {
      return sql`
        SELECT dimension, topic, score, last_updated
        FROM contributor_expertise
        WHERE profile_id = ${profileId}
        ORDER BY score DESC
      `;
    },
  };
}
```

### Pattern 2: Slack Slash Command Route
**What:** New Hono route that receives Slack slash command payloads (application/x-www-form-urlencoded)
**When to use:** All `/kodiai` slash commands
**Example:**
```typescript
// Slack slash commands POST form-encoded data, not JSON
// Request verification uses same HMAC as events API
app.post("/command", async (c) => {
  const body = await c.req.text();
  // Verify signature (same as events API)
  const verification = verifySlackRequest({ ... });
  if (!verification.valid) return c.text("", 401);

  const params = new URLSearchParams(body);
  const command = params.get("command");     // "/kodiai"
  const text = params.get("text");           // "link octocat"
  const userId = params.get("user_id");      // Slack user ID
  const responseUrl = params.get("response_url"); // For async responses

  // Parse subcommand and dispatch
  const result = await handleSlashCommand({ command: text, slackUserId: userId });

  // Respond immediately (< 3 seconds) or use response_url for async
  return c.json({ response_type: "ephemeral", text: result.message });
});
```

### Pattern 3: Expertise Score Calculation
**What:** Score computation from GitHub activity signals with recency decay
**When to use:** After identity linking and on PR events (incremental refresh)
**Example:**
```typescript
// Exponential decay: score = rawWeight * e^(-lambda * daysSinceActivity)
const DECAY_LAMBDA = 0.005; // ~138 day half-life
const decayFactor = Math.exp(-DECAY_LAMBDA * daysSinceLastActivity);

// Two-dimensional scoring
type ExpertiseEntry = {
  dimension: "language" | "file_area";
  topic: string;      // e.g., "TypeScript" or "src/api/"
  score: number;      // 0.0 - 1.0 normalized
  rawSignals: number; // commit count + PR count + review count
  lastUpdated: Date;
};
```

### Pattern 4: Incremental Score Refresh on PR Events
**What:** Update expertise incrementally when PRs are reviewed/merged rather than full batch recalculation
**When to use:** After PR review completes (fire-and-forget, following code-snippet embed pattern)
**Example:**
```typescript
// In review handler, after review completes (following fire-and-forget pattern from code-snippet embedding)
updateContributorExpertise({
  githubUsername: prAuthor,
  filesChanged: diff.changedFiles,
  languages: diff.detectedLanguages,
  type: "pr_authored",
}).catch((err) => logger.warn({ err }, "Contributor expertise update failed (non-blocking)"));
```

### Anti-Patterns to Avoid
- **Blocking review on profile lookup:** Profile/expertise lookups MUST be fail-open (try/catch returning null fallback), consistent with project's fail-open philosophy
- **Re-embedding expertise as vectors:** Expertise is structured numeric data -- use SQL queries, not vector similarity
- **Coupling slash commands to events API route:** Slash commands are a separate Slack webhook endpoint with different payload format (form-encoded, not JSON)
- **Storing raw activity data:** Store computed scores, not raw commit lists -- keep table size bounded
- **Synchronous expertise recalculation:** Never block PR review on a full expertise refresh -- incremental updates only

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Slack request verification | Custom HMAC | Existing `verifySlackRequest()` in `src/slack/verify.ts` | Already handles HMAC + timestamp validation |
| GitHub API rate limiting | Custom throttle | Existing rate-limit-aware patterns in review handler | Consistent with `executeSearchWithRateLimitRetry` pattern |
| Author tier classification | New from scratch | Extend existing `classifyAuthor()` as fallback | Keep backward compatibility for contributors without profiles |
| Percentile calculation | Hand-rolled stats | Simple SQL `PERCENT_RANK()` window function | PostgreSQL has built-in percentile functions |
| Form-encoded parsing | Custom parser | `URLSearchParams` (built-in) | Standard Web API, no deps |

**Key insight:** The existing `author_cache` table and `classifyAuthor()` function serve as the perfect fallback for contributors who haven't been profiled yet. The new system layers on top rather than replacing.

## Common Pitfalls

### Pitfall 1: Slack Slash Command 3-Second Timeout
**What goes wrong:** Slack requires a response within 3 seconds or shows an error to the user. Expertise seeding (fetching GitHub commit/PR history) takes much longer.
**Why it happens:** Slash commands expect synchronous responses, unlike the Events API which tolerates async processing.
**How to avoid:** Respond immediately with "Linking in progress..." then use the `response_url` from the payload to send the final result asynchronously (up to 30 minutes). This is the official Slack pattern.
**Warning signs:** Users see "This command didn't work" in Slack.

### Pitfall 2: Slash Command Payload Format
**What goes wrong:** Expecting JSON body like Events API, but slash commands send `application/x-www-form-urlencoded`.
**Why it happens:** Events API and slash commands have different payload formats.
**How to avoid:** Parse with `URLSearchParams(body)` not `JSON.parse(body)`. Verification still uses raw body string.
**Warning signs:** All slash commands return 400 or crash on parse.

### Pitfall 3: GitHub Search API Rate Limits During Expertise Seeding
**What goes wrong:** Initial expertise calculation requires many GitHub API calls (commits, PRs, reviews). Hitting secondary rate limits.
**Why it happens:** GitHub Search API has a 30 requests/minute secondary rate limit. Seeding for a new contributor could require multiple paginated requests.
**How to avoid:** Use `GET /repos/{owner}/{repo}/commits?author=X` (REST API, not search) which has higher limits. Paginate with reasonable per_page (100). Add delays between pages. Seed asynchronously after linking.
**Warning signs:** 403 responses with `retry-after` header.

### Pitfall 4: Stale Percentile Tiers
**What goes wrong:** Tiers computed from percentiles of all contributors. As new contributors join, percentile boundaries shift but existing contributors' tiers aren't updated.
**Why it happens:** Percentile-based tiers are relative, not absolute.
**How to avoid:** Recompute tiers periodically (e.g., weekly batch) or lazily on profile access if stale. Store both raw score and current tier, so tier can be refreshed without re-scoring.
**Warning signs:** Senior contributor suddenly classified as regular because many new high-activity contributors shifted the curve.

### Pitfall 5: Missing Slack Bot Scopes for DMs
**What goes wrong:** Kodiai currently has `chat:write` and `reactions:write` scopes. Sending DMs requires `conversations.open` which needs `im:write` scope, and slash commands need the `commands` scope.
**Why it happens:** Current Slack integration is channel-only by design (v1 constraint).
**How to avoid:** Add required OAuth scopes to Slack app manifest: `im:write` (for proactive DM suggestions), `commands` (for slash commands). May also need `users:read` for heuristic matching (display names).
**Warning signs:** Slack API returns `missing_scope` error.

### Pitfall 6: Identity Collision on Unlink/Relink
**What goes wrong:** Contributor unlinks then a different Slack user links the same GitHub username. Expertise data from the original user is now associated with a different Slack user.
**Why it happens:** CONTEXT.md says unlink "keeps expertise data intact" -- but that data is tied to the GitHub username, not the Slack identity.
**How to avoid:** Expertise is correctly tied to GitHub username (not Slack user ID). The profile table uses GitHub username as the primary identity anchor. Slack user ID is just a link. On unlink, only null the slack_user_id; on re-link, the new Slack user inherits the same GitHub-anchored expertise. This is correct behavior since expertise comes from GitHub activity.
**Warning signs:** None if designed correctly.

## Code Examples

### Migration 011: contributor_profiles + contributor_expertise
```sql
-- 011-contributor-profiles.sql

CREATE TABLE contributor_profiles (
  id            BIGSERIAL PRIMARY KEY,
  github_username TEXT NOT NULL UNIQUE,
  slack_user_id   TEXT UNIQUE,              -- nullable: not all contributors are linked
  display_name    TEXT,
  overall_tier    TEXT NOT NULL DEFAULT 'regular',   -- computed from expertise percentile
  overall_score   REAL NOT NULL DEFAULT 0,           -- aggregate expertise score
  opted_out       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scored_at  TIMESTAMPTZ                        -- when expertise was last recalculated
);

CREATE INDEX idx_contributor_profiles_github ON contributor_profiles (github_username);
CREATE INDEX idx_contributor_profiles_slack ON contributor_profiles (slack_user_id) WHERE slack_user_id IS NOT NULL;
CREATE INDEX idx_contributor_profiles_tier ON contributor_profiles (overall_tier);

CREATE TABLE contributor_expertise (
  id            BIGSERIAL PRIMARY KEY,
  profile_id    BIGINT NOT NULL REFERENCES contributor_profiles(id) ON DELETE CASCADE,
  dimension     TEXT NOT NULL,               -- 'language' or 'file_area'
  topic         TEXT NOT NULL,               -- e.g., 'TypeScript', 'src/api/'
  score         REAL NOT NULL DEFAULT 0,     -- 0.0 - 1.0 normalized
  raw_signals   INTEGER NOT NULL DEFAULT 0,  -- total weighted signal count
  last_active   TIMESTAMPTZ,                 -- most recent activity in this area
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(profile_id, dimension, topic)
);

CREATE INDEX idx_contributor_expertise_profile ON contributor_expertise (profile_id);
CREATE INDEX idx_contributor_expertise_dimension ON contributor_expertise (dimension, topic);
```

### Slash Command Handler
```typescript
// src/slack/slash-command-handler.ts
export type SlashCommandResult = {
  responseType: "ephemeral" | "in_channel";
  text: string;
  asyncWork?: () => Promise<void>;  // Deferred work after 200 response
};

export async function handleKodiaiCommand(params: {
  text: string;        // subcommand + args, e.g., "link octocat"
  slackUserId: string;
  profileStore: ContributorProfileStore;
  logger: Logger;
}): Promise<SlashCommandResult> {
  const parts = params.text.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase();

  switch (subcommand) {
    case "link":
      return handleLink({ githubUsername: parts[1], slackUserId: params.slackUserId, ... });
    case "unlink":
      return handleUnlink({ slackUserId: params.slackUserId, ... });
    case "profile":
      if (parts[1] === "opt-out") return handleOptOut({ ... });
      return handleViewProfile({ ... });
    default:
      return { responseType: "ephemeral", text: "Unknown command. Try: link, unlink, profile" };
  }
}
```

### Expertise Scorer Core Logic
```typescript
// src/contributor/expertise-scorer.ts
const DECAY_HALF_LIFE_DAYS = 180;  // 6 months
const DECAY_LAMBDA = Math.LN2 / DECAY_HALF_LIFE_DAYS;

const SIGNAL_WEIGHTS = {
  commit: 1,
  pr_review: 2,        // Reviews show engagement with area
  pr_authored: 3,       // Merged PRs are strongest signal
} as const;

function computeDecayedScore(signals: ActivitySignal[]): number {
  const now = Date.now();
  let totalWeighted = 0;

  for (const signal of signals) {
    const daysSince = (now - signal.date.getTime()) / (1000 * 60 * 60 * 24);
    const weight = SIGNAL_WEIGHTS[signal.type];
    totalWeighted += weight * Math.exp(-DECAY_LAMBDA * daysSince);
  }

  return totalWeighted;
}

// Normalize scores to 0-1 range using sigmoid (bounded, monotonic)
function normalizeScore(raw: number): number {
  // Sigmoid centered at midpoint, tuned so score=50 maps to ~0.5
  const k = 0.05;  // steepness
  const midpoint = 50;
  return 1 / (1 + Math.exp(-k * (raw - midpoint)));
}
```

### Enhanced Author Experience Prompt Section
```typescript
// Extension of existing buildAuthorExperienceSection() in review-prompt.ts
export function buildAuthorExperienceSection(params: {
  tier: AuthorTier;  // Extended: "newcomer" | "developing" | "established" | "senior"
  authorLogin: string;
  areaExpertise?: { dimension: string; topic: string; score: number }[];
}): string {
  // For senior contributors in their strong areas:
  if (tier === "senior") {
    return [
      "## Author Experience Context",
      "",
      `The PR author (${authorLogin}) is a senior contributor with deep expertise in this area.`,
      "",
      "- Be concise: flag the issue directly, skip explanations",
      "- Raise the bar: only comment on genuine issues (MEDIUM+ severity)",
      "- Focus on architecture and design, not syntax or style",
      "- Use peer-to-peer tone: direct, brief, no hedging",
    ].join("\n");
  }
  // ... other tiers
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static 3-tier author classification | Data-driven expertise with activity signals | This phase | Reviews adapt to actual contributor knowledge |
| GitHub `authorAssociation` only | Commit + PR + review multi-signal scoring | This phase | Captures real expertise, not just org membership |
| No cross-platform identity | Slack-initiated GitHub linking | This phase | Enables Slack context in GitHub reviews |
| Channel-only Slack integration | Adds slash commands + DM surface | This phase | New interaction pattern for Kodiai |

**Deprecated/outdated:**
- The existing `classifyAuthor()` becomes a fallback, not removed. It handles the case where no profile exists.
- The `author_cache` table remains for backward compatibility but profile store takes precedence when available.

## Open Questions

1. **Slack App Manifest Scopes**
   - What we know: Current scopes are `chat:write`, `reactions:write`. Slash commands need `commands` scope. DMs need `im:write`.
   - What's unclear: Whether `users:read` is needed for heuristic matching (to read display names of workspace members).
   - Recommendation: Add `commands`, `im:write`, and `users:read` scopes to the Slack app manifest. Verify in Slack API settings before deployment.

2. **File Area Granularity**
   - What we know: Expertise dimension is "file area" (e.g., `src/api/`).
   - What's unclear: What path depth to use. Too shallow (`src/`) is useless; too deep (`src/handlers/review.ts`) is too specific.
   - Recommendation: Use two-level directory prefix (e.g., `src/handlers/`, `src/knowledge/`, `src/slack/`). Strip filename, normalize to directory.

3. **Initial Expertise Seeding Scope**
   - What we know: Need commit history, PR authorship, PR review activity.
   - What's unclear: How far back to look for initial seeding. The review_comments table has 18 months of backfilled data.
   - Recommendation: Seed from the last 12 months of commit/PR data. Use existing review_comments table for review activity signals (no additional GitHub API calls for that dimension).

4. **Tier Count and Boundaries**
   - What we know: User wants percentile-based tiers (top 20% = senior, bottom 20% = newcomer). Discretion area.
   - What's unclear: Exact number of tiers.
   - Recommendation: Four tiers -- `newcomer` (bottom 20%), `developing` (20-50%), `established` (50-80%), `senior` (top 20%). Maps cleanly to the existing 3-tier system while adding one intermediate level.

## Discretion Recommendations

### Expertise Score Refresh Strategy
**Recommendation: Hybrid (incremental + periodic)**
- **Incremental:** On each PR review completion, fire-and-forget update the author's expertise for the touched files/languages. This is lightweight (single SQL upsert per dimension) and keeps active contributors current.
- **Periodic batch:** Weekly scheduled job recomputes all scores (applies decay, recalculates percentile tiers). This handles contributors who become inactive (their tier should drop over time).
- **Rationale:** Incremental catches new activity immediately; batch handles decay and percentile rebalancing.

### Score Decay Curve
**Recommendation: Exponential decay with 180-day half-life**
- Half-life of 180 days means activity from 6 months ago counts at 50% weight, 1 year at 25%.
- This is generous enough to not penalize people on vacation but aggressive enough to demote truly inactive contributors within a year.
- Simpler than sigmoid or step-function decay; single parameter (half-life) is easy to tune.

### Heuristic Matching Algorithm for Identity Suggestions
**Recommendation: Normalized string similarity on display names**
- Fetch Slack workspace members (`users.list`), compare `profile.display_name` and `profile.real_name` against GitHub username and profile name.
- Normalize: lowercase, strip special chars, compare with Levenshtein distance (threshold: distance <= 2 for short names, <= 3 for longer).
- Only suggest, never auto-link. Show suggestion as Slack DM: "I noticed GitHub user `octocat` has a similar display name. Link with `/kodiai link octocat`?"
- Run heuristic matching lazily: when a GitHub username appears in a PR but has no profile, check for Slack matches.

### Tier Thresholds
**Recommendation: 4 tiers, percentile-based**
- `newcomer`: bottom 20% of overall_score (or score = 0)
- `developing`: 20th-50th percentile
- `established`: 50th-80th percentile
- `senior`: top 20%
- Special case: score of 0 (no activity data) always maps to newcomer regardless of percentile.

### Prompt Engineering for Adapted Tones
**Recommendation: Extend existing `buildAuthorExperienceSection()` with 4-tier support**
- Reuse existing "first-time" prompt text for `newcomer`
- Add `developing` tier: moderate explanations, some doc links, balanced tone
- Reuse existing "regular" (empty) behavior for `established`
- Reuse existing "core" prompt text for `senior`, with additional architecture focus

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `src/lib/author-classifier.ts` -- existing 3-tier classification
- Codebase inspection: `src/execution/review-prompt.ts` -- existing `buildAuthorExperienceSection()`
- Codebase inspection: `src/knowledge/store.ts` -- postgres.js store pattern
- Codebase inspection: `src/slack/client.ts` -- Slack API client pattern (raw fetch)
- Codebase inspection: `src/routes/slack-events.ts` -- Slack event routing + verification
- Codebase inspection: `src/db/migrations/` -- migration file naming convention (NNN-name.sql)
- Codebase inspection: `src/handlers/review.ts` -- `resolveAuthorTier()` integration point
- Codebase inspection: `src/knowledge/types.ts` -- `AuthorCacheEntry` and `KnowledgeStore` interface

### Secondary (MEDIUM confidence)
- Slack API docs: Slash commands use form-encoded POST, require `commands` scope, 3-second response timeout
- Slack API docs: `conversations.open` for DM channel creation requires `im:write` scope
- Slack API docs: `response_url` allows async follow-up within 30 minutes
- PostgreSQL docs: `PERCENT_RANK()` window function for percentile computation

### Tertiary (LOW confidence)
- Exponential decay half-life of 180 days is a reasonable starting point but will need tuning based on actual xbmc/xbmc contributor activity patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, all patterns established in codebase
- Architecture: HIGH - clear extension points exist (author-classifier, review-prompt, store pattern)
- Pitfalls: HIGH - Slack slash command gotchas are well-documented; rate limits are familiar territory
- Expertise scoring: MEDIUM - decay constants and tier thresholds will need empirical tuning

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (stable domain, no external dependency volatility)
