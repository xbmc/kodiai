# M035: Voyage AI Model Upgrades - voyage-4 + rerank-2.5

## Vision
Upgrade non-wiki embeddings from voyage-code-3 to voyage-4 and add a Voyage rerank-2.5 neural reranking step at the end of the cross-corpus retrieval pipeline, improving retrieval quality across all trigger types with fail-open semantics throughout.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | voyage-4 Embedding Upgrade + Reranker Client | low | — | ✅ | After this: grep for 'voyage-code-3' in non-test source returns zero hits; createRerankProvider exists and passes unit tests |
| S02 | Reranker Pipeline Wiring + Runtime Integration | medium | S01 | ✅ | After this: retrieval pipeline calls reranker and returns reranked unified results; fail-open test passes; runtime boots with correct model names in logs |
