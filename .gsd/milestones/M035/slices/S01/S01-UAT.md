# S01: voyage-4 Embedding Upgrade + Reranker Client — UAT

**Milestone:** M035
**Written:** 2026-04-04T16:07:50.976Z

# UAT: S01 — voyage-4 Embedding Upgrade + Reranker Client

## Preconditions
- Node/Bun environment with `bun` available
- Repository at `/home/keith/src/kodiai`
- No external services required (all tests mock the network)

---

## Test Cases

### TC-01: No voyage-code-3 literals remain in non-test source

**Purpose:** Confirm the model name sweep is complete and no hardcoded old model strings remain in production code.

**Steps:**
1. Run: `grep -r 'voyage-code-3' src/ --include='*.ts' | grep -v '\.test\.ts' | grep -c '' || true`

**Expected:** Output is `0`

**Edge cases:**
- If output is non-zero, run without `grep -c` to see which files have remaining literals

---

### TC-02: DEFAULT_EMBEDDING_MODEL and NON_WIKI_TARGET_EMBEDDING_MODEL are voyage-4

**Purpose:** Confirm the two primary exported model constants are updated.

**Steps:**
1. Run: `grep -n 'DEFAULT_EMBEDDING_MODEL\s*=' src/knowledge/runtime.ts`
2. Run: `grep -n 'NON_WIKI_TARGET_EMBEDDING_MODEL\s*=' src/knowledge/embedding-repair.ts`

**Expected:**
- Output 1 contains `"voyage-4"`
- Output 2 contains `"voyage-4"`

---

### TC-03: EXPECTED_CORPUS_MODELS updated for all non-wiki corpora

**Purpose:** Confirm the audit map reflects voyage-4 for all non-wiki corpora so next audit run flags old rows as model_mismatch.

**Steps:**
1. Run: `grep -A 10 'EXPECTED_CORPUS_MODELS' src/knowledge/embedding-audit.ts`

**Expected:** All entries for `learning_memories`, `review_comments`, `code_snippets`, `issues`, `issue_comments` show `voyage-4`. The `wiki_pages` entry shows `voyage-context-3` (unchanged — different model family).

---

### TC-04: Zod config schema defaults are voyage-4

**Purpose:** Confirm runtime config defaults are aligned with the new model.

**Steps:**
1. Run: `grep -n 'voyage' src/execution/config.ts`

**Expected:** All occurrences show `voyage-4` (no `voyage-code-3`)

---

### TC-05: RerankProvider type is exported from types.ts

**Purpose:** Confirm the type contract is in place for S02 to consume.

**Steps:**
1. Run: `grep -n 'RerankProvider' src/knowledge/types.ts`

**Expected:** Shows `export type RerankProvider = { rerank(...): Promise<number[] | null>; readonly model: string; }` around line 361

---

### TC-06: createRerankProvider is exported from embeddings.ts

**Purpose:** Confirm the factory function is available for S02 wiring.

**Steps:**
1. Run: `grep -n 'createRerankProvider\|VOYAGE_RERANK_URL\|VoyageRerankResponse' src/knowledge/embeddings.ts`

**Expected:** All three identifiers found — constant, interface, and exported function

---

### TC-07: No-op provider when apiKey is empty

**Purpose:** Confirm fail-open: empty API key produces a provider that returns null without making network calls.

**Steps:**
1. Run the unit test: `bun test ./src/knowledge/embeddings.test.ts --test-name-pattern "returns null when apiKey is empty"`

**Expected:** Test passes. The no-op provider's `rerank()` returns null and `model` getter returns `"rerank-2.5"`.

---

### TC-08: Happy-path reranking returns ordered indices

**Purpose:** Confirm the live provider extracts and returns index arrays from the Voyage API response.

**Steps:**
1. Run: `bun test ./src/knowledge/embeddings.test.ts --test-name-pattern "happy path"`

**Expected:** Test passes. Given `data: [{index:1,relevance_score:0.9},{index:0,relevance_score:0.7}]`, returns `[1, 0]`.

---

### TC-09: Fail-open on API errors

**Purpose:** Confirm the provider returns null (not throws) on API 500, network error, and empty data array.

**Steps:**
1. Run: `bun test ./src/knowledge/embeddings.test.ts --test-name-pattern "fail-open"`

**Expected:** All 3 fail-open tests pass (API 500, network error, empty data array)

---

### TC-10: top_k wiring

**Purpose:** Confirm topK is included in the request body when provided and omitted otherwise.

**Steps:**
1. Run: `bun test ./src/knowledge/embeddings.test.ts --test-name-pattern "top_k"`

**Expected:** Both top_k tests pass — included when `topK` is set, absent when `topK` is `undefined`

---

### TC-11: Full test suite passes

**Purpose:** Confirm all 9 unit tests pass as a suite.

**Steps:**
1. Run: `bun test ./src/knowledge/embeddings.test.ts`

**Expected:** `9 pass, 0 fail`

---

### TC-12: TypeScript compiles clean

**Purpose:** Confirm no type errors were introduced.

**Steps:**
1. Run: `bun run tsc --noEmit 2>&1 | tail -5`

**Expected:** Empty output (no errors), exit code 0

---

### TC-13: Test files still contain voyage-code-3 (intentional)

**Purpose:** Confirm test fixtures were not altered — they legitimately represent historical model state.

**Steps:**
1. Run: `grep -r 'voyage-code-3' src/ --include='*.test.ts' | grep -c '' || true`

**Expected:** Non-zero count (test files retain the old model string as fixture data — this is correct)

