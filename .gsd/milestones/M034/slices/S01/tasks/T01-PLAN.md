---
estimated_steps: 50
estimated_files: 3
skills_used: []
---

# T01: Capture SDKRateLimitEvent in loop and add usageLimit to ExecutionResult

Three surgical changes: (1) add optional `usageLimit` field to `ExecutionResult` type, (2) import `SDKRateLimitEvent` and capture the last seen event during the SDK stream loop in `agent-entrypoint.ts`, (3) populate `usageLimit` when constructing the result, and (4) add 4 test cases to `agent-entrypoint.test.ts`.

Steps:
1. In `src/execution/types.ts`, add optional field to `ExecutionResult`:
   ```typescript
   /** Claude Code usage limit data from the last SDKRateLimitEvent seen during the run. */
   usageLimit?: {
     utilization: number | undefined;
     rateLimitType: string | undefined;
     resetsAt: number | undefined;
   };
   ```
2. In `src/execution/agent-entrypoint.ts`, extend the import line to add `SDKRateLimitEvent`:
   ```typescript
   import type { SDKResultMessage, McpHttpServerConfig, Query, SDKRateLimitEvent } from "@anthropic-ai/claude-agent-sdk";
   ```
3. Before the `for await` loop, add: `let lastRateLimitEvent: SDKRateLimitEvent | undefined;`
4. Inside the loop, add an `else if` branch:
   ```typescript
   } else if (message.type === "rate_limit_event") {
     lastRateLimitEvent = message as SDKRateLimitEvent;
   }
   ```
5. When constructing the successful `result: ExecutionResult` object (after the loop), add the `usageLimit` field — set it only when `lastRateLimitEvent` is defined:
   ```typescript
   ...(lastRateLimitEvent !== undefined ? {
     usageLimit: {
       utilization: lastRateLimitEvent.rate_limit_info.utilization,
       rateLimitType: lastRateLimitEvent.rate_limit_info.rateLimitType,
       resetsAt: lastRateLimitEvent.rate_limit_info.resetsAt,
     }
   } : {}),
   ```
   Note: Do NOT add `usageLimit` to the error-path `ExecutionResult` objects (the no-result case and catch block). The field is absent there by default, which is correct.
6. In `src/execution/agent-entrypoint.test.ts`, add a `makeRateLimitEvent` helper near the top:
   ```typescript
   function makeRateLimitEvent(info: Partial<import('@anthropic-ai/claude-agent-sdk').SDKRateLimitInfo> = {}): object {
     return {
       type: 'rate_limit_event',
       uuid: 'uuid-rl',
       session_id: 'sess-rl',
       rate_limit_info: { status: 'allowed', ...info },
     };
   }
   ```
7. Add a new `describe('rate_limit_event capture', () => { ... })` block with 4 tests:
   - **single event captured**: feed `[makeRateLimitEvent({ utilization: 0.75, rateLimitType: 'seven_day', resetsAt: 9999 }), makeResultSuccess()]`, assert `parsedResult.usageLimit` equals `{ utilization: 0.75, rateLimitType: 'seven_day', resetsAt: 9999 }`
   - **last event wins**: feed `[makeRateLimitEvent({ utilization: 0.5 }), makeRateLimitEvent({ utilization: 0.9, rateLimitType: 'seven_day_sonnet', resetsAt: 1234 }), makeResultSuccess()]`, assert `usageLimit.utilization === 0.9` and `usageLimit.rateLimitType === 'seven_day_sonnet'`
   - **absent when no event**: feed `[makeResultSuccess()]`, assert `parsedResult.usageLimit === undefined`
   - **all sub-fields optional/absent**: feed `[makeRateLimitEvent({ status: 'allowed' }), makeResultSuccess()]` (no utilization/rateLimitType/resetsAt), assert `usageLimit` is defined but `usageLimit.utilization === undefined && usageLimit.rateLimitType === undefined && usageLimit.resetsAt === undefined`
   Each test uses the same env-setup pattern as the existing happy-path tests: set all 4 required env vars, mock `queryFn`, `writeFileFn`, `readFileFn`, `exitFn`, parse the written JSON to get `parsedResult`.

## Inputs

- ``src/execution/types.ts``
- ``src/execution/agent-entrypoint.ts``
- ``src/execution/agent-entrypoint.test.ts``

## Expected Output

- ``src/execution/types.ts``
- ``src/execution/agent-entrypoint.ts``
- ``src/execution/agent-entrypoint.test.ts``

## Verification

bun test src/execution/agent-entrypoint.test.ts && bun tsc --noEmit
