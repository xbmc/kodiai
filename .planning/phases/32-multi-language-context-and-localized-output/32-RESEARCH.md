# Phase 32: Multi-Language Context and Localized Output - Research

**Researched:** 2026-02-13
**Domain:** Programming language classification, per-language review guidance, LLM output localization
**Confidence:** HIGH

## Summary

Phase 32 adds three capabilities to Kodiai's review pipeline: (1) per-file programming language classification beyond TypeScript, (2) language-aware prompt guidance that injects language-specific review rules while preserving the canonical severity/category taxonomy, and (3) a `review.outputLanguage` config setting that localizes explanatory prose (finding descriptions, summary text) without modifying code identifiers or snippets.

The codebase is well-positioned for this work. The existing `analyzeDiff()` function in `src/execution/diff-analysis.ts` already classifies files by category (source/test/config/docs/infra) using picomatch glob patterns, and `buildReviewPrompt()` in `src/execution/review-prompt.ts` already has a modular section-builder pattern (e.g., `buildSeverityClassificationGuidelines()`, `buildNoiseSuppressionRules()`, `buildDiffAnalysisSection()`). The config system in `src/execution/config.ts` uses Zod schemas with defaults and section-level fallback parsing. All three integration points have clear extension paths that require no refactoring of existing code.

**Primary recommendation:** Use a hand-rolled extension-to-language map (no new dependencies), add a `buildLanguageGuidanceSection()` prompt builder, and add `review.outputLanguage` to the Zod config schema. All three features inject into the existing prompt pipeline with zero structural changes.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| picomatch | ^4.0.2 | Already used for file pattern matching in diff-analysis and review handler | In-tree, proven, zero-dependency |
| zod | ^4.3.6 | Already used for config schema validation | In-tree, proven |
| bun:test | built-in | Unit testing framework | Already used across all test files |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | - | - | - |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled extension map | `linguist-js` | linguist-js adds 27K weekly downloads dependency, requires folder-level analysis, ships full heuristic engine. Extension map is ~50 lines, covers the use case exactly, and avoids a runtime dependency |
| Hand-rolled extension map | `lang-map` | lang-map is unmaintained (last publish 10+ years ago), wraps GitHub Linguist YAML. Not worth a stale dependency |
| Prompt-based localization | i18n library (i18next, etc.) | Overkill. Output language applies to LLM prose generation, not to a static UI. A single prompt instruction line achieves the same result with zero library overhead |

**Installation:**
```bash
# No new dependencies required
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── execution/
│   ├── diff-analysis.ts        # MODIFY: Add filesByLanguage to DiffAnalysis, add language classifier
│   ├── review-prompt.ts        # MODIFY: Add buildLanguageGuidanceSection(), add outputLanguage section
│   ├── config.ts               # MODIFY: Add review.outputLanguage to schema
│   ├── diff-analysis.test.ts   # MODIFY: Add language classification tests
│   ├── review-prompt.test.ts   # MODIFY: Add language guidance + localization tests
│   └── config.test.ts          # MODIFY: Add outputLanguage config tests
├── handlers/
│   └── review.ts               # MODIFY: Wire language context into buildReviewPrompt call
└── (no new files required)
```

### Pattern 1: Extension-to-Language Mapping
**What:** A static `Record<string, string>` mapping file extensions to canonical programming language names, with a `classifyFileLanguage(filePath: string): string` utility.
**When to use:** During diff analysis, to tag each source file with its programming language.
**Example:**
```typescript
// Source: Codebase pattern from diff-analysis.ts categorization approach
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  py: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  cs: "C#",
  cpp: "C++",
  c: "C",
  h: "C",
  hpp: "C++",
  php: "PHP",
  scala: "Scala",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  sql: "SQL",
  // ...etc.
};

export function classifyFileLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return "Unknown";
  return EXTENSION_LANGUAGE_MAP[ext] ?? "Unknown";
}

export function classifyLanguages(files: string[]): Record<string, string[]> {
  const byLanguage: Record<string, string[]> = {};
  for (const file of files) {
    const lang = classifyFileLanguage(file);
    if (!byLanguage[lang]) byLanguage[lang] = [];
    byLanguage[lang].push(file);
  }
  return byLanguage;
}
```

### Pattern 2: Language-Specific Prompt Guidance
**What:** A `buildLanguageGuidanceSection()` function that takes the detected language distribution and emits language-specific review instructions.
**When to use:** When the prompt is assembled, injected between diff analysis and review instructions.
**Example:**
```typescript
// Source: Follows existing pattern from buildSeverityClassificationGuidelines()
const LANGUAGE_GUIDANCE: Record<string, string[]> = {
  Python: [
    "Check for mutable default arguments in function signatures.",
    "Verify proper use of context managers (with statements) for resource handling.",
    "Flag bare except clauses; prefer catching specific exceptions.",
  ],
  Go: [
    "Check that all error returns are handled (no _ discards without justification).",
    "Verify goroutine leaks: ensure channels are closed or contexts are cancelled.",
    "Flag uses of sync.Mutex without corresponding defer Unlock().",
  ],
  Rust: [
    "Check for unnecessary .unwrap() calls on Result/Option types.",
    "Verify lifetimes are not overly restrictive.",
    "Flag unsafe blocks without safety comments.",
  ],
  // TypeScript/JavaScript already covered by base rules
};

export function buildLanguageGuidanceSection(
  filesByLanguage: Record<string, string[]>,
): string {
  const languagesWithGuidance = Object.entries(filesByLanguage)
    .filter(([lang]) => LANGUAGE_GUIDANCE[lang])
    .sort(([, a], [, b]) => b.length - a.length); // Most files first

  if (languagesWithGuidance.length === 0) return "";

  const lines: string[] = ["## Language-Specific Guidance", ""];
  for (const [lang, files] of languagesWithGuidance) {
    lines.push(`### ${lang} (${files.length} file(s))`);
    for (const rule of LANGUAGE_GUIDANCE[lang]) {
      lines.push(`- ${rule}`);
    }
    lines.push("");
  }

  lines.push(
    "These language-specific rules supplement the severity classification. " +
    "Use the same CRITICAL/MAJOR/MEDIUM/MINOR severity scale and the same " +
    "category taxonomy (security, correctness, performance, error-handling, " +
    "resource-management, concurrency) for all findings regardless of language."
  );

  return lines.join("\n");
}
```

### Pattern 3: Output Language Localization via Prompt Instruction
**What:** A prompt section that instructs the LLM to write explanatory prose in the configured language while preserving code identifiers, snippets, severity labels, and category names in English.
**When to use:** When `review.outputLanguage` is set to a non-English value.
**Example:**
```typescript
// Source: Follows existing pattern from buildModeInstructions()
export function buildOutputLanguageSection(outputLanguage: string): string {
  if (!outputLanguage || outputLanguage.toLowerCase() === "en") return "";

  return [
    "## Output Language",
    "",
    `Write all explanatory prose, finding descriptions, and summary text in ${outputLanguage}.`,
    "",
    "IMPORTANT: The following MUST remain in English regardless of output language:",
    "- Severity labels: CRITICAL, MAJOR, MEDIUM, MINOR",
    "- Category labels: security, correctness, performance, error-handling, resource-management, concurrency",
    "- Code identifiers, variable names, function names, type names",
    "- Code snippets inside suggestion blocks",
    "- File paths",
    "- YAML metadata blocks (in enhanced mode)",
    "",
    "Only the human-readable explanation text should be localized.",
  ].join("\n");
}
```

### Anti-Patterns to Avoid
- **Over-engineering language detection:** Do not use ML-based language detection or content analysis. File extensions cover >95% of real-world cases. The remaining edge cases (extensionless files, polyglot files) are not worth the complexity.
- **Translating severity/category labels:** The canonical taxonomy MUST remain in English for downstream processing (confidence computation, knowledge store, finding dedup). Only explanatory prose is localized.
- **Per-language prompts:** Do not build separate prompts per language. Build one prompt with language-specific guidance sections. The LLM handles multi-language context naturally.
- **Hard-coding language guidance in the prompt builder:** Language guidance rules should be in a data structure (Record/Map), not inline in the builder function. This makes them testable and extensible without modifying control flow.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File extension parsing | Path manipulation library | `filePath.split(".").pop()` | Native string operations are simpler and the codebase already does this pattern |
| Glob matching | Custom glob engine | picomatch (already in tree) | Proven, tested, already a dependency |
| Config validation | Manual parsing | Zod (already in tree) | Type-safe, composable, already used everywhere |

**Key insight:** This phase requires zero new dependencies. The existing stack (picomatch, Zod, bun:test) covers all needs. The language detection is a simple map lookup. The localization is a prompt instruction. The guidance is a data-driven section builder.

## Common Pitfalls

### Pitfall 1: Taxonomy Drift in Localized Output
**What goes wrong:** When outputLanguage is set to non-English, the LLM may translate severity labels (e.g., "CRITICO" instead of "CRITICAL") or category names, breaking downstream parsing in `parseInlineCommentMetadata()` and confidence computation.
**Why it happens:** LLMs naturally localize all text unless explicitly constrained.
**How to avoid:** The outputLanguage prompt section MUST explicitly list what stays in English. Include severity labels, category labels, YAML metadata keys, and code identifiers in the "keep in English" list.
**Warning signs:** Confidence extraction returns null severity; knowledge store receives non-canonical category strings.

### Pitfall 2: Extension Collision
**What goes wrong:** `.h` files could be C or C++ or Objective-C. `.pl` could be Perl or Prolog.
**Why it happens:** Some extensions are ambiguous.
**How to avoid:** Pick a sensible default for ambiguous extensions (e.g., `.h` -> "C" since C++ guidance also covers C header patterns). Document the choice. Do NOT try to disambiguate via content analysis -- that's over-engineering for a prompt hint.
**Warning signs:** Users report wrong language-specific guidance for certain files.

### Pitfall 3: Prompt Size Bloat
**What goes wrong:** A PR with 15 different languages injects 15 guidance sections, bloating the prompt beyond context window budgets.
**Why it happens:** No cap on language sections.
**How to avoid:** Cap language guidance to the top 3-5 languages by file count. Add a truncation note similar to the existing path instructions truncation pattern.
**Warning signs:** Token count warnings from the SDK; model ignores later prompt sections.

### Pitfall 4: Breaking Backward Compatibility
**What goes wrong:** Existing repos without `review.outputLanguage` or without multi-language files get different behavior.
**Why it happens:** Default values not set correctly.
**How to avoid:** `outputLanguage` defaults to `"en"` (no-op). Language guidance is additive (new prompt section, not replacing existing). `filesByLanguage` is a new optional field on `DiffAnalysis` -- existing consumers ignore it.
**Warning signs:** Existing test suites fail after changes.

### Pitfall 5: Mixing Programming Language Detection with Natural Language Detection
**What goes wrong:** Confusing "language" contexts -- programming language (CTX-05/CTX-06) vs. output prose language (LANG-01) -- leads to muddled naming and wrong data flowing to wrong places.
**Why it happens:** Both use the word "language" but mean completely different things.
**How to avoid:** Use distinct naming: `programmingLanguage` / `fileLanguage` for code language detection, `outputLanguage` / `proseLanguage` for localization. Keep the two features in separate prompt sections.
**Warning signs:** Config field names are ambiguous; function parameters conflate the two concepts.

## Code Examples

Verified patterns from the existing codebase:

### Adding a New Section to DiffAnalysis (Pattern for filesByLanguage)
```typescript
// Source: src/execution/diff-analysis.ts -- existing pattern
export interface DiffAnalysis {
  filesByCategory: Record<string, string[]>;
  filesByLanguage: Record<string, string[]>; // NEW: per-language file grouping
  riskSignals: string[];
  metrics: { /* ... */ };
  isLargePR: boolean;
}
```

### Adding a New Config Field (Pattern for outputLanguage)
```typescript
// Source: src/execution/config.ts -- follows existing reviewSchema pattern
const reviewSchema = z.object({
  // ... existing fields ...
  /** Output language for review prose. "en" = English (default). */
  outputLanguage: z.string().default("en"),
});
```

### Adding a New Prompt Section (Pattern for language guidance)
```typescript
// Source: src/execution/review-prompt.ts -- follows buildDiffAnalysisSection pattern
// The prompt builder calls it like other optional sections:
const languageGuidance = context.filesByLanguage
  ? buildLanguageGuidanceSection(context.filesByLanguage)
  : "";
if (languageGuidance) lines.push("", languageGuidance);
```

### Wiring New Context Into the Review Handler
```typescript
// Source: src/handlers/review.ts -- follows diffAnalysis wiring pattern at line 1080
// After analyzeDiff, the filesByLanguage field is already on the result.
// Pass it through to buildReviewPrompt:
const reviewPrompt = buildReviewPrompt({
  // ... existing fields ...
  filesByLanguage: diffAnalysis.filesByLanguage,
  outputLanguage: config.review.outputLanguage,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-language review | Multi-language-aware review with per-language guidance | Phase 32 (new) | Better review quality for polyglot repos |
| English-only output | Configurable output language | Phase 32 (new) | Accessibility for non-English-speaking teams |
| No language classification | Extension-based language classification in DiffAnalysis | Phase 32 (new) | Foundation for future language-specific analysis |

**Deprecated/outdated:**
- No deprecated patterns. This is a net-new capability layered on existing architecture.

## Open Questions

1. **How many languages should have language-specific guidance initially?**
   - What we know: TypeScript/JavaScript is implicitly covered by existing rules. Python, Go, Rust, Java, C/C++ are the most common in code review contexts.
   - What's unclear: How many is enough for v1 vs. leaving room for user-contributed guidance.
   - Recommendation: Ship with 6-8 languages (Python, Go, Rust, Java, C/C++, Ruby, PHP, Swift). Make the guidance map a flat data structure that's easy to extend. Users can also add language-specific rules via `review.pathInstructions` for immediate customization.

2. **Should `outputLanguage` accept ISO 639-1 codes or full language names?**
   - What we know: LLMs understand both "ja" and "Japanese", "es" and "Spanish".
   - What's unclear: Whether validation should enforce a set list.
   - Recommendation: Accept free-form string, validate only that it's non-empty. The LLM interprets it. Users write what they know ("Japanese", "ja", "Espa\u00f1ol" all work). Do not enforce an enum -- it limits unnecessarily and adds no safety.

3. **Should language guidance be configurable per-repo?**
   - What we know: `review.pathInstructions` already provides per-path custom instructions.
   - What's unclear: Whether a dedicated `review.languageGuidance` config section is needed.
   - Recommendation: Defer. The built-in guidance covers common cases. Users can use `pathInstructions` with glob patterns like `**/*.py` to add language-specific rules now. A dedicated config section can come in a future phase if demand warrants it.

4. **What about the mention prompt (`buildMentionPrompt`)?**
   - What we know: The mention prompt does not currently include diff analysis or language context.
   - What's unclear: Whether `outputLanguage` should apply to mention responses too.
   - Recommendation: Apply `outputLanguage` to mention prompts as well. It's a single line addition. Language-specific guidance does NOT apply to mentions (no diff context).

## Existing Integration Points (Codebase Evidence)

### DiffAnalysis Extension Point
- **File:** `src/execution/diff-analysis.ts`
- **Current:** `analyzeDiff()` returns `DiffAnalysis` with `filesByCategory` (Record<string, string[]>)
- **Extension:** Add `filesByLanguage: Record<string, string[]>` to `DiffAnalysis` interface. Populate during the same file iteration loop that assigns categories (lines 202-224). The language classifier runs alongside category classification with zero extra file I/O.

### Review Prompt Extension Point
- **File:** `src/execution/review-prompt.ts`
- **Current:** `buildReviewPrompt()` assembles sections via helper functions. Accepts `diffAnalysis` optional param (line 522).
- **Extension:** Add `filesByLanguage?: Record<string, string[]>` and `outputLanguage?: string` to context. Add two new section builders. Insert between diff analysis section and "Reading the code" section.

### Config Extension Point
- **File:** `src/execution/config.ts`
- **Current:** `reviewSchema` contains all review settings with Zod defaults (lines 95-183).
- **Extension:** Add `outputLanguage: z.string().default("en")` to `reviewSchema`. Section-fallback parsing (lines 390-403) handles this automatically.

### Review Handler Wiring Point
- **File:** `src/handlers/review.ts`
- **Current:** `buildReviewPrompt()` call at line 1185 passes `diffAnalysis` and other enrichment data.
- **Extension:** Pass `filesByLanguage: diffAnalysis.filesByLanguage` and `outputLanguage: config.review.outputLanguage` to the call. Zero structural changes.

### Canonical Taxonomy (Must Not Change)
- **Severity levels:** `"critical" | "major" | "medium" | "minor"` (defined in `src/knowledge/types.ts` line 1, used in `src/execution/review-prompt.ts`, `src/handlers/review.ts`, `src/knowledge/confidence.ts`)
- **Category labels:** `"security" | "correctness" | "performance" | "style" | "documentation"` (defined in `src/knowledge/types.ts` lines 3-8)
- **Parsed by:** `parseInlineCommentMetadata()` in `src/handlers/review.ts` (lines 234-285) -- expects English severity/category strings
- **Consumed by:** `computeConfidence()`, `matchesSuppression()`, KnowledgeStore, learning memory
- **Impact:** If localization changes these strings, the entire post-processing pipeline breaks. Prompt MUST instruct LLM to keep them in English.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** -- Direct reading of all relevant source files:
  - `src/execution/diff-analysis.ts` (280 lines) -- file categorization, picomatch usage
  - `src/execution/review-prompt.ts` (783 lines) -- prompt assembly, section builder pattern
  - `src/execution/config.ts` (479 lines) -- Zod schema, section fallback parsing
  - `src/handlers/review.ts` (1813 lines) -- full review pipeline, wiring, finding extraction
  - `src/knowledge/types.ts` (165 lines) -- canonical severity/category types
  - `src/knowledge/store.ts` (778 lines) -- SQLite persistence, prepared statements
  - `src/learning/types.ts` (84 lines) -- memory store types, embedding provider
  - `src/learning/isolation.ts` (128 lines) -- retrieval isolation layer
  - `src/learning/memory-store.ts` (349 lines) -- vec0 virtual table, vector search
  - `src/execution/executor.ts` (255 lines) -- Claude SDK integration
  - `package.json` -- dependency inventory (picomatch, zod, pino, etc.)

- **Phase 31 verification** -- `.planning/phases/31-incremental-re-review-with-retrieval-context/31-VERIFICATION.md`
  - Confirmed all Phase 31 features are implemented and wired
  - Incremental review, retrieval context, fail-open patterns all operational

### Secondary (MEDIUM confidence)
- [GitHub Linguist](https://github.com/github-linguist/linguist) -- Reference for extension-to-language mapping data
- [linguist-js on npm](https://www.npmjs.com/package/linguist-js) -- 27K weekly downloads, but too heavyweight for extension-only lookup
- [lang-map on npm](https://www.npmjs.com/package/lang-map) -- Wraps Linguist YAML; last updated 10+ years ago; not suitable as a dependency

### Tertiary (LOW confidence)
- [LLM-based code review prompt engineering](https://www.sciencedirect.com/science/article/pii/S0950584924001289) -- Academic research on prompt engineering for code review; confirms structured prompt sections improve review quality
- [LLMs for localization](https://phrase.com/blog/posts/making-llms-work-for-multilingual-content/) -- Industry patterns for maintaining term consistency during localization

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new dependencies; all extensions use in-tree libraries
- Architecture: HIGH -- All integration points verified in source code; patterns follow existing codebase conventions
- Pitfalls: HIGH -- Taxonomy preservation risk is well-understood; existing `parseInlineCommentMetadata()` code confirms the downstream parsing dependency

**Research date:** 2026-02-13
**Valid until:** 2026-03-13 (stable -- no moving targets; all patterns are internal)
