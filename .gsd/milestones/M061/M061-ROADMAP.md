# M061: M061

**Vision:** 

## Slices

- [x] **S01: S01** `risk:high` `depends:[]`
  > After this: operators can inspect real Postgres-backed token, prompt-composition, and cache-effectiveness evidence for mention/review executions instead of relying on stale or incomplete usage reporting.

- [x] **S02: S02** `risk:high` `depends:[]`
  > After this: standard conversational mentions answer with smaller default prompts because long thread history, candidate code pointers, and PR diff bodies are staged in only when the request shape truly needs them.

- [ ] **S03: S03** `risk:high` `depends:[]`
  > After this: review prompt assembly uses bounded per-section budgets and the packed unified knowledge-context representation, materially shrinking the prompt without removing truthful review guidance.

- [ ] **S04: Retrieval Reuse and Safe Derived-Context Caching** `risk:medium` `depends:[S01,S02,S03]`
  > After this: retrieval avoids same-query duplicate embedding work and repeated identical thread/review state can reuse bounded derived artifacts through truthful cache keys.

- [ ] **S05: Integrated Token-Reduction Proof and Regression Gate** `risk:medium` `depends:[S02,S03,S04]`
  > After this: Kodiai has a repeatable proof surface showing lower token spend on representative mention/review paths while preserving grounding, publication behavior, and fail-open semantics.
