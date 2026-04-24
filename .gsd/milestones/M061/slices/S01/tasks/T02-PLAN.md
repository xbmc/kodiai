---
estimated_steps: 2
estimated_files: 9
skills_used: []
---

# T02: Instrument mention and review prompt builders with named section metrics

Capture prompt-section accounting at the actual mention/review construction seams, then thread the resulting metrics into the execution/runtime path. The instrumentation must stay deterministic, bounded, and text-free so later slices can compare prompt size by section without storing prompt bodies.

Note for executors: cover both conversational mention context and the large review prompt builder sections because S02 and S03 depend on these seams.

## Inputs

- ``src/execution/mention-context.ts``
- ``src/execution/mention-prompt.ts``
- ``src/execution/review-prompt.ts``
- ``src/execution/mention-context.test.ts``
- ``src/execution/mention-prompt.test.ts``
- ``src/execution/review-prompt.test.ts``
- ``src/execution/agent-entrypoint.ts``
- ``src/handlers/mention.ts``
- ``src/handlers/review.ts``
- ``src/telemetry/types.ts``

## Expected Output

- ``src/execution/mention-context.ts``
- ``src/execution/mention-prompt.ts``
- ``src/execution/review-prompt.ts``
- ``src/execution/mention-context.test.ts``
- ``src/execution/mention-prompt.test.ts``
- ``src/execution/review-prompt.test.ts``
- ``src/execution/agent-entrypoint.ts``
- ``src/handlers/mention.ts``
- ``src/handlers/review.ts``

## Verification

bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts

## Observability Impact

Makes prompt bloat diagnosable by emitting named section metrics for mention/review runs, and exposes failure visibility when attribution cannot be computed or written.
