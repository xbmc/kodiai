# Phase 22: Config Validation Safety - Research

**Researched:** 2026-02-11
**Domain:** Zod schema validation, forward-compatible config parsing, graceful degradation
**Confidence:** HIGH

## Summary

Phase 22 makes `.kodiai.yml` parsing forward-compatible and failure-resilient. The codebase currently uses Zod `.strict()` on four sub-schemas (`write`, `write.secretScan`, `mention`, `review.triggers`) which causes repos to break when unknown keys appear. Additionally, any validation error in any section causes total parse failure -- a typo in `write` config prevents reviews from running even if the `review` section is valid.

The fix is two changes to `src/execution/config.ts`: (1) remove all four `.strict()` calls, relying on Zod's default strip behavior to silently discard unknown keys, and (2) replace the single all-or-nothing `repoConfigSchema.parse()` call with a two-pass approach that attempts a full parse first, then falls back to section-by-section parsing with defaults for broken sections and structured warnings via Pino logger.

**Primary recommendation:** Remove `.strict()` from all sub-schemas and implement section-level `safeParse()` fallback in `loadRepoConfig()`. No new dependencies, no new files, no new modules.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | ^4.3.6 (installed) | Schema validation for `.kodiai.yml` | Already in use, provides `safeParse()`, `.default()`, strip-unknown-keys behavior |
| js-yaml | ^4.1.1 (installed) | YAML to JS object parsing | Already in use for `.kodiai.yml` loading |
| pino | ^10.3.0 (installed) | Structured JSON logging | Already in use throughout handlers and executor |

### Supporting
No new libraries needed. All behavior changes are achievable with existing Zod APIs.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Removing `.strict()` (strip behavior) | `.passthrough()` | Passthrough keeps unknown keys in output; strip discards them. Strip is correct here -- we don't want unknown keys flowing into typed `RepoConfig` objects. |
| Two-pass parse (full then section-by-section) | Zod `.catch()` on every field | `.catch()` would silently swallow ALL errors including critical ones like `review.enabled: 42`. Two-pass gives clear warning logs per-section while preserving valid sections. |
| Return type change (result union) | Keep throwing with better error messages | The phase requires graceful degradation (continue with defaults). Throwing means the caller must implement fallback. Better to handle it in `loadRepoConfig()` itself and return valid config + warnings. |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### File Structure (no new files)
```
src/
├── execution/
│   ├── config.ts          # MODIFY: remove .strict(), add two-pass parse
│   └── config.test.ts     # MODIFY: update strict-rejection tests, add new tests
└── lib/
    └── logger.ts           # NO CHANGE: already supports child loggers with context
```

### Pattern 1: Remove `.strict()` -- Rely on Default Strip Behavior
**What:** Zod `z.object()` without `.strict()` silently strips unrecognized keys during parse. The parsed output only contains schema-defined fields. This is the default Zod behavior.
**When to use:** User-facing config schemas where forward-compatibility matters.
**Verified:** YES -- tested with Zod ^4.3.6 installed in this project.

```typescript
// BEFORE (rejects unknown keys):
const mentionSchema = z.object({
  enabled: z.boolean().default(true),
  acceptClaudeAlias: z.boolean().default(true),
  prompt: z.string().optional(),
}).strict();
// Input { enabled: true, futureField: "x" } --> ZodError: Unrecognized key

// AFTER (strips unknown keys):
const mentionSchema = z.object({
  enabled: z.boolean().default(true),
  acceptClaudeAlias: z.boolean().default(true),
  prompt: z.string().optional(),
});
// Input { enabled: true, futureField: "x" } --> { enabled: true, acceptClaudeAlias: true }
```

**Locations to change (4 total in `src/execution/config.ts`):**
| Line | Sub-schema | Current |
|------|------------|---------|
| 41 | `write.secretScan` | `.strict()` |
| 44 | `write` | `.strict()` |
| 82 | `review.triggers` | `.strict()` |
| 111 | `mention` | `.strict()` |

The root `repoConfigSchema` and `review` sub-object already do NOT have `.strict()` -- no change needed there.

### Pattern 2: Two-Pass Graceful Degradation
**What:** First attempt full `repoConfigSchema.safeParse()`. If it succeeds, return immediately. If it fails, parse each section independently with `safeParse()`, using defaults for any section that fails. Log structured warnings for failed sections.
**When to use:** When partial config validity should not prevent the system from functioning.

```typescript
// Pseudocode for the two-pass approach:

// Pass 1: Try full parse (fast path -- covers 99% of cases)
const fullResult = repoConfigSchema.safeParse(parsed);
if (fullResult.success) return fullResult.data;

// Pass 2: Section-by-section fallback
const warnings: Array<{ section: string; issues: string[] }> = [];

const modelResult = z.string().default("claude-sonnet-4-5-20250929").safeParse(parsed?.model);
const model = modelResult.success ? modelResult.data : "claude-sonnet-4-5-20250929";

const reviewResult = reviewSchema.safeParse(parsed?.review);
let review: Review;
if (reviewResult.success) {
  review = reviewResult.data;
} else {
  warnings.push({ section: "review", issues: formatIssues(reviewResult.error) });
  review = reviewSchema.parse({});  // defaults
}

// ... repeat for write, mention, top-level fields ...

// Log warnings
for (const w of warnings) {
  logger.warn({ section: w.section, issues: w.issues }, "Config section invalid, using defaults");
}

return { model, maxTurns, timeoutSeconds, systemPromptAppend, review, write, mention };
```

### Pattern 3: Logger Integration for Config Warnings
**What:** Pass a logger (or accept an optional logger parameter) into `loadRepoConfig()` so section-level fallback warnings can be logged as structured JSON via Pino.
**When to use:** When `loadRepoConfig()` needs to report warnings without throwing.

The current signature is:
```typescript
export async function loadRepoConfig(workspaceDir: string): Promise<RepoConfig>
```

Options for adding warning output:
1. **Return warnings alongside config:** `Promise<{ config: RepoConfig; warnings: ConfigWarning[] }>`
2. **Accept logger parameter:** `loadRepoConfig(workspaceDir: string, logger?: Logger)`
3. **Hybrid:** Return warnings in return value AND log them if logger provided

**Recommended: Option 1 (return warnings).** This keeps `loadRepoConfig` pure (no side-effect logging), lets callers decide how to handle warnings (log, post comment, ignore), and is easy to test. The handler already has logger access and can log warnings after receiving them. The `executor.ts` also calls `loadRepoConfig` and already has a logger.

### Anti-Patterns to Avoid
- **Do NOT add a separate config validator module.** `loadRepoConfig()` already validates via Zod. Enhance it in-place. A separate pass duplicates logic and creates drift risk.
- **Do NOT use `.passthrough()` instead of removing `.strict()`.** Passthrough keeps unknown keys in the output object, which pollutes the typed `RepoConfig` and could leak into downstream logic. Default strip behavior is correct.
- **Do NOT use Zod `.catch()` on individual fields.** `.catch()` silently swallows ALL errors including type mismatches on critical fields. The two-pass approach gives section-level granularity with explicit warnings.
- **Do NOT add `.strict()` to the root schema.** The v0.3 research previously suggested this, but it directly contradicts CONFIG-01 (forward-compatibility). Unknown top-level keys should be stripped silently, just like sub-object keys.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unknown key rejection | Custom key-checking logic | Remove `.strict()` (Zod default strips unknown keys) | Zod's strip behavior is battle-tested and handles nested objects correctly |
| Section-level parse fallback | Custom recursive partial parser | Zod `safeParse()` per section with `.parse({})` for defaults | Each section schema already has `.default()` values; calling `.parse({})` yields correct defaults |
| Structured warning format | Custom warning class | Plain object `{ section: string; issues: string[] }` | Simple, serializable, easy to log via Pino |
| YAML parsing | Custom YAML handling | `js-yaml` (already used) | Already handles edge cases correctly |

**Key insight:** The existing Zod schema definitions already encode all defaults and validation rules. The graceful degradation pattern is just calling `.safeParse()` on existing sub-schemas independently instead of only on the root schema.

## Common Pitfalls

### Pitfall 1: Forgetting to Update Existing Tests That Assert Strict Rejection
**What goes wrong:** Three existing tests assert that unknown keys cause rejection: "rejects unsupported write keys" (line 120), "rejects unsupported mention keys" (line 155), "rejects unsupported review.triggers keys" (line 284). After removing `.strict()`, these tests will fail because unknown keys are now stripped instead of rejected.
**Why it happens:** Tests were written to verify `.strict()` behavior. The behavior is intentionally changing.
**How to avoid:** Update these three tests to assert the opposite -- unknown keys are silently stripped and valid fields are still parsed correctly. Also add new tests for the forward-compatibility success criteria.
**Warning signs:** Test failures in CI after removing `.strict()`.

### Pitfall 2: Breaking the `RepoConfig` Return Type
**What goes wrong:** If `loadRepoConfig()` changes its return type from `Promise<RepoConfig>` to `Promise<{ config: RepoConfig; warnings: ... }>`, every caller (3 call sites: `review.ts:282`, `mention.ts:319`, `executor.ts:27`) must be updated. Missing one creates a type error that may not be caught until CI.
**Why it happens:** TypeScript ensures type safety, but the change touches multiple files.
**How to avoid:** Run `bunx tsc --noEmit` after the change. All three call sites are known and listed. Consider whether to destructure at each call site or create a helper.
**Warning signs:** TypeScript errors mentioning `.review`, `.mention`, `.write` properties on the new return type.

### Pitfall 3: Section-Level Defaults Not Matching Current Defaults
**What goes wrong:** The two-pass fallback must produce EXACTLY the same defaults as the current schema when a section is invalid. If the fallback path constructs defaults differently from the Zod schema defaults, behavior changes silently.
**Why it happens:** Defaults are defined in two places: on each field's `.default()` call and in the parent object's `.default({...})` literal. These can drift.
**How to avoid:** Always use `sectionSchema.parse({})` to produce defaults for the fallback, never construct default objects manually. This guarantees the defaults match the schema definition.
**Warning signs:** Tests comparing default values start failing.

### Pitfall 4: YAML `null` vs Missing Keys
**What goes wrong:** In YAML, `write:` with no value parses as `{ write: null }`, not `{ write: undefined }`. Zod `.default()` only triggers for `undefined`, not `null`. So `write: null` would fail validation rather than using defaults.
**Why it happens:** js-yaml parses bare keys as `null`.
**How to avoid:** The existing schema already handles this correctly because `write:` by itself in YAML produces `null`, and the `.default()` on `write` handles this (Zod v4 treats `null` input to `.default()` as a validation error, which triggers the section-level fallback). Test this scenario explicitly.
**Warning signs:** Repos with `write:` (bare, no sub-keys) getting unexpected errors.

### Pitfall 5: Executor Also Calls loadRepoConfig
**What goes wrong:** `loadRepoConfig()` is called from both handlers (for trigger/permission checks) and from `executor.ts` (for model/maxTurns/timeout). If the return type changes, both code paths must be updated. The executor call site is easy to overlook.
**Why it happens:** Config is loaded twice per execution -- once in the handler, once in the executor.
**How to avoid:** Search for all `loadRepoConfig` call sites before and after the change. There are exactly 3: `review.ts:282`, `mention.ts:319`, `executor.ts:27`.
**Warning signs:** Runtime crash in executor with "config.model is undefined".

## Code Examples

Verified patterns from direct testing with Zod ^4.3.6 installed in this project:

### Example 1: Strip Unknown Keys (Default Behavior)
```typescript
// Verified: Zod z.object() without .strict() strips unknown keys
const schema = z.object({ name: z.string() });
schema.safeParse({ name: "test", extra: true });
// Result: { success: true, data: { name: "test" } }
// "extra" key is silently discarded
```

### Example 2: Section-Level safeParse Fallback
```typescript
// Verified: Section schemas can be parsed independently
const reviewSchema = z.object({
  enabled: z.boolean().default(true),
  autoApprove: z.boolean().default(true),
});
const writeSchema = z.object({
  enabled: z.boolean().default(false),
  denyPaths: z.array(z.string()).default([]),
});

const raw = {
  review: { enabled: true, autoApprove: false },      // valid
  write: { enabled: "bad-value", denyPaths: 42 },     // invalid
};

const rr = reviewSchema.safeParse(raw.review);
// rr.success = true, rr.data = { enabled: true, autoApprove: false }

const wr = writeSchema.safeParse(raw.write);
// wr.success = false (type errors)

// Fallback: produce defaults for broken section
const writeDefaults = writeSchema.parse({});
// writeDefaults = { enabled: false, denyPaths: [] }
```

### Example 3: Grouping ZodError Issues by Section
```typescript
// Verified: ZodError issues contain path arrays that can be grouped
const result = repoConfigSchema.safeParse(invalidInput);
if (!result.success) {
  const grouped: Record<string, z.ZodIssue[]> = {};
  for (const issue of result.error.issues) {
    const section = String(issue.path[0] ?? "root");
    if (!grouped[section]) grouped[section] = [];
    grouped[section].push(issue);
  }
  // grouped = { "write": [...], "review": [...] }
}
```

### Example 4: Nested Objects Without .strict() Preserve Defaults
```typescript
// Verified: Removing .strict() does not affect .default() behavior
const writeSchema = z.object({
  enabled: z.boolean().default(false),
  secretScan: z.object({
    enabled: z.boolean().default(true),
  }).default({ enabled: true }),   // no .strict() -- unknown keys stripped
}).default({ ... });               // no .strict() -- unknown keys stripped

writeSchema.parse(undefined);
// { enabled: false, secretScan: { enabled: true } }  -- correct defaults

writeSchema.parse({ enabled: true, futureKey: "hello" });
// { enabled: true, secretScan: { enabled: true } }  -- unknown key stripped
```

### Example 5: Return Type with Warnings
```typescript
// Recommended return type for loadRepoConfig
export interface ConfigWarning {
  section: string;
  issues: string[];
}

export interface LoadConfigResult {
  config: RepoConfig;
  warnings: ConfigWarning[];
}

export async function loadRepoConfig(
  workspaceDir: string,
): Promise<LoadConfigResult> {
  // ... implementation ...
  return { config, warnings };
}

// Caller usage (handler):
const { config, warnings } = await loadRepoConfig(workspace.dir);
for (const w of warnings) {
  logger.warn(
    { section: w.section, issues: w.issues, owner, repo },
    "Config section invalid, using defaults",
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `.strict()` on sub-schemas | Remove `.strict()`, use default strip | Phase 22 (now) | Forward-compatibility: repos can add future config keys without breaking |
| All-or-nothing `parse()` | Two-pass `safeParse()` with section fallback | Phase 22 (now) | Graceful degradation: one bad section doesn't break everything |
| Throw on config error | Return config + warnings | Phase 22 (now) | Callers can log warnings and continue instead of aborting |

**Deprecated/outdated:**
- Zod v4 deprecated `.strict()` in favor of `z.strictObject()`, but both work. Neither should be used on user-facing config schemas. The deprecation is irrelevant here since we're removing strictness entirely.

## Open Questions

1. **Should `loadRepoConfig` return warnings alongside config, or accept a logger parameter?**
   - What we know: Both patterns work. Returning warnings is more testable and keeps the function pure.
   - What's unclear: Whether any caller wants to do something with warnings besides logging (e.g., post a GitHub comment).
   - Recommendation: Return `{ config, warnings }`. Callers can log OR post comments as needed. The review handler already has error-comment posting infrastructure that could surface config warnings if desired.

2. **Should config warnings be surfaced as GitHub comments?**
   - What we know: The error handler already posts config errors as PR comments. Converting from total failure to warnings means the user might not see the warning in logs.
   - What's unclear: Whether a degraded config deserves a visible comment or just a server log.
   - Recommendation: For Phase 22, log warnings only (server-side). A future phase could add user-visible warnings as a non-blocking comment. Keep scope minimal.

3. **Should top-level scalar fields (model, maxTurns, timeoutSeconds) fall back individually or together?**
   - What we know: These fields are independent -- a bad `maxTurns` shouldn't prevent using a valid `model`.
   - What's unclear: Whether individual scalar fallback is worth the code complexity vs. treating all top-level scalars as one "group".
   - Recommendation: Parse each top-level scalar independently. The code is straightforward (one `safeParse` per field), and it maximizes resilience.

## Sources

### Primary (HIGH confidence)
- **Codebase inspection** (`src/execution/config.ts`) -- Verified `.strict()` on lines 41, 44, 82, 111. Verified root schema and `review` sub-object do NOT have `.strict()`. Verified 3 call sites for `loadRepoConfig`.
- **Codebase inspection** (`src/execution/config.test.ts`) -- Identified 3 tests asserting strict rejection that must be updated (lines 120, 155, 284).
- **Codebase inspection** (`src/handlers/review.ts`, `src/handlers/mention.ts`, `src/execution/executor.ts`) -- Verified all 3 `loadRepoConfig` call sites and their error handling patterns.
- **Direct Zod testing** (Zod ^4.3.6, installed in project) -- Verified strip-unknown-keys behavior, `safeParse()` with section-level parsing, `.parse({})` producing correct defaults, and error issue grouping by path.

### Secondary (MEDIUM confidence)
- **Prior v0.3 research** (`.planning/research/PITFALLS.md`, `.planning/research/STACK.md`, `.planning/research/ARCHITECTURE.md`) -- Pitfall 1 (strict forward-compatibility) and Pitfall 2 (config blocking critical paths) directly describe the problems this phase solves. Stack research confirms Zod v4 `.strict()` deprecation status.

### Tertiary (LOW confidence)
- None. All findings verified against codebase and direct testing.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new dependencies; all Zod APIs verified by direct testing in this project
- Architecture: HIGH -- Single-file change (`config.ts`) with well-understood two-pass pattern verified by testing
- Pitfalls: HIGH -- All pitfalls identified from codebase inspection (test files that need updating, call sites that need updating, default value consistency)

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (stable -- Zod API is not changing, codebase structure is well-understood)
