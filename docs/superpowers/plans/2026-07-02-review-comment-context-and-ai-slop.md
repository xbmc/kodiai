# Review Comment Context And AI Slop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent kodiai from leaking prior PR commenter identity/backlinks while making review comments advisory-only and flagging decorative AI-style code comments.

**Architecture:** Add narrow prompt contracts around review-comment retrieval context, sanitize review-comment source labels, and add a focused static detector for decorative or obvious comment blocks. Keep changes local to prompt/context formatting and review finding generation.

**Tech Stack:** Bun, TypeScript, existing `bun:test`, existing review prompt and review-orchestration modules.

---

### Task 1: Prior Review Comment Prompt Contract

**Files:**
- Modify: `src/execution/review-prompt.ts`
- Test: `src/execution/review-prompt.test.ts`
- Modify: `src/execution/mention-prompt.ts`
- Test: `src/execution/mention-prompt.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Add tests that build prompts with review-comment retrieval context and assert:
- prompt says prior review comments are advisory suggestions, not facts
- prompt says not to mention commenter handles
- prompt says not to link or cite previous PRs/comments publicly
- formatted review context does not include raw handles or PR backlink labels

- [ ] **Step 2: Run prompt tests to verify they fail**

Run: `bun test src/execution/review-prompt.test.ts src/execution/mention-prompt.test.ts`

- [ ] **Step 3: Implement prompt contract and source sanitization**

Update review/mention prompt construction and unified context formatting so review-comment context is labeled generically, keeps enough local evidence to reason, and removes public attribution/backlink instructions.

- [ ] **Step 4: Verify prompt tests pass**

Run: `bun test src/execution/review-prompt.test.ts src/execution/mention-prompt.test.ts`

### Task 2: Decorative/Useless Code Comment Detector

**Files:**
- Create or modify: `src/review-orchestration/comment-slop-detector.ts`
- Test: `src/review-orchestration/comment-slop-detector.test.ts`
- Modify integration path that turns deterministic findings into review candidates if one already exists.

- [ ] **Step 1: Write failing detector tests**

Cover:
- flags separator banners such as `// =====`
- flags header comments that restate the immediately following function/destructor
- does not flag terse comments that explain non-obvious intent

- [ ] **Step 2: Run detector tests to verify they fail**

Run: `bun test src/review-orchestration/comment-slop-detector.test.ts`

- [ ] **Step 3: Implement detector**

Add a pure function that accepts changed file text or diff-added lines and returns findings with file path, line, title, and message.

- [ ] **Step 4: Verify detector tests pass**

Run: `bun test src/review-orchestration/comment-slop-detector.test.ts`

### Task 3: Review Enforcement Integration

**Files:**
- Modify: `src/handlers/review.ts` or the existing deterministic review candidate pipeline
- Test: nearest existing review handler/orchestration test

- [ ] **Step 1: Write failing integration test**

Assert that a PR diff adding a decorative comment block produces a blocking/major review finding and prevents a clean approval path.

- [ ] **Step 2: Run integration test to verify it fails**

Run the focused review test containing the new case.

- [ ] **Step 3: Wire detector into review candidate generation**

Feed detector results into the existing finding path using current severity/category conventions.

- [ ] **Step 4: Verify integration and full changed tests pass**

Run focused tests, then `bunx tsc --noEmit` and `bun run lint`.

### Self-Review

Spec coverage: prior comments become advisory, no handles/backlinks, no trust-as-truth, and decorative AI-style comments are flagged. No placeholders remain. The plan keeps scope to prompt/context formatting and deterministic comment detection.
