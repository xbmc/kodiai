# Add-on Model Review Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make large Kodi add-on submissions receive a complete, schema-backed model rule review with validated `path:line` findings through the existing OAuth deployment.

**Architecture:** Add a focused structured-generation adapter for non-agentic Claude Agent SDK calls, with correct Haiku routing and one OAuth-aware Sonnet fallback. Project unified patches into exact right-side added-line evidence, pack chunks against the fully rendered prompt ceiling, validate native structured output against the original diff, and preserve the existing deterministic synthesis and concise public comment.

**Tech Stack:** TypeScript, Bun test runner, Claude Agent SDK native JSON schema, Pino structured logging, existing Kodi add-on review pipeline, Docker, Azure Container Apps.

## Global Constraints

- Primary model is exactly `claude-haiku-4-5-20251001`.
- Structured fallback stays on Claude Agent SDK with the configured Sonnet model and the existing `CLAUDE_CODE_OAUTH_TOKEN` path.
- No `ANTHROPIC_API_KEY` is introduced or required.
- Structured classifier requests use no tools, a minimal string system prompt, `maxTurns: 3`, and SDK-native `outputFormat: { type: "json_schema", schema }`.
- Only a successful SDK result containing `structured_output` is accepted; partial assistant prose is never accepted.
- Each evidence chunk receives at most two model calls: one Haiku primary attempt and one Sonnet fallback attempt for a classified retryable failure.
- The complete rendered prompt, not patch characters alone, is capped at exactly `28_000` characters per chunk.
- Model evidence contains every bounded added line with its right-side line number; deleted and unchanged lines are not sent.
- A source line that cannot fit alone is omitted, makes model coverage incomplete, and is never logged.
- Model findings are accepted only for changed paths and exact added-line coordinates present in the original diff.
- Existing deterministic checks, checker findings, generic-review suppression, concise comment format, canonical publication, and human-approval boundary remain unchanged.
- Production deployment is pinned to the exact verified source commit.

---

## File structure

- `src/llm/task-router.ts`: correct the default Haiku model snapshot.
- `src/llm/task-router.test.ts`: lock primary and fallback model IDs.
- `src/llm/pricing.json`: price the supported Haiku snapshot.
- `src/llm/structured-generate.ts`: isolated Agent SDK JSON-schema execution, deadline normalization, validation, OAuth-aware fallback, cost tracking, and bounded attempt telemetry.
- `src/llm/structured-generate.test.ts`: mock SDK streams and prove configuration, success, timeout, partial-result rejection, fallback, and exact attempt budgets.
- `src/llm/index.ts`: export the structured-generation interface.
- `src/lib/addon-rule-evidence.ts`: parse unified patches into line-numbered evidence and pack complete prompts under the ceiling.
- `src/lib/addon-rule-evidence.test.ts`: right-side coordinate, multi-hunk, packing, oversized-line, and single-large-file tests.
- `src/lib/addon-rule-llm.ts`: evidence-oriented prompt, native JSON schema, and domain validation of unknown structured output.
- `src/lib/addon-rule-llm.test.ts`: prompt scope, schema, grounding, and unsafe-output tests.
- `src/lib/addon-rule-review.ts`: structured chunk orchestration, aggregation, completeness, and bounded logging.
- `src/lib/addon-rule-review.test.ts`: mixed success/failure, all-success, exact attempt ownership, and line-retention tests.
- `src/handlers/addon-check.test.ts`: contributor-facing regression coverage through the specialized handler.
- `CHANGELOG.md`: record the complete schema-backed add-on review behavior.

### Task 1: Correct the Haiku model catalog

**Files:**
- Modify: `src/llm/task-router.ts:45-46`
- Modify: `src/llm/task-router.test.ts:5-18`
- Modify: `src/llm/pricing.json:3-8`

**Interfaces:**
- Produces: non-agentic default `ResolvedModel.modelId === "claude-haiku-4-5-20251001"`.
- Preserves: Sonnet remains the fallback for a default non-agentic task and Haiku remains the fallback for a default Sonnet task.

- [ ] **Step 1: Change router tests to require the supported snapshot**

```ts
test("uses supported Haiku as the distinct fallback for agentic Sonnet tasks", () => {
  const resolved = createTaskRouter({ models: {} }).resolve(TASK_TYPES.REVIEW_FULL);
  expect(resolved.modelId).toBe("claude-sonnet-4-5-20250929");
  expect(resolved.fallbackModelId).toBe("claude-haiku-4-5-20251001");
});

test("uses supported Haiku for non-agentic tasks", () => {
  const resolved = createTaskRouter({ models: {} }).resolve(TASK_TYPES.GUARDRAIL_CLASSIFICATION);
  expect(resolved.modelId).toBe("claude-haiku-4-5-20251001");
  expect(resolved.fallbackModelId).toBe("claude-sonnet-4-5-20250929");
});
```

- [ ] **Step 2: Run the router tests and confirm RED**

Run: `bun test src/llm/task-router.test.ts`

Expected: FAIL because the router still resolves `claude-haiku-4-5-20250929`.

- [ ] **Step 3: Update the default and pricing key**

```ts
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_HAIKU_MODEL = "claude-haiku-4-5-20251001";
```

Replace the old Haiku key in `src/llm/pricing.json` with:

```json
"claude-haiku-4-5-20251001": { "inputPerMillion": 0.80, "outputPerMillion": 4.00 }
```

- [ ] **Step 4: Run model catalog tests and confirm GREEN**

Run: `bun test src/llm/task-router.test.ts src/llm/pricing.test.ts`

Expected: PASS and `rg "claude-haiku-4-5-20250929" src/llm` returns no matches.

- [ ] **Step 5: Commit the model catalog correction**

```bash
git add src/llm/task-router.ts src/llm/task-router.test.ts src/llm/pricing.json
git commit -m "fix: route classifiers to supported Haiku"
```

### Task 2: Add bounded structured Agent SDK generation

**Files:**
- Create: `src/llm/structured-generate.ts`
- Create: `src/llm/structured-generate.test.ts`
- Modify: `src/llm/index.ts:48-56`

**Interfaces:**
- Produces: `generateStructuredWithFallback<T>(options: StructuredGenerateOptions<T>): Promise<StructuredGenerateResult<T>>`.
- Produces: `StructuredGenerationError` with `kind: StructuredFailureKind` and `retryable: boolean`.
- Consumes: `ResolvedModel`, JSON schema, `validate(output: unknown): T`, Logger, optional cost tracker, and an injected SDK query loader for tests.
- Preserves: existing `generateWithFallback` behavior for all callers that do not opt into structured generation.

- [ ] **Step 1: Write failing SDK configuration and success tests**

Create a mock async SDK stream that captures query options and yields a successful result:

```ts
const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
const query = ((input: { prompt: string; options: Record<string, unknown> }) => {
  calls.push(input);
  return (async function* () {
    yield {
      type: "result",
      subtype: "success",
      structured_output: { summary: "Reviewed.", findings: [] },
      modelUsage: {},
      duration_ms: 12,
      total_cost_usd: 0,
    };
  })();
}) as never;

const result = await generateStructuredWithFallback({
  taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
  resolved: createTaskRouter({ models: {} }).resolve(TASK_TYPES.GUARDRAIL_CLASSIFICATION),
  prompt: "bounded prompt",
  system: "Kodi add-on submission-rule classifier. Use only supplied evidence.",
  schema: { type: "object", required: ["summary", "findings"] },
  validate: (value) => value as { summary: string; findings: unknown[] },
  logger,
  loadQuery: async () => query,
});

expect(result.output).toEqual({ summary: "Reviewed.", findings: [] });
expect(calls[0]?.options).toMatchObject({
  model: "claude-haiku-4-5-20251001",
  maxTurns: 3,
  systemPrompt: "Kodi add-on submission-rule classifier. Use only supplied evidence.",
  allowedTools: [],
  disallowedTools: [],
  outputFormat: { type: "json_schema", schema: expect.any(Object) },
});
expect(calls[0]?.options.systemPrompt).not.toEqual(expect.objectContaining({ preset: "claude_code" }));
```

- [ ] **Step 2: Write failing unsuccessful-result, timeout, and fallback tests**

Use injected query implementations and assert:

```ts
// Partial prose without a success result is rejected.
expect(generateStructuredWithFallback(partialAssistantOptions))
  .rejects.toMatchObject({ kind: "missing-structured-output" });

// A deadline abort reported by the SDK as a user abort becomes a timeout.
expect(generateStructuredWithFallback(deadlineAbortOptions))
  .rejects.toMatchObject({ kind: "timeout" });

// Retryable primary validation failure invokes Sonnet once through the same query loader.
expect(capturedModels).toEqual([
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-5-20250929",
]);
expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();

// A non-retryable external cancellation performs one call only.
expect(externalCancellationModels).toEqual(["claude-haiku-4-5-20251001"]);
```

- [ ] **Step 3: Run structured-generation tests and confirm RED**

Run: `bun test src/llm/structured-generate.test.ts`

Expected: FAIL because `structured-generate.ts` does not exist.

- [ ] **Step 4: Implement typed failures and one SDK attempt**

Use these exported contracts:

```ts
export type StructuredFailureKind =
  | "timeout"
  | "cancelled"
  | "provider"
  | "transport"
  | "unsuccessful-result"
  | "missing-structured-output"
  | "validation";

export class StructuredGenerationError extends Error {
  constructor(
    public readonly kind: StructuredFailureKind,
    message: string,
    public readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StructuredGenerationError";
  }
}

export type StructuredGenerateOptions<T> = {
  taskType: string;
  resolved: ResolvedModel;
  prompt: string;
  system: string;
  schema: Record<string, unknown>;
  validate: (output: unknown) => T;
  logger: Logger;
  costTracker?: CostTracker;
  repo?: string;
  deliveryId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  loadQuery?: AgentSdkLoader;
};

export type StructuredGenerateResult<T> = {
  output: T;
  model: string;
  provider: "anthropic";
  usedFallback: boolean;
  fallbackReason?: string;
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number };
};
```

Implement `runStructuredAgentAttempt` with `createAbortControllerWithTimeout`. Register a one-shot listener on `options.signal` that sets `externallyCancelled = true` and aborts the SDK controller with the caller's reason. Remove that listener in `finally`. After SDK iteration or in `catch`, classify an aborted controller as `cancelled` with `retryable: false` when `externallyCancelled` is true; otherwise classify it as the owned deadline:

```ts
throw new StructuredGenerationError(
  "timeout",
  `Claude Agent SDK structured generate timed out after ${timeoutMs}ms`,
  true,
  { cause: error ?? deadlineSignal.reason },
);
```

Accept only:

```ts
if (!resultMessage || resultMessage.subtype !== "success") {
  throw new StructuredGenerationError("unsuccessful-result", "Claude Agent SDK did not return success", true);
}
if (!("structured_output" in resultMessage) || resultMessage.structured_output === undefined) {
  throw new StructuredGenerationError("missing-structured-output", "Claude Agent SDK returned no structured output", true);
}
try {
  return { output: options.validate(resultMessage.structured_output), resultMessage };
} catch (error) {
  throw new StructuredGenerationError("validation", "Structured output failed domain validation", true, { cause: error });
}
```

Do not collect or return assistant text.

- [ ] **Step 5: Implement the exact two-attempt fallback budget**

```ts
export async function generateStructuredWithFallback<T>(
  options: StructuredGenerateOptions<T>,
): Promise<StructuredGenerateResult<T>> {
  const attempts = [
    { model: options.resolved.modelId, usedFallback: false },
    { model: options.resolved.fallbackModelId, usedFallback: true },
  ];

  let primaryFailure: StructuredGenerationError | undefined;
  for (const [index, attempt] of attempts.entries()) {
    if (index === 1 && (!primaryFailure?.retryable || !attempt.model)) break;
    try {
      return await runStructuredAgentAttempt(options, attempt.model, attempt.usedFallback, primaryFailure?.kind);
    } catch (error) {
      const normalized = normalizeStructuredError(error);
      if (index === 1 || !normalized.retryable) throw normalized;
      primaryFailure = normalized;
    }
  }
  throw primaryFailure ?? new StructuredGenerationError("transport", "No structured model attempt was available", false);
}
```

Log one event per attempt containing only task type, requested/resolved model, attempt number, duration, completion category, and prompt character count. Use existing cost tracking with token counts from `modelUsage`; never log `prompt`, `structured_output`, assistant content, or SDK messages.

- [ ] **Step 6: Export the adapter and run tests GREEN**

Add to `src/llm/index.ts`:

```ts
export {
  generateStructuredWithFallback,
  StructuredGenerationError,
  type StructuredFailureKind,
  type StructuredGenerateOptions,
  type StructuredGenerateResult,
} from "./structured-generate.ts";
```

Run: `bun test src/llm/structured-generate.test.ts src/llm/generate.test.ts src/llm/fallback.test.ts`

Expected: PASS; the new adapter uses Agent SDK for both models and existing text generation remains unchanged.

- [ ] **Step 7: Commit structured generation**

```bash
git add src/llm/structured-generate.ts src/llm/structured-generate.test.ts src/llm/index.ts
git commit -m "feat: add structured OAuth model generation"
```

### Task 3: Project patches into exact added-line evidence

**Files:**
- Create: `src/lib/addon-rule-evidence.ts`
- Create: `src/lib/addon-rule-evidence.test.ts`

**Interfaces:**
- Consumes: `readonly AddonRuleAddonContext[]` from `collectAddonRuleContext`.
- Produces: `projectAddonRuleEvidence(contexts): AddonRuleEvidenceContext[]`.
- Produces: `packAddonRuleEvidence(contexts, renderPrompt, maxPromptChars?): AddonRuleEvidencePack`.
- Produces: exact added-line allowlist reusable by domain validation.

- [ ] **Step 1: Write failing right-side line extraction tests**

```ts
const evidence = projectAddonRuleEvidence([{
  addonId: "script.example",
  allChangedPaths: ["script.example/default.py"],
  files: [{
    path: "script.example/default.py",
    status: "modified",
    additions: 3,
    deletions: 1,
    patch: [
      "@@ -10,3 +20,4 @@",
      " context",
      "-old()",
      "+new()",
      "+track_usage()",
      " context",
      "@@ -40 +50 @@",
      "-gone()",
      "+replacement()",
      "\\ No newline at end of file",
    ].join("\n"),
  }],
}]);

expect(evidence[0]?.files[0]?.addedLines).toEqual([
  { line: 21, text: "new()" },
  { line: 22, text: "track_usage()" },
  { line: 50, text: "replacement()" },
]);
```

Also assert `+++ b/path` is not treated as an added source line and deletion/context lines are absent.

- [ ] **Step 2: Write failing complete-prompt packing tests**

Use a render function that includes a fixed 100-character prefix. Assert:

```ts
const packed = packAddonRuleEvidence(input, renderPrompt, 180);
expect(packed.chunks.length).toBeGreaterThan(1);
expect(packed.chunks.every((chunk) => renderPrompt(chunk).length <= 180)).toBe(true);
expect(packed.chunks.flatMap(allLines)).toEqual(projected.flatMap(allLines));
```

Create one file with 100 added lines and prove it spans multiple chunks. Create one source line longer than the available payload and expect `omittedOversizedLines: 1`, with that text absent from every chunk.

- [ ] **Step 3: Run evidence tests and confirm RED**

Run: `bun test src/lib/addon-rule-evidence.test.ts`

Expected: FAIL because the evidence module does not exist.

- [ ] **Step 4: Implement evidence types and unified-diff projection**

```ts
export type AddonRuleAddedLine = { line: number; text: string };

export type AddonRuleEvidenceFile = {
  path: string;
  status?: string;
  additions?: number | null;
  deletions?: number | null;
  addedLines: AddonRuleAddedLine[];
};

export type AddonRuleEvidenceContext = {
  addonId: string;
  allChangedPaths: string[];
  files: AddonRuleEvidenceFile[];
};

export function collectAddedRightSideEvidence(patch: string): AddonRuleAddedLine[] {
  const result: AddonRuleAddedLine[] = [];
  let rightLine: number | undefined;
  for (const patchLine of patch.split("\n")) {
    const hunk = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      rightLine = Number.parseInt(hunk[1]!, 10);
      continue;
    }
    if (rightLine === undefined || patchLine === "\\ No newline at end of file") continue;
    if (patchLine.startsWith("-")) continue;
    if (patchLine.startsWith("+")) {
      result.push({ line: rightLine, text: patchLine.slice(1) });
    }
    if (patchLine.startsWith("+") || patchLine.startsWith(" ")) rightLine += 1;
  }
  return result;
}
```

`projectAddonRuleEvidence` maps only files with a patch and retains file metadata plus the exact added lines.

- [ ] **Step 5: Implement full-prompt packing**

```ts
export const MAX_ADDON_RULE_LLM_PROMPT_CHARS = 28_000;

export type AddonRuleEvidencePack = {
  chunks: AddonRuleEvidenceContext[][];
  omittedOversizedLines: number;
};

export function packAddonRuleEvidence(
  contexts: readonly AddonRuleEvidenceContext[],
  renderPrompt: (contexts: readonly AddonRuleEvidenceContext[]) => string,
  maxPromptChars = MAX_ADDON_RULE_LLM_PROMPT_CHARS,
): AddonRuleEvidencePack;
```

Build candidates one file-metadata record and then one line at a time. This preserves files with deletion-only patches as metadata-only evidence. Preserve `addonId`, the complete `allChangedPaths` allowlist, and file metadata in every chunk containing that file. Before accepting a candidate, require `renderPrompt(candidate).length <= maxPromptChars`. Flush the prior non-empty chunk when the candidate is too large. If a one-line candidate still exceeds the ceiling, increment `omittedOversizedLines` and continue without that line. If even a metadata-only candidate exceeds the ceiling, record it as omitted evidence. Do not truncate source text.

- [ ] **Step 6: Run evidence tests and confirm GREEN**

Run: `bun test src/lib/addon-rule-evidence.test.ts`

Expected: PASS with exact right-side coordinates, single-file splitting, and every rendered prompt at or below 28,000 characters.

- [ ] **Step 7: Commit evidence projection**

```bash
git add src/lib/addon-rule-evidence.ts src/lib/addon-rule-evidence.test.ts
git commit -m "feat: chunk addon evidence by added line"
```

### Task 4: Use a native schema and domain-grounded output

**Files:**
- Modify: `src/lib/addon-rule-llm.ts:1-189`
- Modify: `src/lib/addon-rule-llm.test.ts:1-153`

**Interfaces:**
- Produces: `ADDON_RULE_REVIEW_SCHEMA: Record<string, unknown>`.
- Produces: `buildAddonRuleReviewPrompt(input, evidenceContexts): string`.
- Produces: `validateAddonRuleReviewOutput(value, originalContexts): AddonRuleLlmResult`.
- Preserves: `parseAddonRuleReviewOutput(text, contexts)` as a compatibility wrapper for existing injected text tests until orchestration migrates.

- [ ] **Step 1: Write failing schema and evidence-prompt tests**

```ts
expect(ADDON_RULE_REVIEW_SCHEMA).toMatchObject({
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: { type: "string", maxLength: 600 },
    findings: { type: "array", maxItems: 20 },
  },
});

const prompt = buildAddonRuleReviewPrompt(input, evidenceContexts);
expect(prompt).toContain('"line":21');
expect(prompt).toContain('"text":"track_usage()"');
expect(prompt).not.toContain("-old()");
expect(prompt).not.toContain("Return only JSON");
expect(prompt).toContain("Return the result using the supplied JSON schema");
expect(prompt).toContain("Do not review Python or JavaScript correctness");
```

- [ ] **Step 2: Write failing structured-value grounding tests**

```ts
expect(validateAddonRuleReviewOutput({
  summary: "The patch adds analytics handling.",
  findings: [{
    addonId: "plugin.video.foo",
    path: "plugin.video.foo/default.py",
    line: 21,
    rule: "usage-analytics",
    level: "WARN",
    message: "The added call appears to send usage data.",
  }],
}, originalContexts).findings[0]).toMatchObject({ line: 21, source: "llm" });

expect(() => validateAddonRuleReviewOutput(valueWithUnknownPath, originalContexts))
  .toThrow("Structured addon review output failed domain validation");
expect(() => validateAddonRuleReviewOutput(valueWithUnaddedLine, originalContexts))
  .toThrow("Structured addon review output failed domain validation");
```

Require a code finding's line instead of silently dropping an invalid coordinate. File-level findings may omit `line` only when their message is genuinely file-level.

- [ ] **Step 3: Run LLM contract tests and confirm RED**

Run: `bun test src/lib/addon-rule-llm.test.ts`

Expected: FAIL because the prompt still embeds patches and the validator accepts free-text JSON.

- [ ] **Step 4: Define the JSON schema**

```ts
export const ADDON_RULE_REVIEW_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 600 },
    findings: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["addonId", "path", "line", "rule", "level", "message"],
        properties: {
          addonId: { type: "string", minLength: 1 },
          path: { type: "string", minLength: 1 },
          line: { type: "integer", minimum: 1 },
          rule: { type: "string", minLength: 1, maxLength: 80 },
          level: { type: "string", enum: ["ERROR", "WARN"] },
          message: { type: "string", minLength: 1, maxLength: 400 },
        },
      },
    },
  },
};
```

- [ ] **Step 5: Refactor prompt rendering and domain validation**

Change the prompt's evidence section to:

```ts
"Changed add-on added-line evidence JSON:",
JSON.stringify(evidenceContexts),
```

The validator must throw one bounded `Error("Structured addon review output failed domain validation")` if the top-level shape, summary, count, unsafe text, changed path, required line, or added-line allowlist check fails. Every model finding requires `path` and `line` because this model sees line-level added evidence; branch and file-level rules remain deterministic. It returns only fully valid findings with `source: "llm"` and never silently strips an invalid coordinate.

Keep:

```ts
export function parseAddonRuleReviewOutput(text: string, contexts: readonly AddonRuleAddonContext[]): AddonRuleLlmResult {
  try {
    return validateAddonRuleReviewOutput(JSON.parse(extractJsonObject(text)), contexts);
  } catch {
    return { findings: [], rejectedOutput: true };
  }
}
```

- [ ] **Step 6: Run LLM contract tests and confirm GREEN**

Run: `bun test src/lib/addon-rule-llm.test.ts`

Expected: PASS with native-schema shape, added-line-only prompt evidence, strict location grounding, and compatibility parsing.

- [ ] **Step 7: Commit the schema-backed contract**

```bash
git add src/lib/addon-rule-llm.ts src/lib/addon-rule-llm.test.ts
git commit -m "feat: validate structured addon rule output"
```

### Task 5: Replace patch chunks and outer retries in review orchestration

**Files:**
- Modify: `src/lib/addon-rule-review.ts:1-182`
- Modify: `src/lib/addon-rule-review.test.ts:1-229`

**Interfaces:**
- Consumes: `packAddonRuleEvidence`, `generateStructuredWithFallback`, `ADDON_RULE_REVIEW_SCHEMA`, and `validateAddonRuleReviewOutput`.
- Produces: the existing `RunAddonRuleLlm` result and `llm-incomplete` semantics.
- Removes: `MAX_ADDON_RULE_LLM_CHUNK_PATCH_CHARS`, `ADDON_RULE_LLM_CHUNK_ATTEMPTS`, the text-returning `GenerateAddonRuleChunk`, and `chunkAddonRuleContexts`.

- [ ] **Step 1: Replace chunk tests with complete-prompt and single-large-file expectations**

Inject a structured chunk generator:

```ts
type ReviewStructuredAddonRuleChunk = (params: {
  prompt: string;
  evidence: readonly AddonRuleEvidenceContext[];
  validate: (value: unknown) => AddonRuleLlmResult;
  chunkIndex: number;
  chunkCount: number;
}) => Promise<AddonRuleLlmResult>;
```

Build one 53,089-character new-file patch with numbered added lines. Assert multiple calls, every `prompt.length <= MAX_ADDON_RULE_LLM_PROMPT_CHARS`, all source lines appear exactly once across evidence chunks, and every returned line is retained.

- [ ] **Step 2: Write failing completeness and attempt-ownership tests**

```ts
test("all successful chunks remove model incompleteness", async () => {
  const result = await runDefaultAddonRuleLlm(input, logger, async ({ validate, evidence }) =>
    validate({ summary: "Reviewed this evidence chunk.", findings: findingFor(evidence) }));
  expect(result.rejectedOutput).toBeUndefined();
  expect(result.findings.every((finding) => finding.line !== undefined)).toBe(true);
});

test("one exhausted structured chunk retains successful findings and marks incomplete", async () => {
  const result = await runDefaultAddonRuleLlm(input, logger, async ({ chunkIndex, validate, evidence }) => {
    if (chunkIndex === 1) throw new StructuredGenerationError("timeout", "deadline", true);
    return validate({ summary: "Reviewed.", findings: findingFor(evidence) });
  });
  expect(result.findings.length).toBeGreaterThan(0);
  expect(result.rejectedOutput).toBe(true);
});
```

Assert the chunk runner calls its injected generator once per chunk. The structured generator owns Haiku/Sonnet attempts; the chunk runner has no retry loop.

- [ ] **Step 3: Run orchestration tests and confirm RED**

Run: `bun test src/lib/addon-rule-review.test.ts`

Expected: FAIL because the current runner chunks whole patches and retries each generator twice.

- [ ] **Step 4: Implement evidence packing and structured generation**

Use:

```ts
const projected = projectAddonRuleEvidence(input.contexts);
const renderPrompt = (contexts: readonly AddonRuleEvidenceContext[]) =>
  buildAddonRuleReviewPrompt(input, contexts);
const pack = packAddonRuleEvidence(projected, renderPrompt);
const prompts = pack.chunks.map((contexts) => ({ contexts, prompt: renderPrompt(contexts) }));
```

The default generator calls:

```ts
const result = await generateStructuredWithFallback({
  taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
  resolved,
  prompt,
  system: "You classify supplied Kodi add-on diff evidence only for repository submission-rule compliance. Do not perform general code review.",
  schema: ADDON_RULE_REVIEW_SCHEMA,
  validate: (output) => validateAddonRuleReviewOutput(output, input.contexts),
  logger,
  repo: input.repo,
});
return result.output;
```

Do not substitute Sonnet based on the word `haiku`; pass the router's primary and fallback unchanged to the structured adapter.

- [ ] **Step 5: Implement aggregate completeness and bounded telemetry**

Run chunks with `mapWithConcurrency(prompts, 3, ...)`. Each callback invokes its generator exactly once and catches a final typed error. A failed chunk returns `{ findings: [], rejectedOutput: true }`. Set aggregate `rejectedOutput` when a chunk failed, a result failed validation, more than 20 findings were produced, or `pack.omittedOversizedLines > 0`.

Emit a preflight event containing:

```ts
logger.info({
  taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
  chunkCount: prompts.length,
  promptChars: prompts.map(({ prompt }) => prompt.length),
  evidenceLineCount: projected.flatMap((context) => context.files).reduce(
    (count, file) => count + file.addedLines.length,
    0,
  ),
  omittedOversizedLines: pack.omittedOversizedLines,
}, "Prepared bounded addon rule model evidence");
```

The catch log contains only error kind, chunk ordinal/count, and duration category. It must not include the error object when its provider payload could contain model content.

- [ ] **Step 6: Run orchestration and synthesis tests GREEN**

Run: `bun test src/lib/addon-rule-evidence.test.ts src/lib/addon-rule-llm.test.ts src/lib/addon-rule-review.test.ts`

Expected: PASS; the 53,089-character file splits within the file, all prompts are bounded, exact lines survive, and an incomplete caveat is driven only by exhausted or omitted evidence.

- [ ] **Step 7: Commit review orchestration**

```bash
git add src/lib/addon-rule-review.ts src/lib/addon-rule-review.test.ts
git commit -m "fix: complete large addon model reviews"
```

### Task 6: Prove the contributor-facing integration does not regress

**Files:**
- Modify: `src/handlers/addon-check.test.ts:1360-1545`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: unchanged specialized add-on handler and formatter interfaces.
- Produces: regression proof that complete structured coverage omits `llm-incomplete` and renders exact locations.

- [ ] **Step 1: Add a failing handler-level complete-review test**

Use the existing explicit `addon_rule_review.requested` fixture and inject:

```ts
__runAddonRuleLlmForTests: async () => ({
  summary: "script.module.pyrollbar updates vendored Python code on nexus.",
  findings: [{
    addonId: "script.module.pyrollbar",
    path: "script.module.pyrollbar/lib/rollbar/kodi/__init__.py",
    line: 1,
    rule: "line-endings",
    level: "WARN",
    source: "llm",
    message: "The added source uses CRLF line endings.",
  }],
}),
```

Assert the published response contains Summary, Findings, Verdict, and ``script.module.pyrollbar/lib/rollbar/kodi/__init__.py:1``; assert it does not contain `model-backed rule check was incomplete`, `Decision:`, or general Python quality language.

- [ ] **Step 2: Run the handler test and confirm RED if integration copy regresses**

Run: `bun test src/handlers/addon-check.test.ts -t "complete structured addon review"`

Expected: the new test initially fails until its fixture and assertions are integrated; no production formatter change should be needed.

- [ ] **Step 3: Make only the minimal integration adjustment required by the test**

If the unchanged handler already passes the new data through, retain production code unchanged. If its test fixture omits line data, update only the fixture. Do not create a second comment format or new marker.

Add under the current `CHANGELOG.md` unreleased section:

```markdown
- Make Kodi add-on rule reviews use schema-backed Haiku output and bounded line-numbered diff evidence, preventing large Python submissions from silently losing model coverage.
```

- [ ] **Step 4: Run the focused regression set and confirm GREEN**

Run: `bun test src/llm/task-router.test.ts src/llm/structured-generate.test.ts src/lib/addon-rule-context.test.ts src/lib/addon-rule-evidence.test.ts src/lib/addon-rule-llm.test.ts src/lib/addon-rule-review.test.ts src/lib/addon-check-formatter.test.ts src/handlers/addon-check.test.ts src/handlers/addon-review-routing.test.ts src/handlers/mention.test.ts`

Expected: PASS with one structured response surface and no generic review regression.

- [ ] **Step 5: Commit integration proof and release note**

```bash
git add src/handlers/addon-check.test.ts CHANGELOG.md
git commit -m "test: prove complete addon review responses"
```

### Task 7: Verify, deploy, and prove the live review

**Files:**
- Verify: all files changed in Tasks 1-6
- Deploy: existing `deploy.sh` using `/home/keith/src/kodiai/.env`
- Observe: Azure Container Apps logs and `xbmc/repo-scripts#2861`

**Interfaces:**
- Consumes: the exact clean implementation commit after Task 6.
- Produces: a healthy Azure revision and a live explicit review response satisfying the design acceptance criteria.

- [ ] **Step 1: Run focused static and build verification**

```bash
git diff --check HEAD~6 HEAD
bun run lint
bunx tsc --noEmit
bun build src/index.ts --outdir /tmp/kodiai-addon-model-review-build --target bun
bun test src/llm/task-router.test.ts src/llm/structured-generate.test.ts src/lib/addon-rule-context.test.ts src/lib/addon-rule-evidence.test.ts src/lib/addon-rule-llm.test.ts src/lib/addon-rule-review.test.ts src/lib/addon-check-formatter.test.ts src/handlers/addon-check.test.ts src/handlers/addon-review-routing.test.ts src/handlers/mention.test.ts
```

Expected: diff check, lint, build, and focused tests pass. If TypeScript still reports `src/jobs/aca-launcher.test.ts(344,70): TS2493`, reproduce it on `/home/keith/src/kodiai` before recording it as the known baseline failure.

- [ ] **Step 2: Run the full test suite**

Run: `bun run test`

Expected: unit and database lanes complete with all change-related tests passing. If the known `createMentionHandler conversational review wiring > conversational PR mentions are grounded with pre-fetched PR diff` test fails, reproduce it unchanged on `/home/keith/src/kodiai` before classifying it as baseline. If a database lane lacks an external prerequisite, record that prerequisite separately rather than representing the lane as passed.

- [ ] **Step 3: Inspect the exact deploy candidate**

```bash
git status --short
git log -1 --oneline
git rev-parse HEAD
```

Expected: clean status and one exact source commit recorded as `DEPLOY_SOURCE_COMMIT`.

- [ ] **Step 4: Deploy the exact commit through the existing full-template path**

```bash
DEPLOY_SOURCE_COMMIT="$(git rev-parse HEAD)"
ENV_FILE=/home/keith/src/kodiai/.env DEPLOY_SOURCE_COMMIT="$DEPLOY_SOURCE_COMMIT" ./deploy.sh
```

Expected: remote ACR builds succeed; `ca-kodiai` receives a healthy new revision; the deploy output reports active revision, health URL, and readiness URL. Do not replace the full-template deploy with a partial `az containerapp update`.

- [ ] **Step 5: Verify active revision, traffic, and health**

```bash
az containerapp revision list --name ca-kodiai --resource-group rg-kodiai --query "[?properties.trafficWeight > \`0\`].{name:name,active:properties.active,health:properties.healthState,traffic:properties.trafficWeight}" -o table
APP_FQDN="$(az containerapp show --name ca-kodiai --resource-group rg-kodiai --query properties.configuration.ingress.fqdn -o tsv)"
curl -fsS "https://$APP_FQDN/healthz"
curl -fsS "https://$APP_FQDN/readiness"
```

Expected: one healthy active revision has 100 percent traffic and both endpoints return HTTP 200 with the deployed commit visible in the health proof.

- [ ] **Step 6: Trigger and inspect the representative explicit review**

Redeliver the GitHub webhook for the explicit `@kodiai review` request on `xbmc/repo-scripts#2861`, or post a fresh explicit review request if the old delivery is unavailable. Wait for the eyes acknowledgement and response publication, then inspect the newest response and correlated Azure logs.

Expected public result:

- One response comment for that explicit delivery.
- `Summary`, `Findings`, and `Verdict` remain concise.
- No `model-backed rule check was incomplete` caveat.
- Every code finding includes a validated `path:line` coordinate.
- Deterministic `LICENSE` filename and CRLF findings remain present when applicable.
- No Python code-quality, style, or architecture review appears.
- The canonical comment at `issuecomment-5011592514` is not overwritten by the explicit response.

Expected bounded logs:

- Requested model `claude-haiku-4-5-20251001`.
- Every prompt length is at most 28,000 characters.
- Successful SDK result category uses native structured output.
- No prompt, patch, source line, model body, OAuth token, or SDK payload is logged.

- [ ] **Step 7: Replay once and report immutable evidence**

Replay the same delivery once. Expected: its response is updated idempotently rather than duplicated.

Report the implementation commit, Azure revision, traffic and health proof, response URL, response marker, model/chunk completion categories, concrete `path:line` examples, focused test count, full-suite result, and independently reproduced baseline failures. If any material chunk remains incomplete, report the exact bounded failure category and continue debugging instead of claiming completion.
