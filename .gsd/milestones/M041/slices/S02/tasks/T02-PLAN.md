---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T02: Add canonical semantic retrieval with provenance

- Add a retrieval module for canonical current-code chunks with provenance-rich results.
- Integrate it alongside existing retrieval orchestration without collapsing historical and canonical corpora.
- Ensure returned matches carry enough metadata for downstream bounded prompt packing.

## Inputs

- `src/knowledge/retrieval.ts`
- `src/knowledge/code-snippet-retrieval.ts`
- `src/knowledge/canonical-code-store.ts`

## Expected Output

- `src/knowledge/canonical-code-retrieval.ts`
- `src/knowledge/canonical-code-retrieval.test.ts`

## Verification

bun test ./src/knowledge/canonical-code-retrieval.test.ts

## Observability Impact

Adds provenance-rich match surfaces so retrieval results can be explained and audited.
