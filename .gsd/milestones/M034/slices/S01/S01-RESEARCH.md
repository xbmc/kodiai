# S01 Research: Capture Claude Code Usage Events

## Summary

This is targeted research on known technology in a well-understood codebase. The SDK already exports `SDKRateLimitEvent` and `SDKRateLimitInfo` types. The agent entrypoint already iterates the SDK message stream, filters on `type === "result"`, and writes `result.json`. The task is to **also** capture `type === "rate_limit_event"` messages, keep the last seen one, and serialize a structured `usageLimit` object into `ExecutionResult` and `result.json`. No new libraries, no novel patterns.

## Requirements Owned by This Slice

- **R001** — Claude Code usage limit visible in Review Details. This slice delivers the data foundation: capturing the `SDKRateLimitEvent` and threading `usageLimit` into `ExecutionResult` / `result.json`. S02 completes R001 by rendering it.

## Implementation Landscape

### SDK Type: `SDKRateLimitEvent`

Defined in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:

```typescript
export declare type SDKRateLimitEvent = {
  type: 'rate_limit_event';
  rate_limit_info: SDKRateLimitInfo;
  uuid: UUID;
  session_id: string;
};

export declare type SDKRateLimitInfo = {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt?: number;          // Unix timestamp seconds
  rateLimitType?: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage';
  utilization?: number;       // 0.0–1.0 fraction of limit consumed
  overageStatus?: ...;
  overageResetsAt?: number;
  // ... (other overage fields not needed for S01)
};
```

- `SDKRateLimitEvent` is part of the `SDKMessage` union already iterated in `agent-entrypoint.ts`.
- It only appears on OAuth/subscription auth paths, not on API key auth. Fields `utilization`, `rateLimitType`, and `resetsAt` are all optional — must handle absence gracefully.
- Multiple `rate_limit_event` messages may arrive during a single run. Per D021, the last seen event wins.
- It is already imported/exported from `@anthropic-ai/claude-agent-sdk`.

### File: `src/execution/agent-entrypoint.ts`

The loop today:
```typescript
for await (const message of sdkQueryResult) {
  if (message.type === "result") {
    resultMessage = message as SDKResultMessage;
  }
}
```

Change needed:
1. Import `SDKRateLimitEvent` from `@anthropic-ai/claude-agent-sdk`.
2. Add `let lastRateLimitEvent: SDKRateLimitEvent | undefined` before the loop.
3. Inside the loop, add an `else if (message.type === "rate_limit_event")` branch that assigns `lastRateLimitEvent = message as SDKRateLimitEvent`.
4. After the loop, when constructing `result: ExecutionResult`, populate `usageLimit` from `lastRateLimitEvent?.rate_limit_info`.

### File: `src/execution/types.ts`

Add a new optional field to `ExecutionResult`:

```typescript
/** Claude Code usage limit data from the last SDKRateLimitEvent seen during the run. */
usageLimit?: {
  utilization: number | undefined;
  rateLimitType: string | undefined;
  resetsAt: number | undefined;
};
```

The field must be optional (absent when no rate-limit event fires, e.g., API key auth).

### File: `src/execution/agent-entrypoint.test.ts`

Existing tests are well-structured with injectable deps (`queryFn`, `writeFileFn`, `readFileFn`, `exitFn`). The `makeAsyncIterable` helper already supports arbitrary message sequences. New tests needed:

1. **Capture test:** Feed a `rate_limit_event` message followed by `result`. Assert `result.json` contains `usageLimit` with correct shape.
2. **Last-wins test:** Feed two `rate_limit_event` messages followed by `result`. Assert `usageLimit` reflects the second event.
3. **Absent when no event:** Feed only a `result` message (existing happy-path fixture). Assert `usageLimit` is absent/undefined.
4. **Absent when all fields optional are missing:** Feed a `rate_limit_event` with `rate_limit_info: { status: 'allowed' }` (no utilization, no resetsAt, no rateLimitType). Assert `usageLimit` is serialized with all fields `undefined` (not crashing).

### Serialization Path

`agent-entrypoint.ts` → writes `result.json` via `writeFileFn` using `JSON.stringify(result, null, 2)`.
`executor.ts` → reads `result.json` via `readJobResult(workspaceDir)` from `src/jobs/aca-launcher.ts`, then casts to `ExecutionResult`:
```typescript
const jobResult = rawResult as ExecutionResult;
```
The `usageLimit` field on `ExecutionResult` flows through automatically — no change to `executor.ts` needed for S01. S02 will consume `result.usageLimit` downstream in `review.ts` and `formatReviewDetailsSummary`.

### What Does NOT Need to Change for S01

- `executor.ts` — no change needed; it blindly casts the JSON payload to `ExecutionResult`, so adding the field to the type is sufficient.
- `src/lib/review-utils.ts` → `formatReviewDetailsSummary` — this is S02 scope.
- `src/handlers/review.ts` — this is S02 scope.
- `src/jobs/aca-launcher.ts` → `readJobResult` — returns `unknown`, no change needed.

## Key Risks

- **Type narrowing the union:** The message loop currently only checks `message.type === "result"`. The SDK message stream is `AsyncGenerator<SDKMessage, void>` where `SDKMessage` is a wide union. TypeScript will infer the type narrowed by `type === "rate_limit_event"` to `SDKRateLimitEvent` correctly. The existing import is only `SDKResultMessage, McpHttpServerConfig, Query` — `SDKRateLimitEvent` must be added to the import.
- **Error path serialization:** The two error paths in `agent-entrypoint.ts` (no-result case and catch block) produce `ExecutionResult` directly. They should NOT include `usageLimit` unless a rate-limit event was received — the field should simply be absent in those objects, which is the default TypeScript optional behavior.
- **`undefined` vs absent in JSON.stringify:** `JSON.stringify` omits keys with `undefined` values. If `usageLimit` is set to `{ utilization: undefined, rateLimitType: undefined, resetsAt: undefined }` the object will serialize as `{}`. The downstream consumer (S02) needs to handle this empty-object case. Alternatively, only set `usageLimit` if `lastRateLimitEvent` is defined; skip setting it if no event was seen. **Recommendation:** Set `usageLimit` only when `lastRateLimitEvent !== undefined`. When set, always populate the three sub-fields (even if they are `undefined`). This keeps the type honest and the downstream check simple: `if (result.usageLimit) { ... }`.

## Verification Commands

```bash
bun test src/execution/agent-entrypoint.test.ts
bun tsc --noEmit
```

## Recommendation

**Three files change:** `types.ts` (add `usageLimit` to `ExecutionResult`), `agent-entrypoint.ts` (capture rate-limit event in loop, populate field), `agent-entrypoint.test.ts` (4 new test cases). All changes are surgical and low-risk.

The pattern exactly mirrors the existing `resultMessage` capture: a single nullable variable declared before the loop, assigned inside the loop, consumed after the loop. There are no new dependencies, no new libraries, and no architectural changes.
