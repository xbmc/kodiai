# Phase 117: Claim Classification - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Post-LLM pass that classifies each finding's claims as diff-grounded, external-knowledge, or inferential. Classification results attach to findings for downstream severity demotion (Phase 118) and output filtering (Phase 119). Does NOT demote severity or filter output — only classifies.

</domain>

<decisions>
## Implementation Decisions

### Classification approach
- Hybrid: fast heuristic pass first, LLM second-pass for ambiguous cases
- Heuristic detects broad external-knowledge signals: specific version numbers, release dates, API behavior claims, behavioral assertions ("this library is known to..."), CVE references, performance characteristics, compatibility claims
- LLM second-pass triggers on heuristic-ambiguous findings (Claude determines exact threshold)
- Fail-open: if classification fails or times out, treat finding as diff-grounded (no downstream demotion/filtering). Consistent with enforcement and feedback suppression pipeline patterns

### Claim granularity
- Claim-level decomposition: findings are broken into individual claims, each classified independently
- Three-tier label taxonomy: `diff-grounded`, `external-knowledge`, `inferential`
  - `diff-grounded`: claim directly supported by what's visible in the diff
  - `external-knowledge`: claim asserts facts about versions, APIs, behavior not visible in the diff
  - `inferential`: logical inference from diff context (e.g., "removing this null check could cause NPE")
- Claim extraction approach: Claude's discretion (sentence-based vs semantic chunks)
- Each finding also gets a summary classification ("primarily diff-grounded", "primarily external", "mixed") for Phase 118 severity demotion

### Classification output shape
- Extend finding type via intersection pattern (like `EnforcedExtractedFinding`)
- Standalone module: `src/lib/claim-classifier.ts` — pure function, independently testable (follows `finding-dedup.ts`, `finding-prioritizer.ts`, `delta-classifier.ts` pattern)
- Per-claim data: structured objects with `{ text: string, label: 'diff-grounded' | 'external-knowledge' | 'inferential', evidence?: string, confidence: number }`
- Per-finding summary: `{ summaryLabel: 'primarily-diff-grounded' | 'primarily-external' | 'mixed', claims: ClaimClassification[] }`
- Classification results persisted to knowledge store alongside finding records (enables accuracy analysis over time)

### Diff context access
- Classifier receives: finding body text + full file diff (not just the hunk) + PR description + commit messages
- Diff provided as parsed structure (added/removed lines, context lines with line numbers) not raw patch text
- Classifier-specific lightweight diff parser — decoupled from review handler's existing `diffAnalysis`
- PR metadata (description, commit messages) is additional grounding context — a claim matching PR description text can be considered grounded

### Claude's Discretion
- Exact heuristic pattern set and regex implementation
- LLM second-pass trigger threshold (which findings are "ambiguous enough")
- Claim extraction method (sentence-based vs semantic decomposition)
- LLM prompt design for classification
- Confidence scoring calibration
- Parsed diff structure schema details

</decisions>

<specifics>
## Specific Ideas

- The pipeline insertion point is after `extractFindingsFromReviewComments` and after `applyEnforcement`, before suppression matching — classification needs the enforced finding data
- The `inferential` label captures a real middle ground: code review findings that are logical deductions from the diff (valid) but not directly quoting diff content. These should NOT be treated as external knowledge
- Evidence field on claim objects enables debugging: shows WHY a claim was classified that way (e.g., "version number '3.2.1' not found in diff")

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/finding-dedup.ts`: Pattern for standalone finding processing module with pure functions
- `src/lib/finding-prioritizer.ts`: Pattern for finding type extension and scoring
- `src/lib/delta-classifier.ts`: Pattern for classification logic with `FindingForDelta` / `DeltaClassifiedFinding` type pairs
- `src/enforcement/types.ts`: `EnforcedFinding` type shows intersection pattern for extending findings

### Established Patterns
- Pipeline extension via type intersection: `EnforcedExtractedFinding = ExtractedFinding & { ... }` at `review.ts:2958`
- Fail-open error handling: enforcement and feedback suppression both log warnings and return findings unchanged on error
- Finding extraction from review comments: `extractFindingsFromReviewComments` at `review.ts:842` returns `ExtractedFinding[]`
- Comment body access: `parseInlineCommentMetadata` at `review.ts:789` parses YAML metadata + body from comment text

### Integration Points
- Pipeline slot: after enforcement (`review.ts:2909-2918`), before suppression matching (`review.ts:2955-2976`)
- Finding type: `ExtractedFinding` (`review.ts:107-115`) has `commentId`, `filePath`, `title`, `severity`, `category`, `startLine?`, `endLine?`
- Diff data: `diffAnalysis` available in review handler scope with `filesByCategory`, `filesByLanguage`
- Knowledge store: `knowledgeStore` available in review handler for persisting classification results
- PR metadata: `pr.body` (description) and commit data accessible in review handler

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 117-claim-classification*
*Context gathered: 2026-03-02*
