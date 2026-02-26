# Phase 97: Multi-LLM Routing & Cost Tracking - Research

**Researched:** 2026-02-25
**Domain:** Multi-provider LLM routing, Vercel AI SDK integration, per-invocation cost tracking
**Confidence:** HIGH

## Summary

Phase 97 introduces a task-type-to-model routing layer that allows any LLM call site in Kodiai to be routed to a configurable model via Vercel AI SDK, while preserving the existing Claude Agent SDK execution path for agentic tasks that need MCP tools and workspaces. The user's CONTEXT.md expands the original requirement scope: ALL task types are routable (not just non-agentic), including PR review, mentions, and Slack responses. This means the Vercel AI SDK must support tool calling via `generateText()` with `tools` and `stopWhen` for agentic task routing, and the Agent SDK remains the default for those tasks but becomes overridable.

The Vercel AI SDK v6 (latest: `ai@6.0.100`) provides a unified `generateText()` API with built-in token tracking (`usage.inputTokens`, `usage.outputTokens`, `totalUsage` across multi-step calls), provider-agnostic model selection, and Zod-based tool definitions. Provider packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`) handle authentication via environment variables. The AI Gateway fallback feature or a custom fallback wrapper handles provider unavailability with 429/5xx detection.

Cost tracking extends the existing `telemetry_events` Postgres table (or a new `llm_cost_events` table) with task type, provider, model, token counts, and estimated USD cost per invocation. The existing TelemetryStore pattern already records Agent SDK executions; phase 97 adds tracking for AI SDK invocations alongside.

**Primary recommendation:** Install `ai@^6.0`, `@ai-sdk/anthropic@^3.0`, `@ai-sdk/openai@^3.0`, and `@ai-sdk/google@^3.0`. Build a `TaskRouter` that maps dot-separated task types to model IDs via `.kodiai.yml` config. For v1, agentic tasks default to Agent SDK but can be overridden; non-agentic tasks default to AI SDK `generateText()`. Fallback uses a try/catch wrapper with configurable fallback model. Cost logging uses the `usage` object from `generateText()` response written to Postgres.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- All LLM call sites are routable, not just "non-agentic" ones -- the user wants flexibility to route any task type to any model
- Task types include tool-use tasks (PR review, mention handling, Slack responses), not just generateText() calls
- Vercel AI SDK tool-use support needed for agentic task routing
- Initial routable task types: PR review (full), mention responses, Slack responses, plus the smaller tasks (pr-summary, cluster-label, staleness-evidence, and any other existing LLM call sites)
- Task type taxonomy uses dot-separated hierarchy: `review.full`, `review.summary`, `slack.response`, `mention.response`, `cluster.label`, `staleness.evidence`, etc. -- enables wildcards like `review.*`
- `.kodiai.yml` `models:` section uses direct task-type-to-model-ID mapping (no named profiles)
- Example: `models: { review.full: claude-sonnet-4-20250514, slack.response: gpt-4o-mini }`
- Per-repo overrides in `.kodiai.yml`
- When fallback triggers, output includes a visible annotation (e.g., "Used fallback model (configured provider unavailable)")
- Rate limits (429) trigger fallback immediately -- don't wait and retry, switch to fallback model
- 5xx errors and timeouts also trigger fallback
- If all models (primary + fallback) fail: degrade gracefully -- skip optional signals (summaries, labels), only fail hard for core tasks like PR review
- Track cost for ALL LLM calls -- both Vercel AI SDK and Claude Agent SDK invocations
- Cost estimation via provider pricing APIs (not hardcoded tables)
- Full-dimensional Postgres schema: repo, task type, model, provider, token counts (input/output), estimated USD cost, timestamp -- queryable along any dimension

### Claude's Discretion
- Default model selection per task category (agentic vs lightweight)
- Provider auth approach (env vars, config, or hybrid)
- Per-repo override merge semantics (merge vs replace)
- Fallback chain depth (single default vs per-task chain)
- Whether to include cost alerting/budget thresholds in v1

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LLM-01 | Non-agentic tasks route through Vercel AI SDK `generateText()` while agentic tasks remain on Claude Agent SDK `query()` | AI SDK v6 `generateText()` with provider packages; Agent SDK preserved in `src/execution/executor.ts`. CONTEXT.md expands: ALL tasks are routable, but agentic tasks default to Agent SDK |
| LLM-02 | Task types map to configurable model IDs via a task router | Dot-separated hierarchy (`review.full`, `cluster.label`) with wildcard matching; `TaskRouter` resolves config to provider+model; Zod schema validates `.kodiai.yml` `models:` section |
| LLM-03 | `.kodiai.yml` `models:` section allows per-repo model overrides per task type | Extend existing `repoConfigSchema` in `src/execution/config.ts` with `models:` record; merge semantics with defaults |
| LLM-04 | Provider fallback: if configured provider is unavailable, fall back to configured default model | Try/catch on `generateText()` with 429/5xx detection; immediate switch to fallback model; visible annotation on output |
| LLM-05 | Each LLM invocation logs model, provider, token counts, and estimated cost to Postgres | New `llm_cost_events` table (migration 010); `usage` object from `generateText()` and existing `modelUsage` from Agent SDK; pricing lookup for USD estimation |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai | ^6.0.100 | Core SDK: `generateText()`, token tracking, provider abstraction | Unified API across all providers; built-in `usage` with inputTokens/outputTokens/totalUsage; multi-step tool calling via `stopWhen`; Zod tool schemas |
| @ai-sdk/anthropic | ^3.0.x | Anthropic provider (Claude Sonnet 4, Haiku 4.5) | First-class prompt caching, extended thinking support; cache-aware token metrics |
| @ai-sdk/openai | ^3.0.x | OpenAI provider (GPT-4o-mini, o3-mini) | Cost-optimized for classification/summarization tasks |
| @ai-sdk/google | ^3.0.x | Google provider (Gemini 2.0 Flash) | Low-cost, high-speed for simple structured tasks |
| @anthropic-ai/claude-agent-sdk | ^0.2.37 | Existing: Claude Code CLI agent for agentic tasks | Keep -- owns MCP tools, ephemeral workspaces, file tooling |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | ^4.3.6 | Already installed; schema validation for config and tool definitions | AI SDK tools use Zod for `inputSchema`; config schema for `models:` section |
| postgres | ^3.4.8 | Already installed; tagged-template SQL for cost event logging | New migration for `llm_cost_events` table |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @ai-sdk/gateway (Vercel AI Gateway) | Self-managed provider selection | Gateway adds network hop + token markup cost; requires Vercel deployment. Self-hosted on Azure -- not needed |
| OpenRouter provider | @ai-sdk/openai + @ai-sdk/anthropic directly | OpenRouter adds latency + cost markup; useful only if > 5 providers needed |
| Hardcoded pricing tables | Provider pricing APIs / config-driven | APIs are dynamic but add latency; recommend: config-driven with periodic updates |

**Installation:**
```bash
bun add ai@^6.0 @ai-sdk/anthropic@^3.0 @ai-sdk/openai@^3.0 @ai-sdk/google@^3.0
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── llm/                         # NEW: Multi-LLM routing layer
│   ├── task-router.ts           # TaskRouter: resolves task type -> model + provider
│   ├── task-types.ts            # TaskType enum/taxonomy with dot-separated hierarchy
│   ├── providers.ts             # Provider registry: creates AI SDK provider instances
│   ├── generate.ts              # Wrapper: generateText() with fallback + cost tracking
│   ├── fallback.ts              # Fallback logic: 429/5xx detection, chain resolution
│   ├── cost-tracker.ts          # Cost estimation + Postgres logging
│   └── pricing.ts               # Provider pricing configuration (per-model token rates)
├── execution/
│   ├── executor.ts              # MODIFIED: uses TaskRouter for model selection
│   └── config.ts                # MODIFIED: add models: section to repoConfigSchema
├── telemetry/
│   ├── store.ts                 # MODIFIED: add recordLlmCost() method
│   └── types.ts                 # MODIFIED: add LlmCostRecord type
└── db/
    └── migrations/
        └── 010-llm-cost-events.sql  # NEW: llm_cost_events table
```

### Pattern 1: Task Router with Dot-Separated Hierarchy
**What:** A `TaskRouter` that resolves a dot-separated task type string to a concrete model+provider tuple, supporting wildcard overrides.
**When to use:** Every LLM call site passes its task type to the router before invoking the model.
**Example:**
```typescript
// Source: CONTEXT.md user decision + AI SDK provider pattern

type TaskType = string; // e.g., "review.full", "cluster.label", "slack.response"

interface ResolvedModel {
  modelId: string;        // e.g., "claude-sonnet-4-20250514"
  provider: string;       // e.g., "anthropic"
  sdk: "agent" | "ai";   // which SDK to use
  fallbackModelId?: string;
}

function resolveModel(taskType: TaskType, config: ModelsConfig): ResolvedModel {
  // 1. Check exact match: config.models["review.full"]
  // 2. Check wildcard: config.models["review.*"]
  // 3. Fall back to category default: agentic tasks -> Agent SDK default, others -> AI SDK default
}
```

### Pattern 2: Unified generateText Wrapper with Fallback
**What:** A wrapper around AI SDK `generateText()` that handles fallback on 429/5xx, annotates output, and logs cost.
**When to use:** All non-Agent-SDK LLM calls go through this wrapper.
**Example:**
```typescript
// Source: AI SDK v6 docs (ai-sdk.dev/docs/reference/ai-sdk-core/generate-text)

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

interface GenerateWithFallbackResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  provider: string;
  usedFallback: boolean;
}

async function generateWithFallback(opts: {
  taskType: string;
  resolved: ResolvedModel;
  prompt: string;
  system?: string;
  tools?: Record<string, any>;
  stopWhen?: any;
}): Promise<GenerateWithFallbackResult> {
  const providerModel = createProviderModel(opts.resolved.modelId);

  try {
    const result = await generateText({
      model: providerModel,
      prompt: opts.prompt,
      system: opts.system,
      tools: opts.tools,
      stopWhen: opts.stopWhen,
    });
    return {
      text: result.text,
      usage: {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      },
      model: opts.resolved.modelId,
      provider: opts.resolved.provider,
      usedFallback: false,
    };
  } catch (err) {
    if (isFallbackTrigger(err) && opts.resolved.fallbackModelId) {
      const fallbackModel = createProviderModel(opts.resolved.fallbackModelId);
      const result = await generateText({
        model: fallbackModel,
        prompt: opts.prompt,
        system: opts.system,
        tools: opts.tools,
        stopWhen: opts.stopWhen,
      });
      return {
        text: result.text,
        usage: {
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
        },
        model: opts.resolved.fallbackModelId,
        provider: extractProvider(opts.resolved.fallbackModelId),
        usedFallback: true,
      };
    }
    throw err;
  }
}

function isFallbackTrigger(err: unknown): boolean {
  // 429 rate limit, 5xx server error, timeout
  const status = (err as any)?.status ?? (err as any)?.statusCode;
  return status === 429 || (status >= 500 && status < 600)
    || (err instanceof Error && err.message.includes("timeout"));
}
```

### Pattern 3: Provider Model Factory
**What:** A factory that maps model ID strings to AI SDK provider instances.
**When to use:** The task router resolves a model ID; the factory creates the corresponding AI SDK model object.
**Example:**
```typescript
// Source: AI SDK v6 provider docs

import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";

// Provider instances created once at startup (they read env vars)
// ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY

function createProviderModel(modelId: string) {
  // Parse provider prefix or use known model-to-provider mapping
  if (modelId.startsWith("claude-") || modelId.startsWith("anthropic/")) {
    return anthropic(modelId.replace("anthropic/", ""));
  }
  if (modelId.startsWith("gpt-") || modelId.startsWith("o3-") || modelId.startsWith("openai/")) {
    return openai(modelId.replace("openai/", ""));
  }
  if (modelId.startsWith("gemini-") || modelId.startsWith("google/")) {
    return google(modelId.replace("google/", ""));
  }
  // Default: try anthropic (existing default provider)
  return anthropic(modelId);
}
```

### Pattern 4: Cost Tracking via Usage Object
**What:** Extract token counts from `generateText()` response `usage` object and Agent SDK `modelUsage`, compute estimated USD cost, write to Postgres.
**When to use:** After every LLM invocation (both AI SDK and Agent SDK).
**Example:**
```typescript
// Source: AI SDK v6 generateText response type

interface LlmCostRecord {
  repo: string;
  taskType: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  estimatedCostUsd: number;
  durationMs: number;
  usedFallback: boolean;
  deliveryId?: string;
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getModelPricing(model);
  return (inputTokens / 1_000_000) * pricing.inputPerMillion
       + (outputTokens / 1_000_000) * pricing.outputPerMillion;
}
```

### Anti-Patterns to Avoid
- **Replacing Agent SDK with AI SDK for agentic tasks by default:** The Agent SDK provides MCP servers, ephemeral workspaces, and the Claude Code toolchain. AI SDK's tool support is different -- it uses Zod-schema tools with `execute` functions, not MCP protocol. The two SDKs serve different purposes. Agent SDK remains the default for `review.full`, `mention.response`, `slack.response`. Only override if user explicitly configures a non-Claude model for those task types.
- **Using `streamText()` anywhere:** Bun production build failure (oven-sh/bun#25630). Use `generateText()` exclusively.
- **Using `@ai-sdk/gateway` (Vercel AI Gateway):** Requires Vercel deployment, adds network hop latency, charges token markup. Kodiai is self-hosted on Azure.
- **Hardcoding provider pricing in source code:** Pricing changes frequently. Use a configuration-driven pricing table that can be updated without code changes.
- **Using `experimental_telemetry` / OpenTelemetry:** The `usage` object on `generateText()` response contains everything needed. Direct Postgres logging is simpler and matches existing telemetry patterns.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Provider-specific HTTP clients | Custom fetch to Anthropic/OpenAI APIs | AI SDK `generateText()` with provider packages | Provider nuances (auth headers, response format, error codes) handled by SDK |
| Token counting | Manual response parsing per provider | AI SDK `usage` object (`inputTokens`, `outputTokens`, `totalUsage`) | Each provider returns token counts differently; AI SDK normalizes them |
| Multi-step tool calling loops | Custom agent loop with tool dispatch | AI SDK `generateText()` with `tools` + `stopWhen: stepCountIs(N)` | Loop logic, tool result injection, and step tracking are built-in |
| Model string parsing | Custom provider detection from model IDs | Provider registry with known model-to-provider mapping | Centralizes provider resolution; handles model ID format variations |
| Fallback retry logic | Complex retry/backoff library | Simple try/catch with `isFallbackTrigger()` check | User decision: immediate fallback on 429/5xx, no retry/backoff |

**Key insight:** The AI SDK's value is precisely in eliminating provider-specific integration code. Each provider has different auth, error formats, streaming protocols, and token counting. The SDK normalizes all of this behind `generateText()`.

## Common Pitfalls

### Pitfall 1: Mixing Agent SDK and AI SDK Tool Systems
**What goes wrong:** Attempting to pass AI SDK Zod-schema tools to Agent SDK `query()`, or trying to use MCP servers with AI SDK `generateText()`. The two tool systems are incompatible.
**Why it happens:** Both SDKs have a concept of "tools" but they are fundamentally different. Agent SDK tools are MCP protocol tools invoked via Claude Code CLI. AI SDK tools are Zod-schema functions with `execute` callbacks.
**How to avoid:** When a task type routes to Agent SDK (the default for agentic tasks), use `createExecutor()` unchanged. When a task type routes to AI SDK, use `generateText()` with AI SDK tool definitions. The router decides which path; the two never mix.
**Warning signs:** Import of `@anthropic-ai/claude-agent-sdk` and `ai` in the same call site.

### Pitfall 2: Bun + streamText() Production Build Failure
**What goes wrong:** `streamText()` throws network errors in Bun production builds (oven-sh/bun#25630).
**Why it happens:** Bun's ReadableStream backpressure handling differs from Node.js in production builds.
**How to avoid:** Use `generateText()` exclusively. All targeted tasks return complete, non-streaming output.
**Warning signs:** Any import of `streamText` or `streamObject`.

### Pitfall 3: Missing Provider API Keys Causing Silent Failures
**What goes wrong:** If `OPENAI_API_KEY` is not set but a task is configured to use `gpt-4o-mini`, the AI SDK throws an auth error that may not be caught gracefully.
**Why it happens:** Provider packages read API keys from standard environment variables at call time, not at startup. Missing keys are only discovered when the first call is attempted.
**How to avoid:** Validate required API keys at startup based on the configured model mapping. If `models:` config references OpenAI models, require `OPENAI_API_KEY`. Log a warning (not a crash) if a configured provider's key is missing, since fallback should handle it.
**Warning signs:** Auth errors in production that don't reproduce locally (where all keys are set).

### Pitfall 4: Cost Estimation Drift from Actual Provider Pricing
**What goes wrong:** Estimated costs diverge from actual bills because pricing was set once and never updated.
**Why it happens:** LLM providers change pricing frequently. Hardcoded pricing tables rot within weeks.
**How to avoid:** Use a configuration-driven pricing file (not compiled-in constants). The user specified "provider pricing APIs (not hardcoded tables)" but most providers don't have real-time pricing APIs. Recommendation: a YAML or JSON pricing config loaded at startup, with a log warning when pricing data is older than 30 days. Provider-specific pricing sources: Anthropic publishes at docs.anthropic.com/pricing, OpenAI at openai.com/pricing, Google at ai.google.dev/pricing.
**Warning signs:** `estimatedCostUsd` column values that are orders of magnitude different from provider invoices.

### Pitfall 5: Wildcard Config Resolution Order Ambiguity
**What goes wrong:** Config `models: { "review.*": "model-a", "review.full": "model-b" }` -- which wins? Ambiguous resolution causes unpredictable routing.
**Why it happens:** Dot-separated hierarchies with wildcards need explicit precedence rules.
**How to avoid:** Exact match always wins over wildcard. Document this. Resolution order: (1) exact match, (2) longest prefix wildcard, (3) category default, (4) global default.
**Warning signs:** Tests passing with specific configs but failing with wildcard configs.

### Pitfall 6: Agent SDK Cost Tracking Regression
**What goes wrong:** The existing `telemetry_events` table already tracks Agent SDK execution costs. Adding a new `llm_cost_events` table could create confusion about which table to query for cost data.
**Why it happens:** Two tables recording overlapping cost data with different schemas.
**How to avoid:** Either (a) extend the existing `telemetry_events` table with a `task_type` column for AI SDK calls, or (b) create a new `llm_cost_events` table for ALL calls (both AI SDK and Agent SDK) and treat `telemetry_events` as the legacy execution-level table. Recommendation: new table for clean schema design, with Agent SDK costs written to both tables during transition.
**Warning signs:** Dashboard queries needing UNION across two tables to get total cost.

## Code Examples

### Verified: AI SDK generateText() with Tools and Token Usage
```typescript
// Source: ai-sdk.dev/docs/reference/ai-sdk-core/generate-text (verified 2026-02-25)

import { generateText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const result = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  prompt: "Analyze the staleness of this wiki page...",
  tools: {
    scoreEvidence: tool({
      description: "Score evidence of staleness",
      inputSchema: z.object({
        score: z.number().min(0).max(100),
        evidence: z.array(z.string()),
      }),
      execute: async ({ score, evidence }) => ({ score, evidence }),
    }),
  },
});

// Token usage is always available
console.log(result.usage?.inputTokens);   // number
console.log(result.usage?.outputTokens);  // number
console.log(result.totalUsage);           // aggregated across all steps

// Per-step tracking for multi-step calls
for (const step of result.steps) {
  console.log(step.usage?.inputTokens);
}
```

### Verified: AI SDK Multi-Step Tool Calling
```typescript
// Source: ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling (verified 2026-02-25)

import { generateText, tool, stepCountIs } from "ai";

const { text, steps } = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: {
    analyzeFile: tool({
      description: "Analyze a source file for issues",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        // Read file, return analysis
        return { issues: ["..."] };
      },
    }),
  },
  stopWhen: stepCountIs(5), // max 5 tool-calling steps
  prompt: "Review this code change...",
});

// Access all tool calls across steps
const allToolCalls = steps.flatMap(step => step.toolCalls);
```

### Verified: AI SDK Fallback on Provider Error
```typescript
// Source: AI SDK error handling patterns + CONTEXT.md decisions

function isFallbackTrigger(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // Check for HTTP status in error properties (AI SDK wraps provider errors)
  const status = (err as any).status ?? (err as any).statusCode
    ?? (err as any).data?.status;

  if (status === 429) return true; // Rate limit -> immediate fallback
  if (typeof status === "number" && status >= 500 && status < 600) return true;

  // Timeout detection
  if (err.message.includes("timeout") || err.name === "AbortError") return true;

  return false;
}
```

### Existing: Agent SDK Execution with Token Tracking
```typescript
// Source: src/execution/executor.ts (current codebase)
// Agent SDK already provides modelUsage in the result message:

const modelEntries = Object.entries(resultMessage.modelUsage ?? {});
const primaryModel = modelEntries[0]?.[0] ?? "unknown";
const totalInput = modelEntries.reduce((sum, [, u]) => sum + u.inputTokens, 0);
const totalOutput = modelEntries.reduce((sum, [, u]) => sum + u.outputTokens, 0);

// This data can be forwarded to llm_cost_events for unified cost tracking
```

### Config Schema Extension for models: Section
```typescript
// Extend src/execution/config.ts repoConfigSchema

const modelsSchema = z
  .record(z.string(), z.string()) // task-type -> model-id
  .default({});

// Example valid config:
// models:
//   review.full: claude-sonnet-4-20250514
//   review.summary: claude-haiku-4-5-20250929
//   slack.response: gpt-4o-mini
//   cluster.label: gemini-2.0-flash
//   "review.*": claude-sonnet-4-20250514   # wildcard
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| AI SDK v4/v5 `maxSteps` for tool loops | AI SDK v6 `stopWhen` with `stepCountIs()` | AI SDK v6 (Feb 2026) | More flexible loop control; `maxSteps` still works but `stopWhen` is preferred |
| AI SDK `generateObject()` / `streamObject()` | AI SDK v6: use `generateText()` with structured output | AI SDK v6 | `generateObject` merged into `generateText` |
| Separate `maxSteps` parameter | `stopWhen: stepCountIs(N)` | AI SDK v6 | Declarative stop conditions replace numeric limit |

**Deprecated/outdated:**
- `streamText()`: Not deprecated in AI SDK, but unusable with Bun production builds (oven-sh/bun#25630)
- `generateObject()`: Merged into `generateText()` in AI SDK v6
- `experimental_telemetry`: Works but unnecessary for Kodiai; the `usage` response object is simpler

## Open Questions

1. **Provider pricing data source**
   - What we know: The user wants "provider pricing APIs (not hardcoded tables)." Anthropic, OpenAI, and Google publish pricing pages but none offer a real-time pricing API endpoint.
   - What's unclear: Whether to scrape pricing pages, use a third-party pricing aggregator, or ship a config file with manual updates.
   - Recommendation: Ship a `pricing.json` config file loaded at startup. Log a warning if the file's `lastUpdated` field is > 30 days old. This is the pragmatic middle ground -- not hardcoded in source, not dependent on non-existent APIs.

2. **Agentic task routing via AI SDK vs Agent SDK**
   - What we know: User wants ALL tasks routable. Agent SDK provides MCP servers and workspace tooling that AI SDK cannot replicate. AI SDK v6 supports multi-step tool calling with `generateText()` + `tools` + `stopWhen`.
   - What's unclear: For agentic tasks (review.full, mention.response), if routed to a non-Claude model via AI SDK, the MCP tool infrastructure is lost. The AI SDK's tool system is Zod-based with `execute` callbacks, fundamentally different from MCP protocol tools.
   - Recommendation: For v1, agentic tasks default to Agent SDK. If a user overrides the model for an agentic task, they accept reduced capability (no MCP tools, no workspace file access). The task router should emit a warning when an agentic task is routed away from Agent SDK. Future phases can bridge the gap by implementing AI SDK tool equivalents for critical MCP tools.

3. **Fallback chain depth**
   - What we know: User defers to Claude's discretion. Single global fallback model is simplest; per-task fallback chains are more flexible.
   - What's unclear: User's preference for complexity vs simplicity in v1.
   - Recommendation: Single global `defaultFallbackModel` in config (e.g., `claude-sonnet-4-20250514`). Per-task fallback chains deferred to v2 -- complexity not justified until real-world failure patterns emerge.

4. **Cost alerting/budget limits**
   - What we know: User defers to Claude's discretion for v1.
   - Recommendation: Skip for v1. The existing `telemetry.costWarningUsd` config field provides per-execution cost warnings. Phase 97 should focus on accurate cost recording; alerting can layer on top in a future phase using the recorded data.

## Sources

### Primary (HIGH confidence)
- [AI SDK v6 generateText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text) - Full API with usage types, tool calling, multi-step
- [AI SDK providers and models](https://ai-sdk.dev/docs/foundations/providers-and-models) - Provider package list, installation, model IDs
- [AI SDK tools and tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) - Tool definitions, stopWhen, multi-step patterns
- [AI SDK AI Gateway fallback](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway) - Fallback model configuration pattern
- [AI SDK telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry) - Token tracking via usage object and OpenTelemetry
- npm registry: ai@6.0.100 (published Feb 2026), @ai-sdk/anthropic@3.0.x (published Feb 2026)

### Secondary (MEDIUM confidence)
- [Bun streaming issue oven-sh/bun#25630](https://github.com/oven-sh/bun/issues/25630) - Production build streaming failure, documented with repro
- Prior milestone research: `.planning/research/STACK.md`, `.planning/research/PITFALLS.md` - Already validated AI SDK v6 + Bun compatibility

### Tertiary (LOW confidence)
- Provider pricing accuracy: Anthropic/OpenAI/Google pricing pages are authoritative but change without notice. Pricing config will need periodic manual updates.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - AI SDK v6 verified via official docs and npm registry; Bun compatibility confirmed
- Architecture: HIGH - Two-SDK architecture (Agent SDK + AI SDK) validated against existing codebase patterns; CONTEXT.md decisions are specific and actionable
- Pitfalls: HIGH - Bun streaming issue verified; Agent SDK/AI SDK boundary documented in prior research; cost tracking patterns derived from existing telemetry infrastructure

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (30 days -- stable domain, AI SDK v6 is current)
