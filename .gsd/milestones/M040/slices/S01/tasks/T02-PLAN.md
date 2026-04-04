---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T02: Implement C++ and Python structural extraction

- Implement Tree-sitter-backed extractors for C++ and Python first; TS/JS support remains secondary.
- Capture files, symbols, imports/includes, call edges, and probable test relationships with explicit confidence where needed.
- Add fixture-driven tests that prove extraction shape on C++ and Python examples.

## Inputs

- `.gsd/milestones/M040/M040-CONTEXT.md`
- `src/jobs/workspace.ts`

## Expected Output

- `src/review-graph/extractors/cpp.ts`
- `src/review-graph/extractors/python.ts`
- `src/review-graph/extractors/index.ts`
- `src/review-graph/extractors.test.ts`

## Verification

bun test ./src/review-graph/extractors.test.ts

## Observability Impact

Adds per-language extraction counts and probable-edge confidence surfaces.
