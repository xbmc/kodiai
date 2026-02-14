# Phase 41: Feedback-Driven Learning - Research

**Researched:** 2026-02-13
**Domain:** Feedback aggregation, pattern-based auto-suppression, safety floor enforcement, confidence scoring
**Confidence:** HIGH

## Summary

Phase 41 transforms the passive feedback corpus captured in Phase 29 (`feedback_reactions` table, `feedback-sync.ts` handler) into an active learning loop that auto-suppresses rejected finding patterns and adjusts confidence scores. The codebase already has every foundational building block: feedback reactions are captured via an idempotent polling-based sync pipeline, findings are fingerprinted with FNV-1a hashes (`fingerprintFindingTitle` in `review.ts`), severity floor enforcement exists in `enforcement/severity-floors.ts`, and the `.kodiai.yml` config system supports per-repo opt-in via Zod schemas.

The core engineering challenge is building a **feedback aggregation layer** that queries the existing `feedback_reactions` table, groups thumbs-down reactions by finding fingerprint (title hash + file path pattern), applies configurable thresholds (3+ thumbs-down, 3+ distinct reactors, 2+ PRs), and produces a suppression set that the review handler consults before publishing findings. This suppression must be gated behind explicit opt-in configuration and hard safety floors that prevent suppression of CRITICAL findings and MAJOR security/correctness findings.

The architecture naturally decomposes into: (1) a feedback aggregation query module that computes suppression candidates from the existing `feedback_reactions` table, (2) a safety floor guard that protects critical findings from suppression, (3) integration into the review handler's existing post-extraction processing pipeline (between enforcement and suppression matching at lines ~1380-1460 in `review.ts`), (4) confidence score adjustment based on feedback history, (5) `.kodiai.yml` schema additions for opt-in and threshold configuration, and (6) a view/clear mechanism for repo owners.

**Primary recommendation:** Build a `src/feedback/` module with pure functions for aggregation and suppression evaluation, integrate into the existing review handler pipeline after enforcement but before existing suppression matching, and add a `feedback` section to `.kodiai.yml` with `autoSuppress.enabled: false` as the default.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bun:sqlite` | builtin | Query `feedback_reactions` table for aggregation | Same DB/pattern as all existing knowledge store queries |
| `zod` | existing | Validate new `feedback` config section in `.kodiai.yml` | Already used for all config validation in `execution/config.ts` |
| `bun:test` | builtin | Test framework | Already used for all existing tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `picomatch` | existing | File path pattern matching for fingerprint grouping | Already used throughout codebase |
| `pino` | existing | Structured logging for suppression decisions | Already used everywhere |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQL aggregation in knowledge store | In-memory aggregation from raw reactions | SQL is more efficient for large datasets, leverages existing indexes, and avoids loading all reactions into memory |
| FNV-1a title fingerprint (existing) | Full title string comparison | FNV-1a already proven in `review.ts` and `store.ts`; using same hash ensures consistency with existing dedup |
| Per-review query of suppression set | Cached suppression set with TTL | Per-review query is simpler, sufficient for current scale (bounded by `maxCandidates=100`), and avoids cache invalidation complexity |
| Separate feedback DB | Same knowledge DB | Same DB keeps joins simple and leverages existing WAL/connection pool |

**Installation:**
```bash
# No new dependencies required
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── feedback/                        # NEW: Feedback-driven learning module
│   ├── types.ts                     # FeedbackSuppressionResult, FeedbackThresholds, etc.
│   ├── aggregator.ts                # Query feedback_reactions, compute suppression candidates
│   ├── aggregator.test.ts           # Threshold logic, safety floor, edge cases
│   ├── safety-guard.ts              # Protect CRITICAL and MAJOR security/correctness from suppression
│   ├── safety-guard.test.ts
│   ├── confidence-adjuster.ts       # Adjust confidence scores based on feedback history
│   ├── confidence-adjuster.test.ts
│   └── index.ts                     # Public API: evaluateFeedbackSuppressions()
├── execution/
│   └── config.ts                    # MODIFIED: Add feedback schema section
├── knowledge/
│   ├── store.ts                     # MODIFIED: Add aggregation query methods
│   └── types.ts                     # MODIFIED: Add aggregation result types
└── handlers/
    └── review.ts                    # MODIFIED: Integrate feedback suppression into pipeline
```

### Pattern 1: Feedback Aggregation Query
**What:** SQL query that groups `feedback_reactions` rows by finding fingerprint (FNV-1a hash of title + file path pattern) and computes thumbs-down counts, distinct reactor counts, and distinct PR counts.
**When to use:** During review execution, after enforcement but before suppression matching.
**Why SQL:** The `feedback_reactions` table already has `title`, `file_path`, `reactor_login`, `review_id` (which joins to `reviews.pr_number`). SQL aggregation avoids loading all reactions into memory.
**Example:**
```typescript
// Fingerprint computed from finding title using existing FNV-1a hash
// File path contributes to fingerprint via directory prefix (e.g., "src/api/")
type FeedbackPattern = {
  fingerprint: string;       // FNV-1a hash of normalized title
  thumbsDownCount: number;   // Total -1 reactions
  thumbsUpCount: number;     // Total +1 reactions
  distinctReactors: number;  // Count of unique reactor_login for -1
  distinctPRs: number;       // Count of unique pr_number for -1
  severity: string;          // Most recent severity seen
  category: string;          // Most recent category seen
  sampleTitle: string;       // Representative title for logging/display
};

// SQL aggregation query (conceptual)
const query = `
  SELECT
    -- fingerprint computed in app layer from title
    fr.reaction_content,
    COUNT(*) AS reaction_count,
    COUNT(DISTINCT fr.reactor_login) AS distinct_reactors,
    COUNT(DISTINCT r.pr_number) AS distinct_prs,
    fr.severity,
    fr.category,
    fr.title AS sample_title
  FROM feedback_reactions fr
  INNER JOIN reviews r ON r.id = fr.review_id
  WHERE fr.repo = $repo
    AND fr.reaction_content = '-1'
  GROUP BY fr.title  -- grouped by exact title; fingerprint applied in app layer
`;
```

### Pattern 2: Safety Floor Guard (Never-Suppress Rules)
**What:** A pure function that checks whether a finding is protected from feedback-based suppression.
**When to use:** After aggregation determines a pattern is a suppression candidate, but before actually suppressing.
**Why separate:** Clear separation of concerns; safety rules are easily auditable and testable.
**Example:**
```typescript
// Source: derived from FEED-04, FEED-05 requirements
function isFeedbackSuppressionProtected(finding: {
  severity: FindingSeverity;
  category: FindingCategory;
}): boolean {
  // FEED-04: CRITICAL findings are NEVER auto-suppressed
  if (finding.severity === "critical") return true;

  // FEED-05: MAJOR findings in security/correctness are NEVER auto-suppressed
  if (finding.severity === "major" &&
      (finding.category === "security" || finding.category === "correctness")) {
    return true;
  }

  return false;
}
```

### Pattern 3: Confidence Score Adjustment
**What:** Modify the existing `computeConfidence()` output based on per-finding feedback history.
**When to use:** After base confidence is computed, apply feedback adjustment.
**Example:**
```typescript
// FEED-06: +10 for thumbs-up, -20 for thumbs-down
function adjustConfidenceForFeedback(
  baseConfidence: number,
  feedbackCounts: { thumbsUp: number; thumbsDown: number },
): number {
  const adjustment = (feedbackCounts.thumbsUp * 10) - (feedbackCounts.thumbsDown * 20);
  return Math.min(100, Math.max(0, baseConfidence + adjustment));
}
```

### Pattern 4: Integration into Review Pipeline
**What:** Insert feedback suppression evaluation into the existing post-extraction pipeline in `review.ts`.
**When to use:** After enforcement (`applyEnforcement`) but before existing suppression matching.
**Example pipeline position:**
```typescript
// Existing pipeline in review.ts (simplified):
// 1. extractFindingsFromReviewComments()     -- lines ~1364-1374
// 2. applyEnforcement()                      -- lines ~1379-1388
// 3. [NEW] evaluateFeedbackSuppressions()    -- INSERT HERE
// 4. suppressionMatching + confidence        -- lines ~1414-1460
// 5. removeFilteredInlineComments()          -- lines ~1502-1511
```

### Pattern 5: Opt-In Configuration
**What:** Add a `feedback` section to `.kodiai.yml` with explicit opt-in for auto-suppression.
**When to use:** Parsed during config loading, passed to feedback evaluation function.
**Example:**
```yaml
# .kodiai.yml
feedback:
  autoSuppress:
    enabled: false  # Explicit opt-in required (FEED-08)
    thresholds:
      minThumbsDown: 3      # FEED-09: configurable
      minDistinctReactors: 3 # FEED-09: configurable
      minDistinctPRs: 2      # FEED-09: configurable
```

### Anti-Patterns to Avoid
- **Suppressing without opt-in:** Feedback suppression MUST default to disabled. Violating FEED-08 would create trust issues.
- **Mixing safety floor logic with aggregation:** Keep the "is this finding protected?" check separate from "does this pattern have enough thumbs-down?" for clarity and testability.
- **Computing fingerprints differently than existing code:** The `fingerprintFindingTitle()` function in `review.ts` (line 79-94) and `_fingerprintTitle()` in `store.ts` (lines 67-80) use identical FNV-1a hash logic. Reuse the same algorithm to ensure consistency.
- **Blocking review on feedback query failures:** All feedback operations must be fail-open, following the established pattern (`try/catch -> logger.warn -> continue`).
- **Over-engineering aggregation caching:** At current scale (100 max candidates per sync), per-review SQL aggregation is fast enough. Don't add a caching layer prematurely.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Finding fingerprint hash | New hash function | Existing `fingerprintFindingTitle()` FNV-1a in `review.ts` | Same hash = consistent matching with existing dedup infrastructure |
| Severity/category type checking | String comparison | Existing `FindingSeverity`/`FindingCategory` type unions from `knowledge/types.ts` | Type safety prevents silent mismatches |
| Config schema validation | Manual parsing | Zod schema in `execution/config.ts` | Follows existing pattern, gets free section-level fallback |
| Feedback reaction storage | New table/module | Existing `feedback_reactions` table in `knowledge/store.ts` | Already has idempotency constraints, indexes, and write methods |
| Safety floor detection | Re-implement severity checking | Leverage existing `severityRank()` from `enforcement/severity-floors.ts` | Already tested, handles all severity comparisons correctly |

**Key insight:** Phase 29 built the feedback ingestion pipeline; Phase 41 adds the aggregation + decision layer on top. Almost all infrastructure already exists -- the work is primarily in query logic, safety guards, and pipeline integration.

## Common Pitfalls

### Pitfall 1: Fingerprint Drift Between Ingestion and Evaluation
**What goes wrong:** Feedback reactions are stored with raw `title` text, but suppression evaluation uses fingerprinted hashes. If the fingerprinting logic differs between storage and evaluation, patterns won't match.
**Why it happens:** `feedback_reactions.title` stores the original title string. The fingerprint must be computed at query time.
**How to avoid:** Either (a) store the title fingerprint as a column in `feedback_reactions` at write time, or (b) compute fingerprints in the aggregation query's application layer using the same `fingerprintFindingTitle()` function.
**Warning signs:** Zero suppression matches despite having sufficient thumbs-down data.

### Pitfall 2: Threshold Check Without Distinct Reactor/PR Counting
**What goes wrong:** A single unhappy user thumbs-down-ing the same pattern multiple times triggers suppression.
**Why it happens:** Counting total reactions instead of distinct reactors and distinct PRs.
**How to avoid:** SQL `COUNT(DISTINCT reactor_login)` and `COUNT(DISTINCT r.pr_number)` with proper joins.
**Warning signs:** Suppressions triggered by patterns with only 1-2 reactors.

### Pitfall 3: Safety Floor Bypass
**What goes wrong:** A CRITICAL SQL injection finding gets auto-suppressed because multiple developers thumbs-downed it (perhaps they fixed it and don't want to see it again).
**Why it happens:** Safety guard not applied, or applied after suppression decision.
**How to avoid:** Check `isFeedbackSuppressionProtected()` BEFORE checking threshold. Protected findings are never suppression candidates regardless of feedback volume.
**Warning signs:** CRITICAL or MAJOR security/correctness findings disappearing from reviews.

### Pitfall 4: Review Details Count Mismatch
**What goes wrong:** The "3 patterns auto-suppressed based on prior feedback" count in Review Details doesn't match actual suppressed findings.
**Why it happens:** Counting patterns vs. findings (one pattern may suppress multiple findings).
**How to avoid:** Track both `suppressedPatternCount` and `suppressedFindingCount` separately. FEED-07 specifies pattern count in the disclosure.
**Warning signs:** Users confused by high suppression count when only a few comment types are suppressed.

### Pitfall 5: Opt-In State Not Checked Early Enough
**What goes wrong:** Expensive aggregation queries run even when feedback auto-suppression is disabled.
**Why it happens:** Check happens after query execution.
**How to avoid:** Early return if `config.feedback.autoSuppress.enabled !== true` before any aggregation.
**Warning signs:** Unnecessary DB queries on every review for repos without opt-in.

### Pitfall 6: Stale Fingerprints After Title Normalization Changes
**What goes wrong:** If the fingerprint algorithm changes (e.g., normalization rules updated), historical feedback becomes disconnected from new findings.
**Why it happens:** Fingerprints are based on normalized title text; changing normalization changes the hash.
**How to avoid:** Treat the fingerprint algorithm as a stable contract. If it must change, provide a migration that recomputes stored fingerprints.
**Warning signs:** Suppression effectiveness drops after code changes to fingerprinting.

## Code Examples

### Existing Fingerprint Function (review.ts lines 79-94)
```typescript
// Source: src/handlers/review.ts
function fingerprintFindingTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");

  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const unsigned = hash >>> 0;
  return `fp-${unsigned.toString(16).padStart(8, "0")}`;
}
```

### Existing Feedback Reactions Table Schema (store.ts lines 218-244)
```sql
-- Source: src/knowledge/store.ts
CREATE TABLE IF NOT EXISTS feedback_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  repo TEXT NOT NULL,
  review_id INTEGER NOT NULL REFERENCES reviews(id),
  finding_id INTEGER NOT NULL REFERENCES findings(id),
  comment_id INTEGER NOT NULL,
  comment_surface TEXT NOT NULL,
  reaction_id INTEGER NOT NULL,
  reaction_content TEXT NOT NULL,
  reactor_login TEXT NOT NULL,
  reacted_at TEXT,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  file_path TEXT NOT NULL,
  title TEXT NOT NULL,
  UNIQUE(repo, comment_id, reaction_id)
);
```

### Existing Confidence Computation (confidence.ts lines 24-47)
```typescript
// Source: src/knowledge/confidence.ts
const SEVERITY_BOOST: Record<FindingSeverity, number> = {
  critical: 30, major: 20, medium: 10, minor: 0,
};

const CATEGORY_BOOST: Record<FindingCategory, number> = {
  security: 15, correctness: 10, performance: 5, style: -5, documentation: -10,
};

export function computeConfidence(input: ConfidenceInput): number {
  let score = 50;
  score += SEVERITY_BOOST[input.severity];
  score += CATEGORY_BOOST[input.category];
  if (input.matchesKnownPattern) {
    score += 10;
  }
  return Math.min(100, Math.max(0, score));
}
```

### Existing Enforcement Pipeline Integration Point (review.ts lines ~1379-1460)
```typescript
// Source: src/handlers/review.ts (simplified)
// Enforcement runs first (severity floors + tooling suppression)
const enforcedFindings = await applyEnforcement({ ... });

// [Phase 41 inserts feedback evaluation HERE]

// Then existing suppression matching + confidence scoring
const processedFindings = enforcedFindings.map((finding) => {
  const matchedSuppression = config.review.suppressions.find((s) =>
    matchesSuppression({ ... }, s)
  );
  const confidence = computeConfidence({ ... });
  return { ...finding, suppressed, confidence, suppressionPattern };
});
```

### Existing Config Schema Pattern (execution/config.ts)
```typescript
// Source: src/execution/config.ts
// All config sections follow this pattern:
const feedbackSchema = z
  .object({
    autoSuppress: z.object({
      enabled: z.boolean().default(false),
      thresholds: z.object({
        minThumbsDown: z.number().min(1).max(50).default(3),
        minDistinctReactors: z.number().min(1).max(50).default(3),
        minDistinctPRs: z.number().min(1).max(50).default(2),
      }).default({ minThumbsDown: 3, minDistinctReactors: 3, minDistinctPRs: 2 }),
    }).default({ enabled: false, thresholds: { minThumbsDown: 3, minDistinctReactors: 3, minDistinctPRs: 2 } }),
  })
  .default({ autoSuppress: { enabled: false, thresholds: { minThumbsDown: 3, minDistinctReactors: 3, minDistinctPRs: 2 } } });
```

### Existing Feedback Sync Handler Registration (index.ts lines 146-152)
```typescript
// Source: src/index.ts
createFeedbackSyncHandler({
  eventRouter,
  jobQueue,
  githubApp,
  knowledgeStore,
  logger,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No feedback capture | Phase 29: idempotent reaction polling via `feedback-sync.ts` | Phase 29 (2026-02-12) | Feedback corpus exists in `feedback_reactions` table |
| Static suppression rules only | Phase 41: feedback-driven auto-suppression with safety floors | This phase | Patterns consistently rejected by humans get auto-suppressed |
| Fixed confidence scores | Phase 41: confidence adjusted by feedback history | This phase | Scores reflect community signal, not just severity/category |
| No safety floor for suppression | Phase 39: severity floor enforcement exists in `enforcement/` | Phase 39 | Safety floor pattern reusable for feedback suppression guards |

**Deprecated/outdated:**
- Planning reaction webhooks: confirmed NOT available via GitHub webhook events (community feature request open since 2022, acknowledged as unimplemented by former GitHub CTO in 2025)
- Aggregate-only feedback storage: the system already stores individual reaction events with reaction IDs, enabling proper distinct-reactor counting

## Open Questions

1. **Fingerprint Granularity: Title-only vs Title+FilePath**
   - What we know: The existing `fingerprintFindingTitle()` uses title-only FNV-1a hash. FEED-02 says "file path + title pattern."
   - What's unclear: Should the fingerprint for feedback aggregation include the file path, the directory path, or just the title?
   - Recommendation: Use title-only fingerprint for aggregation (same finding title across different files = same pattern). File path adds specificity that may prevent useful aggregation. But store `file_path` in the suppression record for logging/audit. This matches FEED-02's intent of "finding fingerprint" being a pattern, not a location.

2. **View/Clear Mechanism (FEED-10) Implementation Surface**
   - What we know: Repo owners need to view and clear feedback-based suppressions.
   - What's unclear: Whether this is a GitHub comment command (e.g., `@kodiai feedback list`), a REST API endpoint, or a `.kodiai.yml` override.
   - Recommendation: Implement as a mention command (e.g., `@kodiai feedback status` / `@kodiai feedback clear`) since the mention handler (`handlers/mention.ts`) already supports command parsing. This avoids building a new API surface. Store a `feedbackSuppressions` concept in the knowledge store that can be queried/cleared.

3. **Feedback Window Duration**
   - What we know: The feedback sync handler uses a 30-day recent window. Aggregation should also have a temporal bound.
   - What's unclear: Should older feedback eventually decay or be purged? Should there be a configurable window?
   - Recommendation: Start with all-time aggregation within the repo (no decay). The 30-day window in `feedback-sync.ts` already limits the ingestion horizon. If needed later, add a `feedbackWindowDays` config option.

4. **Confidence Adjustment: Per-Finding vs Per-Pattern**
   - What we know: FEED-06 says "+10 for thumbs-up, -20 for thumbs-down" but doesn't specify whether this applies to the specific finding or to all findings matching the pattern.
   - What's unclear: If a pattern has 5 thumbs-up and 3 thumbs-down, does every new finding matching that pattern get adjusted by (5*10 - 3*20) = -10?
   - Recommendation: Apply pattern-level aggregated adjustment. Individual finding reactions are too sparse to be useful. The formula would be: `adjustment = (patternThumbsUp * 10) - (patternThumbsDown * 20)`, clamped so total confidence stays in [0, 100].

## Sources

### Primary (HIGH confidence)
- Codebase: `src/handlers/feedback-sync.ts` -- existing reaction polling pipeline, event triggers, reaction filtering
- Codebase: `src/knowledge/store.ts` -- `feedback_reactions` table schema, indexes, insert methods
- Codebase: `src/knowledge/types.ts` -- `FeedbackReaction`, `FindingCommentCandidate` types
- Codebase: `src/handlers/review.ts` -- review pipeline, finding extraction, suppression matching, confidence computation, `fingerprintFindingTitle()`, Review Details formatting
- Codebase: `src/knowledge/confidence.ts` -- `computeConfidence()`, `matchesSuppression()`, suppression pattern types
- Codebase: `src/enforcement/severity-floors.ts` -- `enforceSeverityFloors()`, `severityRank()`, safety floor patterns
- Codebase: `src/enforcement/types.ts` -- `LanguageRulesConfig`, `EnforcedFinding` types
- Codebase: `src/execution/config.ts` -- `.kodiai.yml` schema, Zod section-level parsing pattern
- Codebase: `src/index.ts` -- handler registration, dependency wiring
- Phase 29 research: `.planning/phases/29-feedback-capture/29-RESEARCH.md` -- webhook limitation analysis, architecture decisions

### Secondary (MEDIUM confidence)
- GitHub community discussion: [Feature Request for reaction webhooks](https://github.com/orgs/community/discussions/20824) -- confirms no webhook for reactions, polling is required
- GitHub REST API docs: reactions endpoints for listing/creating reactions on PR review comments

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns verified in existing codebase
- Architecture: HIGH -- clear integration points identified in existing review pipeline, existing fingerprint/aggregation infrastructure
- Pitfalls: HIGH -- failure modes well-understood from Phase 29 implementation and existing enforcement pipeline
- Safety floors: HIGH -- explicit requirements (FEED-04, FEED-05) with clear implementation pattern matching existing `severityRank()` logic

**Research date:** 2026-02-13
**Valid until:** 2026-03-13 (stable domain -- feedback reactions API and SQLite patterns unlikely to change)
