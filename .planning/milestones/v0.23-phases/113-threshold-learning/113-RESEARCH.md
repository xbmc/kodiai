# Phase 113: Threshold Learning - Research

**Researched:** 2026-02-27
**Domain:** Bayesian threshold auto-tuning for duplicate detection
**Confidence:** HIGH

## Summary

Phase 113 adds per-repo Bayesian threshold learning to the duplicate detection system. The current system uses a static `duplicateThreshold` from `.kodiai.yml` config (default 75, representing similarity percentage). The new system will use Beta-Binomial conjugate updating to learn from confirmed outcomes in `issue_outcome_feedback` (created in Phase 112), automatically adjusting the threshold for each repo.

The codebase is well-structured for this change. The duplicate detector (`src/triage/duplicate-detector.ts`) already accepts `threshold` as a parameter, and the handler (`src/handlers/issue-opened.ts`) reads it from config at line 164: `threshold: config.triage.duplicateThreshold ?? 75`. The integration point is clean -- we need a function that computes the effective threshold (Bayesian or fallback) and inject it where the config value is currently read.

**Primary recommendation:** Create a pure `triage/threshold-learner.ts` module with Beta-Binomial update logic and a `getEffectiveThreshold()` function that queries `issue_outcome_feedback` aggregates and `triage_threshold_state`. Wire it into `issue-opened.ts` to replace the static config read. Store Bayesian state in a new `triage_threshold_state` table (migration 018).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| postgres.js | existing | DB queries via tagged template literals | Already used throughout (`Sql` type) |
| zod | existing | Schema validation for threshold config | Already used in `src/execution/config.ts` |
| pino | existing | Structured logging | Already used for all handlers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| bun:test | existing | Unit testing | All test files use `bun:test` |

### No Additional Dependencies Needed
Beta-Binomial updating is simple arithmetic (additions and a division). No stats library required.

## Architecture Patterns

### Recommended File Structure
```
src/
  triage/
    threshold-learner.ts       # Beta-Binomial update + getEffectiveThreshold()
    threshold-learner.test.ts  # Pure function tests
    duplicate-detector.ts      # UNCHANGED -- already accepts threshold param
  db/
    migrations/
      018-triage-threshold-state.sql       # New table
      018-triage-threshold-state.down.sql  # Rollback
  handlers/
    issue-opened.ts            # MODIFIED -- calls getEffectiveThreshold()
```

### Pattern 1: Pure Computation + DB Boundary
**What:** Keep Beta-Binomial math as pure functions. Separate DB reads/writes into a thin layer.
**When to use:** Always for this kind of statistical logic.
**Example:**
```typescript
// Pure computation -- no DB, no side effects
export function betaBinomialUpdate(
  alpha: number,
  beta: number,
  truePositive: boolean,
): { alpha: number; beta: number } {
  return truePositive
    ? { alpha: alpha + 1, beta }
    : { alpha, beta: beta + 1 };
}

export function posteriorMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

// Convert posterior mean (0-1 probability) to similarity threshold (50-95)
export function posteriorToThreshold(
  alpha: number,
  beta: number,
  floor: number,
  ceiling: number,
): number {
  const mean = posteriorMean(alpha, beta);
  // Higher confidence in duplicates -> lower threshold (catch more)
  // Lower confidence -> higher threshold (be more selective)
  // Invert: mean near 1 = "predictions are accurate" = can lower threshold
  const raw = Math.round((1 - mean) * 100);
  return Math.max(floor, Math.min(ceiling, raw));
}
```

### Pattern 2: Effective Threshold Resolution
**What:** Single function that resolves the threshold to use, encapsulating the fallback chain.
**When to use:** In the issue-opened handler where threshold is needed.
**Example:**
```typescript
export async function getEffectiveThreshold(params: {
  sql: Sql;
  repo: string;
  configThreshold: number;
  minSamples: number;      // LEARN-02: 20
  floor: number;           // LEARN-03: 50
  ceiling: number;         // LEARN-03: 95
  logger: Logger;
}): Promise<{ threshold: number; source: "learned" | "config" }> {
  // 1. Query triage_threshold_state for this repo
  // 2. If sample_count < minSamples, return { threshold: configThreshold, source: "config" }
  // 3. Compute from alpha/beta, clamp to [floor, ceiling]
  // 4. Return { threshold, source: "learned" }
}
```

### Pattern 3: Outcome-Driven Update (triggered from issue-closed)
**What:** After inserting an outcome in `issue-closed.ts`, update the Beta-Binomial state.
**When to use:** Every time a triage outcome is recorded with `kodiai_predicted_duplicate` set.
**Example:**
```typescript
// Called from issue-closed handler AFTER outcome insert
export async function updateThresholdState(params: {
  sql: Sql;
  repo: string;
  kodiaiPredictedDuplicate: boolean;
  confirmedDuplicate: boolean;
  logger: Logger;
}): Promise<void> {
  // Only update when kodiai made a prediction (predicted duplicate)
  // OR when kodiai didn't predict but it was confirmed (false negative)
  // Key signal: was the prediction correct?
  //
  // True positive: predicted=true, confirmed=true -> alpha++
  // False positive: predicted=true, confirmed=false -> beta++
  // False negative: predicted=false, confirmed=true -> beta++ (missed it)
  // True negative: predicted=false, confirmed=false -> alpha++ (correct skip)

  // UPSERT into triage_threshold_state
}
```

### Pattern 4: Handler Wiring (existing pattern)
The codebase uses a consistent handler registration pattern. The issue-opened handler at line 157-167 passes threshold to `findDuplicateCandidates`. The change is minimal:

```typescript
// BEFORE (line 164):
threshold: config.triage.duplicateThreshold ?? 75,

// AFTER:
threshold: (await getEffectiveThreshold({
  sql,
  repo,
  configThreshold: config.triage.duplicateThreshold ?? 75,
  minSamples: 20,
  floor: 50,
  ceiling: 95,
  logger: handlerLogger,
})).threshold,
```

### Anti-Patterns to Avoid
- **Modifying duplicate-detector.ts:** It already accepts threshold as a parameter. Do NOT change its interface -- change what value is passed to it.
- **Coupling Bayesian state to config schema:** The learned threshold is NOT a config value. It lives in the DB, not `.kodiai.yml`. Config provides the fallback.
- **Storing computed threshold in DB:** Store alpha/beta/sample_count. Compute the threshold on read. This is more flexible and debuggable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Statistical library | Full stats framework | Simple alpha/beta arithmetic | Beta-Binomial conjugate update is literally 2 additions per observation |
| Threshold scheduling | Complex scheduling/cron | Inline update in issue-closed handler | Update happens naturally when outcomes arrive |
| Migration runner | Custom runner | Existing migration pattern (numbered SQL files) | Consistent with all 17 existing migrations |

**Key insight:** Beta-Binomial is the simplest possible Bayesian model. Alpha starts at 1, beta starts at 1 (uniform prior). Each observation increments one counter. The posterior mean is `alpha / (alpha + beta)`. No libraries needed.

## Common Pitfalls

### Pitfall 1: Confusing Similarity Percentage with Probability
**What goes wrong:** The config `duplicateThreshold` is a similarity percentage (0-100), while the Bayesian posterior is a probability (0-1). Mixing these up produces nonsense thresholds.
**Why it happens:** Two different scales in the same domain.
**How to avoid:** Keep clear naming: `posteriorMean` (0-1), `similarityThreshold` (0-100). The conversion function must be explicit and well-documented.
**Warning signs:** Threshold values outside [50, 95] after conversion.

### Pitfall 2: Learning from Non-Predictions
**What goes wrong:** Updating Bayesian state for issues where Kodiai never ran duplicate detection (no triage record, or triage.enabled was false).
**Why it happens:** `issue_outcome_feedback` records ALL closures, not just triaged issues.
**How to avoid:** Only update `triage_threshold_state` when `triage_id IS NOT NULL` in the outcome row. This means Kodiai actually triaged that issue.
**Warning signs:** Sample count growing faster than expected.

### Pitfall 3: Cold Start with Aggressive Threshold
**What goes wrong:** With very few samples (e.g., 3 outcomes), the Bayesian estimate can swing wildly, producing a threshold that's too high (misses all duplicates) or too low (false alarms everywhere).
**Why it happens:** Small sample sizes create high-variance estimates.
**How to avoid:** LEARN-02's 20-outcome minimum sample gate. Below 20, always use config fallback. This is already in the requirements.
**Warning signs:** Effective threshold changing by more than 10 points between consecutive outcomes.

### Pitfall 4: Not Handling Both Signal Directions
**What goes wrong:** Only learning from "predicted duplicate that was confirmed" (true positives), ignoring false positives and false negatives.
**Why it happens:** Intuition focuses on correct predictions only.
**How to avoid:** Track all four confusion matrix quadrants. Both TP and TN increment alpha (correct). Both FP and FN increment beta (incorrect).
**Warning signs:** Alpha growing but beta staying at 1.

### Pitfall 5: Race Condition on UPSERT
**What goes wrong:** Two issue closures for the same repo at the same instant could read stale alpha/beta, producing a lost update.
**Why it happens:** Read-then-write without locking.
**How to avoid:** Use atomic `UPDATE ... SET alpha = alpha + 1` (incrementing in SQL, not in application code). Or use `INSERT ... ON CONFLICT DO UPDATE SET alpha = alpha + $delta`.
**Warning signs:** Sample count not matching count of outcomes.

## Code Examples

### Migration 018: triage_threshold_state
```sql
-- 018-triage-threshold-state.sql
-- Per-repo Bayesian state for duplicate detection threshold learning (LEARN-01)

CREATE TABLE IF NOT EXISTS triage_threshold_state (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  repo TEXT NOT NULL,

  -- Beta-Binomial parameters (uniform prior: alpha=1, beta=1)
  alpha DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  beta_ DOUBLE PRECISION NOT NULL DEFAULT 1.0,  -- "beta" is a reserved word in some contexts

  -- Bookkeeping
  sample_count INTEGER NOT NULL DEFAULT 0,

  UNIQUE(repo)
);

CREATE INDEX IF NOT EXISTS idx_triage_threshold_state_repo
  ON triage_threshold_state (repo);
```

```sql
-- 018-triage-threshold-state.down.sql
DROP TABLE IF EXISTS triage_threshold_state;
```

### Atomic Update Pattern (avoids race conditions)
```typescript
// Increment alpha or beta atomically in SQL
async function recordObservation(
  sql: Sql,
  repo: string,
  correct: boolean,
): Promise<void> {
  const alphaInc = correct ? 1 : 0;
  const betaInc = correct ? 0 : 1;

  await sql`
    INSERT INTO triage_threshold_state (repo, alpha, beta_, sample_count)
    VALUES (${repo}, ${1.0 + alphaInc}, ${1.0 + betaInc}, 1)
    ON CONFLICT (repo) DO UPDATE SET
      alpha = triage_threshold_state.alpha + ${alphaInc},
      beta_ = triage_threshold_state.beta_ + ${betaInc},
      sample_count = triage_threshold_state.sample_count + 1,
      updated_at = now()
  `;
}
```

### Reading Effective Threshold
```typescript
async function getEffectiveThreshold(
  sql: Sql,
  repo: string,
  configThreshold: number,
  minSamples: number,
  floor: number,
  ceiling: number,
): Promise<{ threshold: number; source: "learned" | "config" }> {
  const rows = await sql`
    SELECT alpha, beta_, sample_count
    FROM triage_threshold_state
    WHERE repo = ${repo}
  `;

  if (rows.length === 0 || (rows[0].sample_count as number) < minSamples) {
    return { threshold: configThreshold, source: "config" };
  }

  const alpha = rows[0].alpha as number;
  const beta = rows[0].beta_ as number;
  const mean = alpha / (alpha + beta);

  // Convert: high accuracy (mean near 1) -> lower threshold ok
  // Threshold = 100 * (1 - mean), then clamp
  const raw = Math.round(100 * (1 - mean));
  const clamped = Math.max(floor, Math.min(ceiling, raw));

  return { threshold: clamped, source: "learned" };
}
```

### Confusion Matrix Classification
```typescript
function classifyOutcome(
  kodiaiPredictedDuplicate: boolean,
  confirmedDuplicate: boolean,
): { correct: boolean; quadrant: "TP" | "FP" | "FN" | "TN" } {
  if (kodiaiPredictedDuplicate && confirmedDuplicate) {
    return { correct: true, quadrant: "TP" };
  }
  if (kodiaiPredictedDuplicate && !confirmedDuplicate) {
    return { correct: false, quadrant: "FP" };
  }
  if (!kodiaiPredictedDuplicate && confirmedDuplicate) {
    return { correct: false, quadrant: "FN" };
  }
  return { correct: true, quadrant: "TN" };
}
```

### Structured Logging on Threshold Changes (LEARN-02 logging req)
```typescript
handlerLogger.info({
  thresholdSource: result.source,
  effectiveThreshold: result.threshold,
  configThreshold: config.triage.duplicateThreshold ?? 75,
  ...(result.source === "learned" ? {
    alpha: result.alpha,
    beta: result.beta,
    sampleCount: result.sampleCount,
  } : {}),
}, "Duplicate detection threshold resolved");
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static config threshold | Phase 113: Bayesian auto-tuning | Now | Per-repo learning from outcomes |
| No outcome tracking | Phase 112: issue_outcome_feedback | Previous phase | Foundation for learning |

## Key Data Flow

```
issue.opened -> issue-opened.ts
  -> getEffectiveThreshold(sql, repo, configThreshold)
     -> SELECT from triage_threshold_state
     -> if sample_count >= 20: compute from alpha/beta, clamp [50,95]
     -> else: use configThreshold
  -> findDuplicateCandidates(..., threshold)
  -> post comment (if candidates found)

issue.closed -> issue-closed.ts
  -> INSERT into issue_outcome_feedback (existing)
  -> IF triage_id IS NOT NULL:
     -> classifyOutcome(predicted, confirmed)
     -> atomic UPSERT triage_threshold_state (alpha/beta increment)
```

## Existing Code Integration Points

### issue-opened.ts (line 157-167)
Current threshold read:
```typescript
threshold: config.triage.duplicateThreshold ?? 75,
```
Change to call `getEffectiveThreshold()` before this line. The function needs `sql`, `repo`, `config.triage.duplicateThreshold`, and `logger` -- all already available in scope.

### issue-closed.ts (line 112-125)
After the existing INSERT into `issue_outcome_feedback`, add a call to update threshold state. The `triageId`, `kodiaiPredictedDuplicate`, and `confirmedDuplicate` variables are already computed (lines 105-106, 77).

### Config schema (execution/config.ts, line 460-515)
The `triageSchema` already has `duplicateThreshold` (line 467). No changes needed to the schema. The config value serves as the fallback when sample count is below 20.

## Open Questions

1. **Threshold-to-prediction mapping direction**
   - What we know: Higher `duplicateThreshold` means fewer duplicates flagged (more selective). The Bayesian posterior mean represents "fraction of correct predictions."
   - What's unclear: The exact mapping from posterior mean to threshold. If accuracy is high, should we lower the threshold (be less selective, catch more) or keep it the same? The examples above use `100 * (1 - mean)` which lowers threshold as accuracy improves.
   - Recommendation: Use `100 * (1 - mean)` as the base formula. With uniform prior (alpha=1, beta=1) and no observations, this gives 50 -- exactly the floor. As accuracy improves (mean -> 1), threshold drops toward 0 but is clamped to floor=50. This means the Bayesian system can only make the threshold MORE permissive (lower), never less permissive than the floor. For the opposite direction (raise threshold when predictions are bad), the formula naturally gives higher values when mean is low.

2. **Should TN (true negatives) count?**
   - What we know: TN = Kodiai did not predict duplicate, issue was not a duplicate. This is the most common case.
   - What's unclear: Including TN floods the alpha count, drowning out the signal from actual duplicate predictions (which are rare).
   - Recommendation: Only count observations where Kodiai actually made a duplicate prediction (TP and FP), or where a duplicate was missed (FN). Skip pure TN. This keeps the signal focused on duplicate detection accuracy. Update the `updateThresholdState` to only fire when `kodiaiPredictedDuplicate || confirmedDuplicate`.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/triage/duplicate-detector.ts` -- threshold parameter interface
- Codebase analysis: `src/handlers/issue-opened.ts` -- threshold usage at line 164
- Codebase analysis: `src/handlers/issue-closed.ts` -- outcome capture with TP/FP signals
- Codebase analysis: `src/execution/config.ts` -- triage schema (lines 460-515)
- Codebase analysis: `src/db/migrations/016-issue-triage-state.sql` -- existing triage state table
- Codebase analysis: `src/db/migrations/017-issue-outcome-feedback.sql` -- outcome table schema
- Codebase analysis: `src/knowledge/adaptive-threshold.ts` -- existing adaptive threshold pattern (different domain but shows clamp pattern)

### Secondary (MEDIUM confidence)
- Beta-Binomial conjugate prior is standard Bayesian statistics -- no external source needed for the math

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in use, no new dependencies
- Architecture: HIGH - clean integration points identified, existing patterns followed
- Pitfalls: HIGH - identified from direct codebase analysis and Bayesian fundamentals
- Beta-Binomial math: HIGH - textbook conjugate prior, trivially implementable

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable domain, no external dependency changes expected)
