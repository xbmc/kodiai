# Phase 33: Explainable Learning and Delta Reporting - Research

**Researched:** 2026-02-13
**Domain:** Delta status classification for incremental review findings, explainable learning provenance in review output, unified review summary reconciliation
**Confidence:** HIGH

## Summary

Phase 33 adds two complementary visibility features to the review output: (1) delta status labels (`new`, `resolved`, `still-open`) on incremental review findings so users can see at a glance what changed between runs, and (2) explainable provenance annotations on findings that were influenced by retrieved learning memory so users understand WHY a finding was surfaced.

The existing codebase already has all the data needed. Phase 31 built incremental diff computation (`src/lib/incremental-diff.ts`), prior finding dedup (`src/lib/finding-dedup.ts`), the `getPriorReviewFindings` query in the knowledge store, and retrieval context injection into the review prompt (`buildRetrievalContextSection` in `review-prompt.ts`). Phase 32 added language context and localized output. The `formatReviewDetailsSummary` function in `src/handlers/review.ts` already produces a deterministic "Review Details" comment with finding counts, suppressions, and low-confidence lists. The `processedFindings` pipeline already tracks per-finding metadata (severity, category, confidence, suppression status, comment IDs).

The core challenge is classification and formatting -- not data access. Delta classification requires comparing current findings against prior findings for the same PR to determine which are `new`, which prior findings are now `resolved` (not present in current run), and which are `still-open` (present in both). Provenance requires threading retrieval metadata (distance, source repo, outcome) from the retrieval step through to the published output, rather than only injecting it into the LLM prompt. Both features converge on the same output surface: the deterministic "Review Details" comment already published by the handler.

**Primary recommendation:** Add a `classifyFindingDeltas` function that compares current and prior findings by filePath+titleFingerprint to produce delta-annotated findings, then extend `formatReviewDetailsSummary` to render delta labels and provenance. Surface retrieval provenance both in the LLM prompt (already done) AND in the Review Details comment. All changes are contained in `review.ts`, `review-prompt.ts`, and associated test files.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bun:sqlite` | builtin | Query prior findings for delta classification | Already used; `getPriorReviewFindings` query already exists |
| No new libraries | -- | All features are pure TypeScript logic + formatting | Delta classification and provenance formatting are deterministic string operations on existing data |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino` | existing | Structured logging for delta classification decisions | Already used; extend with delta status counts in log entries |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| FNV-1a fingerprint matching for delta classification | Line-range overlap detection | Fingerprint matching is already implemented (`fingerprintFindingTitle`), deterministic, and fast. Line-range matching is fragile when code shifts. Fingerprint is sufficient for title-based delta detection. |
| Embedding provenance in Review Details comment | Separate "Learning Provenance" comment | Single comment is simpler, reduces PR noise, and meets the success criterion of "reconcile delta status and provenance in the same published review output without separate tooling." |
| Post-hoc delta classification (compare after extraction) | LLM-driven delta labeling (ask the model to tag each finding) | Post-hoc classification is deterministic, fast, and testable. LLM labeling is non-deterministic, adds tokens, and may hallucinate delta status. |

**Installation:**
No new dependencies. All required data and functions already exist from Phases 30-32.

## Architecture Patterns

### Recommended Project Structure
```
src/
  handlers/
    review.ts                    # MODIFIED: delta classification, provenance threading, extended Review Details
  execution/
    review-prompt.ts             # MODIFIED: provenance annotation in retrieval context section
  lib/
    finding-dedup.ts             # POSSIBLY EXTENDED: export fingerprinting helper if needed (already used in review.ts)
    delta-classifier.ts          # NEW: classify findings as new/resolved/still-open
```

### Pattern 1: Delta Classification via Fingerprint Comparison
**What:** After extracting findings from the current review run, compare them against prior findings from the knowledge store using `filePath:titleFingerprint` composite keys. Each current finding is either `new` (not in prior set) or `still-open` (also in prior set). Prior findings NOT in the current set are `resolved`. This is a simple set-difference operation.
**When to use:** Only during incremental reviews (when `incrementalResult?.mode === "incremental"` and prior findings exist).
**Key insight:** The `fingerprintFindingTitle` function already exists in `review.ts` (duplicated from `store.ts`). Both use FNV-1a hashing on normalized title text. The composite key `filePath:titleFingerprint` is already used in `finding-dedup.ts` for suppression fingerprints -- the same approach works for delta classification.

```typescript
// Source: codebase analysis of existing finding-dedup.ts pattern
type DeltaStatus = "new" | "resolved" | "still-open";

type DeltaClassifiedFinding = ProcessedFinding & {
  deltaStatus: DeltaStatus;
};

type DeltaClassification = {
  current: DeltaClassifiedFinding[];
  resolved: Array<{
    filePath: string;
    title: string;
    severity: string;
    category: string;
  }>;
  counts: {
    new: number;
    resolved: number;
    stillOpen: number;
  };
};

function classifyFindingDeltas(params: {
  currentFindings: ProcessedFinding[];
  priorFindings: PriorFinding[];
  fingerprintFn: (title: string) => string;
}): DeltaClassification {
  // Build set of prior fingerprints
  const priorKeys = new Map<string, PriorFinding>();
  for (const prior of params.priorFindings) {
    const key = `${prior.filePath}:${prior.titleFingerprint}`;
    priorKeys.set(key, prior);
  }

  // Classify current findings
  const matchedPriorKeys = new Set<string>();
  const classified: DeltaClassifiedFinding[] = [];

  for (const finding of params.currentFindings) {
    const fp = params.fingerprintFn(finding.title);
    const key = `${finding.filePath}:${fp}`;
    const deltaStatus: DeltaStatus = priorKeys.has(key) ? "still-open" : "new";

    if (deltaStatus === "still-open") {
      matchedPriorKeys.add(key);
    }

    classified.push({ ...finding, deltaStatus });
  }

  // Prior findings not matched = resolved
  const resolved: DeltaClassification["resolved"] = [];
  for (const [key, prior] of priorKeys) {
    if (!matchedPriorKeys.has(key)) {
      resolved.push({
        filePath: prior.filePath,
        title: prior.title,
        severity: prior.severity,
        category: prior.category,
      });
    }
  }

  return {
    current: classified,
    resolved,
    counts: {
      new: classified.filter(f => f.deltaStatus === "new").length,
      resolved: resolved.length,
      stillOpen: classified.filter(f => f.deltaStatus === "still-open").length,
    },
  };
}
```

### Pattern 2: Provenance Threading from Retrieval to Output
**What:** The retrieval context already includes `distance`, `sourceRepo`, `outcome`, `findingText`, `severity`, and `category` for each retrieved memory. Currently, this data is only injected into the LLM prompt (via `buildRetrievalContextSection`). To make learning provenance visible to users, surface it in the deterministic Review Details comment. This does NOT require the LLM to output provenance -- the system knows which memories were retrieved and can deterministically format them.
**When to use:** Whenever retrieval context was injected into the prompt (retrievalCtx is non-null).

```typescript
// Thread retrieval context metadata into Review Details
function formatProvenanceSection(retrievalCtx: RetrievalContextForPrompt): string {
  if (retrievalCtx.findings.length === 0) return "";

  const lines: string[] = [
    "",
    "<details>",
    "<summary>Learning Provenance</summary>",
    "",
    "Findings below were informed by prior review patterns:",
    "",
  ];

  for (const finding of retrievalCtx.findings) {
    const distanceLabel = finding.distance <= 0.15 ? "high relevance"
      : finding.distance <= 0.25 ? "moderate relevance"
      : "low relevance";
    lines.push(
      `- [${finding.severity}/${finding.category}] "${finding.findingText}" ` +
      `(source: ${finding.sourceRepo}, outcome: ${finding.outcome}, ${distanceLabel})`
    );
  }

  lines.push("", "</details>");
  return lines.join("\n");
}
```

### Pattern 3: Unified Review Details with Delta + Provenance
**What:** The existing `formatReviewDetailsSummary` function in `review.ts` produces the deterministic Review Details comment. Extend it to include: (1) a delta summary section when in incremental mode, and (2) a provenance section when retrieval context was used. Both sections are collapsible `<details>` blocks nested inside the main Review Details comment. This ensures users can reconcile delta status and provenance in the same published output.
**When to use:** On every review run (delta section only in incremental mode; provenance section whenever retrieval was used).

```typescript
// Extended Review Details comment structure:
//
// <details>
// <summary>Review Details</summary>
//
// - Files reviewed: 12
// - Lines analyzed: 340
// - Lines changed: 340
// - Severity counts: critical 0, major 1, medium 2, minor 0
// - Suppressions applied: 0
// - Estimated review time saved: ~4 minutes
// - ...formula...
//
// ### Delta Summary                          <-- NEW (incremental only)
// - **New findings:** 2
// - **Resolved findings:** 1
// - **Still open:** 1
//
// Resolved:
// - [major/security] SQL injection risk (src/db.ts)
//
// </details>
//
// <details>                                  <-- NEW (when retrieval used)
// <summary>Learning Provenance</summary>
//
// This review was informed by 3 prior patterns:
// - [major/security] "SQL injection risk" (source: owner/other-repo, outcome: accepted, high relevance)
// - ...
//
// </details>
//
// <details>                                  <-- EXISTING
// <summary>Low Confidence Findings (...)</summary>
// - ...
// </details>
//
// <!-- kodiai:review-details:KEY -->
```

### Pattern 4: LLM Prompt Provenance Enhancement
**What:** Currently `buildRetrievalContextSection` tells the LLM about similar prior findings but does not ask it to cite provenance in its comments. Add a prompt instruction asking the LLM to mention when a finding mirrors a known prior pattern, using a simple annotation format like `(Prior pattern: [description])`. This is advisory, not enforced -- the deterministic provenance in Review Details is the authoritative source.
**When to use:** When retrieval context is non-empty.

```typescript
// Enhanced retrieval context section with provenance citation instruction
const lines: string[] = [
  "## Similar Prior Findings (Learning Context)",
  "",
  "The following are similar findings from prior reviews. Use them as context",
  "to inform your analysis, but evaluate each issue independently on current code.",
  "Do NOT copy prior findings -- only reference them if the same pattern exists in current changes.",
  "",
  "When a finding in your review directly relates to one of these prior patterns,",
  "append a brief provenance note at the end of your comment:",
  "`(Prior pattern: [brief description of the similar prior finding])`",
  "",
];
```

### Anti-Patterns to Avoid
- **Relying on the LLM to produce delta labels:** Delta classification MUST be deterministic and post-hoc. The LLM does not know about prior findings with enough precision to label delta status. The handler code already has all prior findings data.
- **Making delta classification block review publication:** Delta classification is a presentation-layer feature. If classification fails, publish without delta labels rather than blocking.
- **Treating `still-open` as a failure signal:** `still-open` findings are NOT necessarily bugs in the review system. They indicate the finding was present before and is still relevant (the code wasn't changed to fix it). This is useful information, not an error.
- **Creating a separate comment for provenance:** Success criterion 3 explicitly requires "reconcile delta status and provenance in the same published review output without separate tooling." Keep everything in the existing Review Details comment.
- **Including provenance for suppressed findings:** Only show provenance for findings that are actually visible to the user. Suppressed findings are already hidden; their provenance is noise.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Finding fingerprinting for delta comparison | New hash function | Existing `fingerprintFindingTitle()` FNV-1a | Already built, tested, and used for dedup in Phase 31 |
| Prior finding retrieval for delta comparison | New SQL query | Existing `knowledgeStore.getPriorReviewFindings()` | Already returns `PriorFinding[]` with filePath, title, titleFingerprint, severity, category |
| Review output comment publishing | New comment creation logic | Existing `upsertReviewDetailsComment()` and `formatReviewDetailsSummary()` | Already handles create-or-update semantics with HTML marker |
| Retrieval provenance data | New retrieval query | Existing `isolationLayer.retrieveWithIsolation()` returns `RetrievalWithProvenance` | Already has `provenance.repoSources`, `provenance.sharedPoolUsed`, and per-result `distance`, `sourceRepo` |

**Key insight:** Phase 33 is purely a presentation and classification layer. All the underlying data (prior findings, retrieval results with provenance, finding fingerprints, Review Details publishing) already exists. The work is: (1) build a `classifyFindingDeltas` function, (2) format delta + provenance into the existing Review Details template, and (3) optionally enhance the LLM prompt to cite provenance.

## Common Pitfalls

### Pitfall 1: Delta Classification on Full (Non-Incremental) Reviews
**What goes wrong:** Attempting delta classification on a full review (first review of the PR) where no prior findings exist produces meaningless results -- all findings would be labeled `new` and no findings `resolved`.
**Why it happens:** Delta classification only makes sense when comparing two review runs of the same PR.
**How to avoid:** Only perform delta classification when `incrementalResult?.mode === "incremental"` AND `priorFindings.length > 0`. On full reviews, omit the delta section entirely from Review Details.
**Warning signs:** Every finding on a first review labeled as `new` with 0 resolved -- this is technically correct but provides no value to the user.

### Pitfall 2: Resolved Findings from Suppressed Prior Findings
**What goes wrong:** A prior finding was suppressed (via config suppression pattern or dedup), so it wasn't visible to the user. If it doesn't appear in the current run, it gets labeled as `resolved`, which is misleading -- the user never saw it in the first place.
**Why it happens:** The `getPriorReviewFindings` query already filters `f.suppressed = 0`, so suppressed prior findings are excluded. But if the code changes and the current run also doesn't find it (because the issue was actually fixed), the user might not understand why it's in the `resolved` list.
**How to avoid:** Only include non-suppressed prior findings in the delta comparison (already done by the existing query). Add a note in the delta section: "Resolved findings were present in the prior review but not found in the current run."
**Warning signs:** Resolved list includes findings the user doesn't remember seeing.

### Pitfall 3: Provenance Section Becoming Too Long
**What goes wrong:** With topK=5 retrieved memories, the provenance section could add significant length to the Review Details comment, especially if finding texts are long.
**Why it happens:** No character budget on the provenance section.
**How to avoid:** Cap provenance entries at the retrieval topK (already bounded at 5 by default). Truncate individual finding text to 100 characters. The provenance section is inside a collapsible `<details>` block, so it doesn't clutter the visible summary.
**Warning signs:** Review Details comment exceeds GitHub's 65535-character limit for issue comments.

### Pitfall 4: Fingerprint Collision Causing Incorrect Delta Status
**What goes wrong:** Two different findings on the same file have the same FNV-1a title fingerprint (hash collision), causing one to be incorrectly classified as `still-open` instead of `new`.
**Why it happens:** FNV-1a is a 32-bit hash; collisions are statistically inevitable at scale.
**How to avoid:** For v0.5, this is an accepted limitation. The collision probability for <100 findings per PR is negligible (~1 in 4 billion per pair). If needed in the future, switch to a longer hash or add severity/category to the composite key.
**Warning signs:** Finding labeled `still-open` that doesn't match any visible prior finding.

### Pitfall 5: LLM Ignoring Provenance Citation Instruction
**What goes wrong:** The prompt asks the LLM to add `(Prior pattern: ...)` annotations, but the LLM doesn't comply.
**Why it happens:** Prompt instructions are advisory. The LLM may not consistently follow complex formatting instructions, especially when balancing many other prompt sections.
**How to avoid:** Don't rely on LLM provenance citations as the sole source of truth. The deterministic provenance section in Review Details is the authoritative source. LLM citations are a nice-to-have enhancement. If the LLM doesn't cite, the user can still see provenance in Review Details.
**Warning signs:** No `(Prior pattern: ...)` annotations in inline comments despite retrieval context being injected.

## Code Examples

Verified patterns from the existing codebase:

### Existing Prior Finding Fingerprint Generation (review.ts)
```typescript
// Source: src/handlers/review.ts (line 76-91)
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

### Existing Prior Finding Query (store.ts)
```sql
-- Source: src/knowledge/store.ts (line 381-397)
SELECT
  f.file_path, f.title, f.severity, f.category,
  f.start_line, f.end_line, f.comment_id
FROM findings f
INNER JOIN reviews r ON r.id = f.review_id
WHERE r.repo = $repo
  AND r.pr_number = $prNumber
  AND r.head_sha = (
    SELECT rs.head_sha FROM run_state rs
    WHERE rs.repo = $repo AND rs.pr_number = $prNumber AND rs.status = 'completed'
    ORDER BY rs.created_at DESC LIMIT 1
  )
  AND f.suppressed = 0
ORDER BY f.id ASC
LIMIT $limit
```

### Existing Review Details Comment Format (review.ts)
```typescript
// Source: src/handlers/review.ts (line 97-168) - formatReviewDetailsSummary
// Current format:
// <details>
// <summary>Review Details</summary>
//
// - Files reviewed: N
// - Lines analyzed: N
// - Lines changed: N
// - Severity counts: critical N, major N, medium N, minor N
// - Suppressions applied: N
// - Estimated review time saved: ~N minutes
// - Time-saved formula: ...
// </details>
//
// <details>
// <summary>Low Confidence Findings (threshold: N)</summary>
// - file.ts:42 [major] Finding title (confidence: 55)
// </details>
//
// <!-- kodiai:review-details:KEY -->
```

### Existing Retrieval Context Injection (review-prompt.ts)
```typescript
// Source: src/execution/review-prompt.ts (line 512-546) - buildRetrievalContextSection
// Currently builds a "## Similar Prior Findings (Learning Context)" section
// with finding text, severity, category, file path, and outcome.
// This section is injected into the LLM prompt but NOT into the Review Details comment.
```

### Existing Retrieval Provenance Data (isolation.ts)
```typescript
// Source: src/learning/isolation.ts (line 98-107)
// The isolation layer already returns full provenance:
const provenance = {
  repoSources: Array.from(repoSources),     // which repos contributed memories
  sharedPoolUsed: sharingEnabled && sharedResults.length > 0,  // was shared pool used
  totalCandidates: allCandidates.length,     // how many candidates before topK
  query: {
    repo,
    topK,
    threshold: distanceThreshold,
  },
};
// Each result also has: memoryId, distance, record.sourceRepo, record.findingText,
// record.severity, record.category, record.outcome
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Findings have no delta context | All findings listed without indicating what changed | Phase 31 (current) | Users must manually compare review runs to see what's new |
| Retrieval context is prompt-only | Retrieved memories inform the LLM but are invisible to users | Phase 31 (current) | Users can't verify why a finding was surfaced or how similar it is to prior patterns |
| Review Details shows aggregate metrics only | Counts, suppressions, low-confidence list | Phase 31 (current) | No per-finding delta or provenance information |

Phase 33 changes:
| Old Approach | New Approach | Impact |
|--------------|--------------|--------|
| Flat finding list | Delta-labeled findings (`new`, `resolved`, `still-open`) | Users immediately see what changed between incremental runs |
| Hidden retrieval context | Provenance section in Review Details | Users can verify and understand learning influence |
| Separate mental models | Unified Review Details with both delta + provenance | Single comment to reconcile all review intelligence |

**Deprecated/outdated:**
- None. Phase 33 extends existing output without replacing anything.

## Open Questions

1. **Delta Labels in Inline Comments vs Review Details Only**
   - What we know: Delta status can be surfaced either as a prefix on inline comments (`[NEW] [MAJOR] Finding...`) or only in the Review Details summary. Success criterion 1 says "incremental review summaries label findings" which suggests the summary is the primary surface.
   - What's unclear: Whether users also want delta labels on individual inline comments.
   - Recommendation: Surface delta labels in the Review Details summary as the primary location (meets SC1). Consider adding delta prefix to inline comments as a follow-up if users request it, but for v0.5 keep inline comments clean and consistent with the existing format.

2. **Provenance Granularity: Per-Finding vs Aggregate**
   - What we know: Retrieval returns top-K memories that informed the entire review prompt. The current architecture does not track which specific current finding was influenced by which specific retrieved memory -- retrieval is at the PR level, not the finding level.
   - What's unclear: Whether per-finding provenance attribution (this specific finding was influenced by that specific memory) is achievable without significant architecture changes.
   - Recommendation: For v0.5, surface provenance at the review level in the Review Details comment: "This review was informed by N prior patterns from [repos]." List all retrieved memories with their metadata. Do NOT attempt per-finding attribution (would require LLM cooperation or post-hoc semantic matching between findings and memories, both unreliable). The prompt-level provenance citation instruction (`Prior pattern: ...`) is the best-effort per-finding signal.

3. **Handling Dedup-Suppressed Findings in Delta Classification**
   - What we know: In incremental mode, some current findings are suppressed via dedup (they match a prior finding on unchanged code). These suppressed findings are effectively `still-open` but are not visible to the user.
   - What's unclear: Should dedup-suppressed findings appear in the delta summary as `still-open`? They were suppressed to avoid duplicate comments, but they're technically still present.
   - Recommendation: Dedup-suppressed findings should be counted as `still-open` in the delta summary counts, but not listed individually (since they're suppressed). Add a note: "N findings still open (suppressed to avoid duplicate comments)." This gives accurate counts without re-surfacing suppressed noise.

4. **`resolved` Label Accuracy**
   - What we know: A finding is labeled `resolved` when it was in the prior review but not in the current review. This could mean: (a) the developer fixed it, (b) the code was deleted, (c) the LLM simply didn't report it this time (non-determinism), or (d) the finding was suppressed in the current run.
   - What's unclear: How to distinguish true resolution (developer fixed) from LLM non-determinism or suppression.
   - Recommendation: Label it as `resolved` regardless of the reason, because the user-visible effect is the same: the finding is no longer flagged. Add a disclaimer in the delta summary: "Resolved findings were present in the prior review but not flagged in the current run." This is honest about the limitation without overcomplicating the logic.

## Sources

### Primary (HIGH confidence)
- Codebase: `src/handlers/review.ts` -- review handler with finding extraction, processing, Review Details publishing, learning memory write pipeline
- Codebase: `src/execution/review-prompt.ts` -- `buildIncrementalReviewSection`, `buildRetrievalContextSection`, review prompt construction
- Codebase: `src/lib/finding-dedup.ts` -- `buildPriorFindingContext`, `shouldSuppressFinding`, filePath:titleFingerprint composite key pattern
- Codebase: `src/lib/incremental-diff.ts` -- `computeIncrementalDiff` with mode/reason return type
- Codebase: `src/knowledge/store.ts` -- `getPriorReviewFindings`, `getLastReviewedHeadSha`, findings table schema, run_state table
- Codebase: `src/knowledge/types.ts` -- `PriorFinding`, `KnowledgeStore`, `FindingRecord` types
- Codebase: `src/learning/isolation.ts` -- `IsolationLayer.retrieveWithIsolation` with `RetrievalWithProvenance` return type
- Codebase: `src/learning/types.ts` -- `RetrievalWithProvenance`, `RetrievalResult`, `LearningMemoryRecord` types
- Phase 31 research: `.planning/phases/31-incremental-re-review-with-retrieval-context/31-RESEARCH.md`

### Secondary (MEDIUM confidence)
- GitHub REST API docs: Issue comment body limit is 65535 characters -- provenance section must be bounded
- GitHub Flavored Markdown: Nested `<details>` blocks render correctly in GitHub comments

### Tertiary (LOW confidence)
- None. All findings are based on direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries needed; all data and infrastructure already exists
- Architecture: HIGH -- patterns directly extend existing `formatReviewDetailsSummary`, `buildRetrievalContextSection`, and `classifyFindingDeltas` is a simple set-difference operation on existing data structures
- Pitfalls: HIGH -- identified from direct codebase analysis of data flow, fingerprint collision properties, and LLM non-determinism
- Delta classification: HIGH -- straightforward set comparison on existing `PriorFinding[]` vs `ProcessedFinding[]` using established fingerprint keys
- Provenance: MEDIUM-HIGH -- review-level provenance is straightforward from existing `RetrievalWithProvenance`; per-finding attribution is a known gap but explicitly scoped out for v0.5

**Research date:** 2026-02-13
**Valid until:** 2026-03-13 (stable domain; no external dependencies or fast-moving libraries)
