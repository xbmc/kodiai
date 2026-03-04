# Phase 125: Voice-Preserving Updates - Research

**Researched:** 2026-03-03
**Domain:** LLM prompt engineering for style extraction and voice-preserving text generation
**Confidence:** HIGH

## Summary

Phase 125 modifies the update generation pipeline (Phase 123's output) to preserve existing wiki page formatting, voice, tone, and style. The implementation requires three LLM-driven components: (1) a style extraction pass that analyzes a page and produces a written style description, (2) few-shot exemplar selection from the page's own sections, and (3) a voice validation pass that compares generated suggestions against the original page voice.

The codebase already has all the infrastructure needed: `generateWithFallback` for non-agentic LLM calls, `TaskRouter` for model routing, `CostTracker` for cost tracking, `WikiPageStore.getPageChunks(pageId)` for retrieving full page content, and the `WikiPageChunk` type with section-level granularity (`sectionHeading`, `sectionAnchor`, `sectionLevel`, `chunkText`). No new dependencies, schema changes, or external libraries are required.

**Primary recommendation:** Implement as three new functions in a dedicated `wiki-voice-analyzer.ts` module that plugs into the Phase 123 update generation pipeline, using the existing `generateWithFallback` + `TaskRouter` pattern with new task types `voice.extract` and `voice.validate`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use BOTH explicit style description AND few-shot examples combined for maximum fidelity
- First pass: LLM analyzes the page and produces a written style description (tone, perspective, conventions)
- Second component: 2-3 representative sections from the page included as style exemplars in the generation prompt
- Per-page granularity (one style description per wiki page, not per-section)
- Style descriptions regenerated each run — no caching or schema changes needed
- Preserve ALL visible formatting: heading levels, list styles, code blocks, bold/italic patterns, link formats, whitespace between sections
- Wiki-specific markup (MediaWiki templates, infoboxes, magic words like `{{Note|...}}`) must be preserved verbatim
- Suggestions presented as full section rewrites (not inline diffs)
- Match the specific section's conventions, not page majority
- LLM self-evaluation pass compares generated suggestion against original sections
- Comprehensive check: tone, perspective, sentence structure, terminology consistency, formatting conventions
- On failure: regenerate once with validation feedback injected into prompt; if still below threshold, publish with internal 'voice mismatch' warning tag
- Voice match score is internal only — not included in published suggestion comments
- Update factual content: fix version numbers, API names, deprecated references
- Gently normalize obvious formatting inconsistencies while keeping overall voice
- Only use formatting elements the page already uses
- Content updates only within existing sections — don't add, remove, or reorder sections

### Claude's Discretion
- Voice match threshold value (what score triggers regeneration)
- Exact prompt structure for style extraction and generation
- How to select the 2-3 most representative sections for few-shot examples
- Internal logging and metrics for voice match quality tracking

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai (Vercel AI SDK) | existing | `generateText()` for non-agentic LLM calls | Already used by `generateWithFallback` — project mandate for non-agentic tasks |
| pino | existing | Structured logging | Project standard logger |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| generateWithFallback | internal | LLM call with automatic fallback and cost tracking | Every LLM invocation (style extract, voice validate) |
| TaskRouter | internal | Route task types to correct model/provider | Resolve model for new `voice.*` task types |
| CostTracker | internal | Track per-invocation LLM costs | Pass through from caller |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom LLM wrapper | `generateWithFallback` | No reason to diverge — existing wrapper handles fallback, cost tracking, and provider abstraction |

**Installation:**
No new packages needed. All infrastructure exists.

## Architecture Patterns

### Recommended Module Structure
```
src/knowledge/
├── wiki-voice-analyzer.ts      # Style extraction + validation (NEW)
├── wiki-voice-types.ts          # Types for voice analysis (NEW)
├── wiki-staleness-detector.ts   # Existing: identifies stale pages
├── wiki-store.ts                # Existing: page chunks storage
└── wiki-types.ts                # Existing: WikiPageChunk, WikiPageStore
```

### Pattern 1: Style Extraction as LLM Analysis Pass
**What:** A function that takes all chunks for a page and produces a structured style description string.
**When to use:** Before generating any update suggestions for a page.
**Example:**
```typescript
// Follows same pattern as evaluateWithLlm in wiki-staleness-detector.ts
export async function extractPageStyle(opts: {
  pageChunks: WikiPageRecord[];
  taskRouter: TaskRouter;
  costTracker?: CostTracker;
  logger: Logger;
}): Promise<PageStyleDescription> {
  const resolved = opts.taskRouter.resolve(TASK_TYPES.VOICE_EXTRACT);
  const result = await generateWithFallback({
    taskType: TASK_TYPES.VOICE_EXTRACT,
    resolved,
    prompt: buildStyleExtractionPrompt(opts.pageChunks),
    logger: opts.logger,
    costTracker: opts.costTracker,
  });
  return parseStyleDescription(result.text);
}
```

### Pattern 2: Few-Shot Exemplar Selection
**What:** Select 2-3 representative sections from the page to include as style exemplars.
**When to use:** As part of building the update generation prompt.
**Recommendation for Claude's Discretion:** Select sections by diversity — pick from different parts of the page (early, middle, late) to capture a range of the author's style. Prefer sections with at least 3 sentences and that contain formatting elements (lists, links, code blocks) representative of the page. Exclude very short sections (< 50 chars) and sections that are primarily tables or templates.
```typescript
export function selectExemplarSections(
  chunks: WikiPageRecord[],
  targetCount: number = 3,
): WikiPageRecord[] {
  // Group chunks by sectionHeading
  // Filter out very short sections (< 50 chars)
  // Select from spread positions (early, middle, late)
  // Prefer sections with formatting diversity (lists, links, code blocks)
}
```

### Pattern 3: Voice Validation as Post-Generation Check
**What:** A function that compares a generated suggestion against the original page content and scores voice fidelity.
**When to use:** After generating each section-level suggestion, before returning it.
**Example:**
```typescript
export async function validateVoiceMatch(opts: {
  originalSection: string;
  generatedSuggestion: string;
  styleDescription: string;
  taskRouter: TaskRouter;
  costTracker?: CostTracker;
  logger: Logger;
}): Promise<VoiceValidationResult> {
  const resolved = opts.taskRouter.resolve(TASK_TYPES.VOICE_VALIDATE);
  const result = await generateWithFallback({
    taskType: TASK_TYPES.VOICE_VALIDATE,
    resolved,
    prompt: buildVoiceValidationPrompt(opts),
    logger: opts.logger,
    costTracker: opts.costTracker,
  });
  return parseVoiceValidation(result.text);
}
```

### Pattern 4: Retry-With-Feedback Loop
**What:** On voice validation failure, regenerate once with feedback injected into prompt.
**When to use:** When voice match score is below threshold.
**Example:**
```typescript
// Generate suggestion
let suggestion = await generateSuggestion(prompt);
let validation = await validateVoiceMatch({ ... });

if (!validation.passed) {
  // Regenerate with feedback
  suggestion = await generateSuggestion(
    buildPromptWithFeedback(prompt, validation.feedback)
  );
  validation = await validateVoiceMatch({ ... });
  if (!validation.passed) {
    suggestion.voiceMismatchWarning = true; // internal tag
  }
}
```

### Anti-Patterns to Avoid
- **Caching style descriptions across runs:** User explicitly decided regeneration each run — no schema changes
- **Section-level style descriptions:** User decided per-page granularity
- **Including voice match scores in published output:** User explicitly said internal only
- **Adding/removing/reordering sections:** Content updates within existing sections only
- **Introducing new formatting elements:** Only use what the page already has

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM calls with fallback | Custom HTTP client | `generateWithFallback` | Already handles 429/5xx/timeout, cost tracking, provider abstraction |
| Model routing | Hardcoded model IDs | `TaskRouter.resolve()` | Respects config.json model overrides, supports wildcard patterns |
| Page content retrieval | Direct SQL queries | `WikiPageStore.getPageChunks(pageId)` | Already orders by chunk_index, handles deleted/stale flags |
| Cost tracking | Manual logging | `CostTracker` | Unified per-invocation tracking, already integrated with generateWithFallback |

**Key insight:** All LLM infrastructure is mature. This phase is purely prompt engineering and pipeline integration — no framework work needed.

## Common Pitfalls

### Pitfall 1: MediaWiki Markup Destruction
**What goes wrong:** LLM converts MediaWiki markup (templates, infoboxes, magic words) to markdown or strips it entirely.
**Why it happens:** LLMs are trained heavily on markdown and default to it when generating formatted text.
**How to avoid:** Style extraction prompt must explicitly catalog MediaWiki-specific markup found on the page. Generation prompt must include explicit "PRESERVE VERBATIM" instructions for templates. Validation pass checks for template/markup preservation.
**Warning signs:** `{{` or `}}` counts differ between original and suggestion, or markdown syntax appears where MediaWiki syntax was used.

### Pitfall 2: Voice Averaging Across Sections
**What goes wrong:** Generated suggestion uses the page's "average" voice instead of matching the specific section's conventions.
**Why it happens:** Style description covers the whole page; generator may ignore section-specific patterns (e.g., section 3 uses bullets, section 5 uses numbered lists).
**How to avoid:** Include the original section content as the PRIMARY voice reference in the generation prompt, with the page-level style description as SECONDARY context. The validation prompt should compare against the specific original section, not the page-level style.
**Warning signs:** Bullet lists in a section that originally used numbered lists, or vice versa.

### Pitfall 3: Over-Normalization
**What goes wrong:** Suggestions "fix" intentional style variations (e.g., a section that uses a different heading style for a specific purpose).
**Why it happens:** The style description captures the dominant pattern, and the LLM "normalizes" outliers.
**How to avoid:** The "gently normalize obvious formatting inconsistencies" directive should be limited to capitalization and spacing, not structural formatting choices. If a section deviates from the page pattern, preserve the deviation.
**Warning signs:** Suggestions that make a previously-unique section look like all other sections.

### Pitfall 4: Prompt Token Budget Explosion
**What goes wrong:** Including full page content + style description + exemplar sections + validation context exceeds context window or drives up costs.
**Why it happens:** Wiki pages can be large (many chunks), and including 2-3 exemplar sections plus the target section plus the style description is substantial.
**How to avoid:** Cap exemplar sections at ~2000 tokens total. Use the page's first 5-6 chunks for style extraction (not entire page if very long). Track token counts via CostTracker.
**Warning signs:** Individual voice.extract calls costing >$0.10 or taking >30s.

### Pitfall 5: Hallucinated Formatting Elements
**What goes wrong:** LLM introduces formatting that the page doesn't use (e.g., adds code blocks to a prose-only page, or adds tables where none exist).
**Why it happens:** LLM "helps" by adding structure it thinks would be useful.
**How to avoid:** Style description explicitly lists which formatting elements ARE used. Generation prompt says "ONLY use formatting elements listed in the style description." Validation checks for new formatting types.
**Warning signs:** HTML tags, markdown code fences, or table markup appearing in suggestions for pages that don't use them.

## Code Examples

### Adding New Task Types
```typescript
// In src/llm/task-types.ts
export const TASK_TYPES = {
  // ... existing types
  /** Voice/style extraction from wiki page (non-agentic). */
  VOICE_EXTRACT: "voice.extract",
  /** Voice match validation for generated suggestions (non-agentic). */
  VOICE_VALIDATE: "voice.validate",
} as const;
```

### Style Extraction Prompt Structure
```typescript
const prompt = `Analyze the writing style, voice, and formatting conventions of this wiki page.

Page title: "${pageTitle}"

Page content (representative sections):
${exemplarText}

Produce a style description covering:
1. TONE: Formal/informal, technical level, audience assumed
2. PERSPECTIVE: Second person ("you"), imperative ("do X"), third person, passive voice
3. SENTENCE STRUCTURE: Short/long, simple/complex, fragments allowed?
4. TERMINOLOGY: Specific terms used consistently (list them)
5. FORMATTING CONVENTIONS:
   - Heading style (level usage, capitalization)
   - List style (bullets vs numbered, nesting)
   - Code formatting (inline code, code blocks, languages)
   - Link style (bare URLs, named links, wiki links)
   - Emphasis patterns (bold, italic, when used)
   - MediaWiki-specific markup found: templates, infoboxes, magic words (list each with exact syntax)
6. STRUCTURAL PATTERNS: How sections begin/end, transition phrases, paragraph length

Output as plain text description, not JSON.`;
```

### Voice Validation Prompt Structure
```typescript
const prompt = `Compare this generated wiki section update against the original section and style description.

ORIGINAL SECTION:
${originalSection}

STYLE DESCRIPTION:
${styleDescription}

GENERATED SUGGESTION:
${generatedSuggestion}

Score the voice match on these dimensions (1-5 each):
- TONE_MATCH: Does the tone match? (formal/informal, technical level)
- PERSPECTIVE_MATCH: Same perspective? (you/imperative/third person)
- STRUCTURE_MATCH: Similar sentence patterns and paragraph structure?
- TERMINOLOGY_MATCH: Uses same terms consistently?
- FORMATTING_MATCH: Same heading/list/code/link conventions?
- MARKUP_PRESERVATION: All MediaWiki templates/markup preserved exactly?

Overall voice match: PASS (avg >= 3.5) or FAIL (avg < 3.5)

If FAIL, explain specifically what doesn't match and how to fix it.

Output format:
TONE_MATCH: N
PERSPECTIVE_MATCH: N
STRUCTURE_MATCH: N
TERMINOLOGY_MATCH: N
FORMATTING_MATCH: N
MARKUP_PRESERVATION: N
OVERALL: PASS|FAIL
FEEDBACK: [specific issues if FAIL]`;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-prompt generation | Style-extract + few-shot + validate pipeline | 2024-2025 | Much higher voice fidelity via explicit style analysis |
| Rule-based style matching | LLM self-evaluation | 2024-2025 | Handles nuance that regex/rules cannot |
| Full-page regeneration | Section-level rewrites | Established pattern | Smaller blast radius, easier to review |

**Deprecated/outdated:**
- None applicable — this is prompt engineering, not library-dependent.

## Open Questions

1. **Voice match threshold value**
   - What we know: User left as Claude's discretion. 3.5/5.0 average is a reasonable default.
   - What's unclear: Optimal threshold depends on wiki page diversity. May need tuning.
   - Recommendation: Use 3.5 as default. Log all scores for future analysis. Make threshold configurable via constant.

2. **Exemplar section selection heuristic**
   - What we know: Need 2-3 sections. Should be representative.
   - What's unclear: What makes a section "representative" varies by page.
   - Recommendation: Select by position diversity (early/middle/late), minimum length (>50 chars), and formatting diversity (prefer sections with varied formatting). This is a pure code heuristic — no LLM needed.

3. **Token budget for style extraction**
   - What we know: Wiki pages vary from a few hundred tokens to tens of thousands.
   - What's unclear: How much content is needed for accurate style extraction.
   - Recommendation: Use first 5-6 chunks (or ~3000 tokens) for style extraction. This captures the page's dominant patterns without excessive cost.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/llm/generate.ts`, `src/llm/task-types.ts`, `src/llm/task-router.ts` — verified LLM call patterns
- Codebase analysis: `src/knowledge/wiki-staleness-detector.ts` — verified two-tier LLM evaluation pattern
- Codebase analysis: `src/knowledge/wiki-types.ts`, `src/knowledge/wiki-store.ts` — verified chunk/section data model

### Secondary (MEDIUM confidence)
- Prompt engineering best practices for style preservation — based on established LLM prompt patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all infrastructure exists, no new dependencies
- Architecture: HIGH — follows established codebase patterns exactly
- Pitfalls: HIGH — derived from concrete wiki-specific formatting challenges

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable — prompt engineering patterns, not library-dependent)
