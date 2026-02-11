# Phase 24: Enhanced Config Fields - Research

**Researched:** 2026-02-11
**Domain:** Repo-level `.kodiai.yml` configuration schema extension and handler enforcement
**Confidence:** HIGH

## Summary

Phase 24 adds new configuration fields to `.kodiai.yml` so repository owners can fine-tune Kodiai behavior: disabling reviews, restricting mentions to an allowlist, scoping write-mode paths, and controlling telemetry. The infrastructure for this phase is already mature -- Phase 22 established the two-pass safeParse config pattern with section-level graceful degradation, and Phase 23 built the telemetry foundation (SQLite store, fire-and-forget capture in both handlers).

A careful audit reveals that **most CONFIG requirements are already implemented** in the existing codebase. The schema definitions, handler enforcement logic, and tests already exist for CONFIG-03 through CONFIG-06 and CONFIG-08/CONFIG-09. The three requirements that remain unimplemented are CONFIG-07 (`mentions.allowedUsers`), CONFIG-10 (`telemetry.enabled`), and CONFIG-11 (`telemetry.costWarningUsd`). Additionally, CONFIG-04's skipPaths enforcement uses basic string matching rather than picomatch glob patterns, which limits the documented `["docs/**"]` pattern syntax from working correctly.

**Primary recommendation:** Focus implementation on the three genuinely new requirements (CONFIG-07, CONFIG-10, CONFIG-11), upgrade CONFIG-04's skipPaths matcher to use picomatch (already a project dependency), and add comprehensive tests for all requirements -- both pre-existing and new.

## Existing Implementation Inventory

This is critical context for the planner. Most CONFIG requirements already have working implementations.

### Already Implemented (schema + handler enforcement + tests exist)

| Requirement | Config Field | Schema Location | Handler Enforcement | Test Coverage |
|-------------|-------------|-----------------|---------------------|---------------|
| CONFIG-03 | `review.enabled: false` | `src/execution/config.ts:71` | `src/handlers/review.ts:323-336` | `src/execution/config.test.ts` (schema) |
| CONFIG-04 | `review.skipPaths: [...]` | `src/execution/config.ts:84` | `src/handlers/review.ts:418-439` | `src/execution/config.test.ts:217-229` (schema parse) |
| CONFIG-05 | `review.autoApprove: true/false` | `src/execution/config.ts:81` | `src/handlers/review.ts:542` | `src/handlers/review.test.ts` (approval tests) |
| CONFIG-06 | `mention.enabled: false` | `src/execution/config.ts:101` | `src/handlers/mention.ts:330-336` | `src/execution/config.test.ts` (schema) |
| CONFIG-08 | `write.allowPaths: [...]` | `src/execution/config.ts:15` | `src/jobs/workspace.ts:310-319` (via `enforceWritePolicy`) | `src/execution/config.test.ts:103-119` |
| CONFIG-09 | `write.denyPaths: [...]` | `src/execution/config.ts:17-31` | `src/jobs/workspace.ts:300-308` (via `enforceWritePolicy`) | `src/execution/config.test.ts:103-119` |

### NOT Yet Implemented (needs Phase 24 work)

| Requirement | Config Field | What's Missing |
|-------------|-------------|----------------|
| CONFIG-07 | `mentions.allowedUsers: ["alice"]` | No `allowedUsers` field in `mentionSchema`. No user-gating logic in mention handler. |
| CONFIG-10 | `telemetry.enabled: false` | No `telemetry` section in `repoConfigSchema` at all. No opt-out logic in handlers. |
| CONFIG-11 | `telemetry.costWarningUsd: 2.0` | No `telemetry` section in schema. No cost-warning logic after execution. |

### Needs Upgrade (partially implemented)

| Requirement | Issue | Current Behavior | Needed Behavior |
|-------------|-------|-----------------|-----------------|
| CONFIG-04 | `review.skipPaths` uses basic string matching | Supports `dir/` prefix, `*.ext` suffix, exact match only (review.ts:419-430) | Should use picomatch glob patterns like `"docs/**"` to match the documented syntax |

## Architecture Patterns

### Recommended Project Structure

No new files needed. All changes go into existing files:

```
src/
  execution/
    config.ts           # Add telemetry schema section + allowedUsers to mentionSchema
    config.test.ts      # Add schema tests for new fields
  handlers/
    review.ts           # Upgrade skipPaths to picomatch (if doing)
    review.test.ts      # Add review.enabled=false and skipPaths integration tests
    mention.ts          # Add allowedUsers gating logic
    mention.test.ts     # Add allowedUsers and telemetry integration tests
  telemetry/
    types.ts            # No change needed (TelemetryStore interface unchanged)
    store.ts            # No change needed
```

### Pattern 1: Config Schema Extension (Established)

**What:** Adding new fields to existing Zod schemas in `src/execution/config.ts`
**When to use:** Every new CONFIG requirement
**Key constraint:** Must follow the two-pass safeParse pattern from Phase 22

The existing pattern for adding a new section is:
1. Define the sub-schema with `.default()` at both field and section level
2. Add section to `repoConfigSchema`
3. Add section-level fallback in Pass 2 of `loadRepoConfig()`
4. Unknown keys are silently stripped (no `.strict()`)

```typescript
// Example from existing codebase -- mentionSchema pattern
const mentionSchema = z
  .object({
    enabled: z.boolean().default(true),
    acceptClaudeAlias: z.boolean().default(true),
    allowedUsers: z.array(z.string()).default([]),  // NEW: empty = all users
    prompt: z.string().optional(),
  })
  .default({ enabled: true, acceptClaudeAlias: true, allowedUsers: [] });
```

### Pattern 2: Handler Enforcement Gate (Established)

**What:** Early-return guard in handler after loading config
**When to use:** Every config-driven behavioral gate
**Key constraint:** Must log gate name, result, and skip reason for observability

```typescript
// Established pattern from review.ts and mention.ts
if (!config.review.enabled) {
  logger.info(
    {
      ...baseLog,
      gate: "review-enabled",
      gateResult: "skipped",
      skipReason: "review-disabled",
    },
    "Review disabled in config, skipping",
  );
  return;
}
```

### Pattern 3: Section-Level Fallback in Pass 2 (Established)

**What:** Each config section parsed independently so one bad section gets defaults + warning
**When to use:** Adding any new config section (like `telemetry`)
**Key constraint:** Must follow the same code shape as existing sections in `loadRepoConfig()`

```typescript
// Established pattern -- add new section in Pass 2
const telemetryResult = telemetrySchema.safeParse(obj.telemetry);
let telemetry: z.infer<typeof telemetrySchema>;
if (telemetryResult.success) {
  telemetry = telemetryResult.data;
} else {
  telemetry = telemetrySchema.parse({});
  warnings.push({
    section: "telemetry",
    issues: telemetryResult.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    ),
  });
}
```

### Pattern 4: Fire-and-Forget Post-Execution Logic (Established)

**What:** Non-blocking operations after executor.execute() completes
**When to use:** CONFIG-11 cost warning (post as comment after execution)
**Key constraint:** Must not block the critical path; wrap in try-catch

```typescript
// Established pattern from telemetry capture
try {
  telemetryStore.record({ ... });
} catch (err) {
  logger.warn({ err }, "Telemetry write failed (non-blocking)");
}
```

### Anti-Patterns to Avoid

- **Adding `.strict()` to schemas:** Phase 22 explicitly removed all `.strict()` for forward-compatibility. Never re-add.
- **Throwing on invalid config sections:** Always fall back to defaults with a warning. Never crash.
- **Blocking the critical path with telemetry/cost-warning logic:** Always fire-and-forget.
- **Hand-rolling glob matching:** Use picomatch (already a dependency) instead of custom string matching.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob pattern matching for skipPaths | Custom startsWith/endsWith logic (current review.ts:419-430) | `picomatch` (already in deps, used by workspace.ts) | picomatch handles `**`, `*`, `?`, brace expansion, dot files -- all edge cases the current code misses |
| Schema validation | Manual type checking | `zod` (already in deps) | Established pattern, gets type inference for free |
| YAML parsing | Manual parsing | `js-yaml` (already in deps) | Already used by loadRepoConfig |

**Key insight:** The project already has picomatch as a dependency (used in `workspace.ts` for write policy enforcement). The review handler's skipPaths matching is the only place still using basic string matching. Upgrading to picomatch gives consistent glob semantics across the entire config.

## Common Pitfalls

### Pitfall 1: Inconsistent Default Semantics for allowedUsers

**What goes wrong:** If `allowedUsers` defaults to `[]` but the handler treats empty array as "no users allowed" instead of "all users allowed", mentions break for every repo that doesn't set this field.
**Why it happens:** The semantics of an empty list are ambiguous -- does `[]` mean "nobody" or "everybody"?
**How to avoid:** Convention: empty `allowedUsers` array means "all users allowed" (no restriction). Only when the array is non-empty do we enforce. Document this clearly in schema comments.
**Warning signs:** After deploying, no repos respond to mentions.

### Pitfall 2: Telemetry Opt-Out Must Skip Both Record AND Cost Warning

**What goes wrong:** Setting `telemetry.enabled: false` suppresses telemetry recording but still posts a cost warning comment.
**Why it happens:** CONFIG-10 and CONFIG-11 are checked at different points in the handler flow.
**How to avoid:** Check `telemetry.enabled` FIRST. If false, skip both `telemetryStore.record()` AND cost warning evaluation.
**Warning signs:** Users who opt out of telemetry still see cost warning comments on their PRs.

### Pitfall 3: Cost Warning Fires on Every Execution

**What goes wrong:** If the cost warning check doesn't account for the threshold correctly, every execution posts a cost warning comment.
**Why it happens:** Not checking `costUsd > threshold` or using wrong comparison.
**How to avoid:** Only fire when `config.telemetry.costWarningUsd > 0 && result.costUsd !== undefined && result.costUsd > config.telemetry.costWarningUsd`.
**Warning signs:** Noisy PR comments after every review/mention.

### Pitfall 4: Pass 2 Forgetting to Add New Section

**What goes wrong:** Adding a new schema section (telemetry) to Pass 1 but forgetting to add the section-level fallback in Pass 2. Result: if the telemetry section has invalid values, the entire config falls back to defaults instead of just the telemetry section.
**Why it happens:** The two-pass pattern requires manual duplication -- each section must be handled in both Pass 1 (full schema) and Pass 2 (per-section fallback).
**How to avoid:** Checklist: (1) Add to `repoConfigSchema`, (2) Add section fallback block in Pass 2, (3) Add section to the assembled `config` object.
**Warning signs:** Setting `telemetry.enabled: notaboolean` causes ALL sections to fall back to defaults.

### Pitfall 5: SkipPaths Upgrade Breaking Existing Configs

**What goes wrong:** Upgrading skipPaths from basic string matching to picomatch changes the semantics of patterns like `*.md` (which the current code treats as "file ends with .md" but picomatch treats as "file named .md in the root only, not nested").
**Why it happens:** `*.md` in picomatch only matches one path segment. `**/*.md` matches nested paths.
**How to avoid:** The current code already handles `*.ext` with a startsWith check. When migrating to picomatch, either (a) auto-normalize `*.ext` patterns to `**/*.ext` for backward compatibility, or (b) document the change. Option (a) is safer.
**Warning signs:** Repos with `skipPaths: ["*.md"]` suddenly stop skipping nested markdown files.

### Pitfall 6: Cost Warning as PR Comment Creates Noise

**What goes wrong:** Posting a cost warning as a full issue comment on every expensive execution creates noise, especially if the threshold is set low.
**Why it happens:** No dedup or throttling on cost warning comments.
**How to avoid:** Post cost warning via `logger.warn()` always (for operator visibility), but only post as a GitHub comment when it's significant. Consider using a structured log message rather than a PR comment, unless the requirement explicitly demands a GitHub-visible warning.
**Warning signs:** PRs get flooded with cost warning comments.

## Code Examples

### Example 1: Adding allowedUsers to mentionSchema

```typescript
// In src/execution/config.ts
const mentionSchema = z
  .object({
    enabled: z.boolean().default(true),
    acceptClaudeAlias: z.boolean().default(true),
    /** If non-empty, only these GitHub users can trigger @kodiai mentions. Empty = all users. */
    allowedUsers: z.array(z.string()).default([]),
    prompt: z.string().optional(),
  })
  .default({ enabled: true, acceptClaudeAlias: true, allowedUsers: [] });
```

### Example 2: Enforcing allowedUsers in mention handler

```typescript
// In src/handlers/mention.ts, after config.mention.enabled check
if (config.mention.allowedUsers.length > 0) {
  const normalizedAuthor = mention.commentAuthor.toLowerCase();
  const allowed = config.mention.allowedUsers.map((u) => u.toLowerCase());
  if (!allowed.includes(normalizedAuthor)) {
    logger.info(
      {
        owner: mention.owner,
        repo: mention.repo,
        commentAuthor: mention.commentAuthor,
        gate: "mention-allowed-users",
        gateResult: "skipped",
        skipReason: "user-not-allowlisted",
      },
      "Mention author not in allowedUsers, skipping",
    );
    return;
  }
}
```

### Example 3: Adding telemetry section to config schema

```typescript
// In src/execution/config.ts
const telemetrySchema = z
  .object({
    /** If false, skip telemetry recording for this repo. Default: true. */
    enabled: z.boolean().default(true),
    /** If set and > 0, warn when execution cost exceeds this USD threshold. 0 = no warning. */
    costWarningUsd: z.number().min(0).default(0),
  })
  .default({ enabled: true, costWarningUsd: 0 });
```

### Example 4: Telemetry opt-out in handlers

```typescript
// In both review.ts and mention.ts, around the existing telemetry capture block
if (config.telemetry.enabled) {
  try {
    telemetryStore.record({ ... });
  } catch (err) {
    logger.warn({ err }, "Telemetry write failed (non-blocking)");
  }
}
```

### Example 5: Cost warning after execution

```typescript
// In both review.ts and mention.ts, after telemetry capture
if (
  config.telemetry.enabled &&
  config.telemetry.costWarningUsd > 0 &&
  result.costUsd !== undefined &&
  result.costUsd > config.telemetry.costWarningUsd
) {
  logger.warn(
    {
      costUsd: result.costUsd,
      threshold: config.telemetry.costWarningUsd,
      prNumber: pr.number,
    },
    "Execution cost exceeded warning threshold",
  );
  // Post cost warning comment to PR (fire-and-forget)
  try {
    const octokit = await githubApp.getInstallationOctokit(event.installationId);
    await octokit.rest.issues.createComment({
      owner: apiOwner,
      repo: apiRepo,
      issue_number: pr.number,
      body: `> **Kodiai cost warning:** This execution cost \$${result.costUsd.toFixed(4)} USD, which exceeds the configured threshold of \$${config.telemetry.costWarningUsd.toFixed(2)} USD.\n>\n> Configure this in \`.kodiai.yml\`:\n> \`\`\`yml\n> telemetry:\n>   costWarningUsd: 5.0  # or 0 to disable\n> \`\`\``,
    });
  } catch (err) {
    logger.warn({ err }, "Failed to post cost warning comment (non-blocking)");
  }
}
```

### Example 6: Upgrading skipPaths to picomatch

```typescript
// In src/handlers/review.ts, replacing the current basic matching
import picomatch from "picomatch";

// Normalize patterns for backward compatibility
function normalizeSkipPattern(pattern: string): string {
  const p = pattern.trim();
  if (p.endsWith("/")) return `${p}**`;        // "docs/" -> "docs/**"
  if (p.startsWith("*.")) return `**/${p}`;     // "*.md" -> "**/*.md"
  return p;
}

const skipMatchers = config.review.skipPaths
  .map(normalizeSkipPattern)
  .filter((p) => p.length > 0)
  .map((p) => picomatch(p, { dot: true }));

const changedFiles = allChangedFiles.filter((file) => {
  return !skipMatchers.some((m) => m(file));
});
```

## Requirement-to-Implementation Mapping

This maps each requirement to the specific files and code changes needed.

| Requirement | Files to Modify | Change Type | Effort |
|-------------|----------------|-------------|--------|
| CONFIG-03 | Tests only | Verify existing behavior, add integration tests | Low |
| CONFIG-04 | `review.ts` + tests | Upgrade skipPaths matcher from basic to picomatch | Medium |
| CONFIG-05 | Tests only | Verify existing behavior, add integration tests | Low |
| CONFIG-06 | Tests only | Verify existing behavior, add integration tests | Low |
| CONFIG-07 | `config.ts`, `mention.ts`, tests | Add allowedUsers field + handler gate | Medium |
| CONFIG-08 | Tests only | Verify existing behavior (write policy already enforces) | Low |
| CONFIG-09 | Tests only | Verify existing behavior (write policy already enforces) | Low |
| CONFIG-10 | `config.ts`, `review.ts`, `mention.ts`, tests | Add telemetry section + conditional telemetry recording | Medium |
| CONFIG-11 | `config.ts`, `review.ts`, `mention.ts`, tests | Add costWarningUsd + post-execution warning logic | Medium |

## Key Design Decisions for Planner

### 1. allowedUsers Semantics
- Empty array (`[]`) = all users allowed (no restriction)
- Non-empty array = only listed users can trigger mentions
- Matching is case-insensitive

### 2. Telemetry Section Location in Config
- New top-level section `telemetry:` (NOT nested under review or mention)
- Controls both review and mention telemetry
- `enabled: true` by default (existing behavior preserved)
- `costWarningUsd: 0` by default (no warning by default)

### 3. Cost Warning Delivery Mechanism
- Always log via `logger.warn()` for operator visibility
- Post as GitHub issue comment for user visibility
- Fire-and-forget (non-blocking)
- Only fires when: telemetry enabled AND threshold > 0 AND costUsd > threshold

### 4. SkipPaths Matcher Upgrade
- Replace basic string matching with picomatch
- Auto-normalize patterns for backward compatibility: `*.md` -> `**/*.md`, `docs/` -> `docs/**`
- The `normalizeGlobPattern` helper already exists in `workspace.ts:177-185` and handles the `dir/` -> `dir/**` case. Can reuse or extract a shared utility.

### 5. Pass 2 Handling
- The `telemetry` section must be added to both the `repoConfigSchema` (Pass 1) and the section-level fallback in `loadRepoConfig()` (Pass 2)
- The `mention` section already exists in Pass 2 -- only needs the `allowedUsers` field addition to the schema

## Open Questions

1. **Cost warning comment format**
   - What we know: The warning should appear when cost exceeds threshold
   - What's unclear: Should it be a standalone comment, a details/summary collapsible, or a log-only warning?
   - Recommendation: Use a concise standalone comment with `>` blockquote formatting (visible but not overwhelming). Keep it brief. This matches the established `wrapInDetails()` pattern from mention.ts but a blockquote is more appropriate for a warning vs. a full response.

2. **Whether to reuse `normalizeGlobPattern` from workspace.ts**
   - What we know: `workspace.ts:177-185` has `normalizeGlobPattern()` that handles `dir/` -> `dir/**` conversion
   - What's unclear: Whether to extract it as a shared utility or keep separate copies in review.ts and workspace.ts
   - Recommendation: Extract to a shared `src/lib/glob.ts` module OR duplicate in review.ts (the function is 5 lines). Since workspace.ts already exports other functions from the same file, extracting is cleaner but not strictly necessary. Planner's discretion.

## Sources

### Primary (HIGH confidence)
- `src/execution/config.ts` -- Complete Zod schema definitions for all existing config fields
- `src/execution/config.test.ts` -- 26 tests covering schema parsing, forward-compat, graceful degradation
- `src/handlers/review.ts` -- Review handler with CONFIG-03, CONFIG-04, CONFIG-05 enforcement
- `src/handlers/mention.ts` -- Mention handler with CONFIG-06 enforcement and write policy pass-through
- `src/jobs/workspace.ts` -- Write policy enforcement with picomatch for CONFIG-08, CONFIG-09
- `src/telemetry/store.ts` -- SQLite telemetry store (unchanged by this phase)
- `src/telemetry/types.ts` -- TelemetryStore and TelemetryRecord types

### Secondary (HIGH confidence -- project documentation)
- `.planning/phases/22-config-validation-safety/22-01-SUMMARY.md` -- Confirmed two-pass safeParse pattern decisions
- `.planning/phases/23-telemetry-foundation/23-VERIFICATION.md` -- Confirmed telemetry infrastructure is complete and wired

## Metadata

**Confidence breakdown:**
- Existing implementation inventory: HIGH -- Directly verified by reading source code
- New requirements (CONFIG-07, CONFIG-10, CONFIG-11): HIGH -- Clear schema pattern to follow, all infrastructure exists
- SkipPaths upgrade: HIGH -- picomatch already in deps and used in workspace.ts
- Cost warning delivery: MEDIUM -- Exact comment format is a design choice, not a technical risk

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (stable internal codebase, no external dependencies added)
