# T04: 94-depends-pr-deep-review 04

**Slice:** S02 — **Milestone:** M019

## Description

Build the structured review comment builder and wire the complete [depends] deep-review pipeline into the review handler.

Purpose: This is the integration plan that connects detection (Plan 01), enrichment (Plan 02), and impact analysis (Plan 03) into a working end-to-end pipeline. When a `[depends]` PR is detected, the handler runs enrichment, builds a structured comment, posts it, and conditionally runs the standard Claude review if source code beyond build configs was changed.

Output: `src/lib/depends-review-builder.ts` with comment builder, updated `src/handlers/review.ts` with pipeline integration.

## Must-Haves

- [ ] "A [depends] PR triggers the deep-review pipeline and produces a structured comment"
- [ ] "A Dependabot PR still triggers only the existing Dependabot pipeline"
- [ ] "The review comment starts with a TL;DR verdict (safe/risky/needs-attention)"
- [ ] "The review comment includes version diff, changelog highlights, impact assessment, and hash verification"
- [ ] "If enrichment partially fails, the comment still posts with degradation notes"
- [ ] "If the PR touches source files beyond build configs, the standard Claude review runs IN ADDITION to the deep-review"
- [ ] "Inline review comments are posted on specific files with relevant findings (hash mismatches on cmake files)"
- [ ] "Past dependency context from retrieval (learning memories, wiki) surfaces in the review"

## Files

- `src/lib/depends-review-builder.ts`
- `src/lib/depends-review-builder.test.ts`
- `src/handlers/review.ts`
