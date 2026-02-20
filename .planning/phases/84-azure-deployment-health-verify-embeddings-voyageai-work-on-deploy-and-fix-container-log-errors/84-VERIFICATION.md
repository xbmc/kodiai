---
phase: 84-azure-deployment-health-verify-embeddings-voyageai-work-on-deploy-and-fix-container-log-errors
verified: 2026-02-19T00:00:00Z
status: human_needed
score: 3/3 automated must-haves verified
human_verification:
  - test: "Confirm embeddings smoke test passed in production deployment"
    expected: "Container logs show 'Embeddings smoke test passed' with voyage-code-3 model, 1024 dimensions, and a latency reading"
    why_human: "Production Azure container logs cannot be read programmatically from local codebase; requires az CLI access to the live environment"
  - test: "Confirm container startup has zero error-level lines"
    expected: "az containerapp logs show output contains no lines with level 'error' or 'ERROR' on the most recent boot"
    why_human: "Live container log output requires Azure CLI access to the deployed environment"
  - test: "Confirm /health endpoint returns HTTP 200"
    expected: "curl https://ca-kodiai.*.azurecontainerapps.io/health returns 200 with a valid JSON body"
    why_human: "Requires network access to the live Azure deployment"
---

# Phase 84: Azure Deployment Health Verification Report

**Phase Goal:** Confirm VoyageAI embeddings work in the deployed Azure environment, add a startup smoke test, and ensure clean container startup with no error-level output
**Verified:** 2026-02-19
**Status:** human_needed — all local/static checks pass; live deployment health requires human confirmation
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Embeddings smoke test runs automatically on container boot and logs pass/fail | VERIFIED | `src/index.ts` lines 119-149: `void Promise.resolve().then(async () => { ... embeddingProvider.generate("kodiai smoke test", "query") ... logger.info/warn })` — non-blocking, logs at INFO on pass, WARN on fail |
| 2 | Smoke test failure does not prevent the server from starting (non-fatal) | VERIFIED | Implementation uses `void Promise.resolve().then(...).catch(...)` pattern — same pattern as the Slack scope preflight (line 180). All error paths log at WARN, never throw. |
| 3 | deploy.sh passes VOYAGE_API_KEY and Slack env vars to Azure Container Apps | VERIFIED | VOYAGE_API_KEY appears in validation (line 56), secret set (lines 171, 215), env-var ref (lines 186, 223), and YAML probe (lines 251-252). All four Slack vars present in all three sections. |
| 4 | VoyageAI embeddings confirmed working in deployed Azure environment | HUMAN NEEDED | SUMMARY claims smoke test passed at 171ms in production; cannot verify live container logs from local codebase |
| 5 | Container starts cleanly with no error-level output on boot | HUMAN NEEDED | SUMMARY claims zero error-level lines; cannot verify live container logs locally |

**Score:** 3/3 automated must-haves verified; 2 truths require human confirmation of live deployment

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/index.ts` | Embeddings smoke test on startup | VERIFIED | Lines 119-149: full non-blocking smoke test using `void Promise.resolve()` pattern, calls `embeddingProvider.generate("kodiai smoke test", "query")`, logs pass/fail with model/dimensions/latencyMs |
| `deploy.sh` | Complete env var passthrough for all required secrets | VERIFIED | Bash syntax valid (`bash -n` passes). Contains VOYAGE_API_KEY, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET as secret refs; SLACK_BOT_USER_ID, SLACK_KODIAI_CHANNEL_ID as plain env vars. Present in validation section, create path, update path, and YAML probe template. |
| `Dockerfile` | Debian base image for sqlite-vec glibc compatibility | VERIFIED | Both stages use `oven/bun:1-debian` (not alpine). Uses `apt-get` instead of `apk`. Commit 8356361df3 confirmed in repo. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/index.ts` | `src/learning/embedding-provider.ts` | `embeddingProvider.generate()` call during smoke test | VERIFIED | Line 127: `await embeddingProvider.generate("kodiai smoke test", "query")`. Import at line 22: `import { createEmbeddingProvider, createNoOpEmbeddingProvider } from "./learning/embedding-provider.ts"`. Interface signature matches: `generate(text: string, inputType: "document" \| "query"): Promise<EmbeddingResult>` |
| `deploy.sh` | `src/config.ts` | env var names matching config schema | VERIFIED | Pattern `VOYAGE_API_KEY\|SLACK_SIGNING_SECRET\|SLACK_BOT_TOKEN` found in deploy.sh validation, secret set, and env-var sections. No-op provider guard checks `embeddingProvider.model === "none"` which correctly matches the no-op provider's `get model() { return "none" }` |

---

## Commit Verification

| Commit | Message | Status |
|--------|---------|--------|
| `630e12a4dc` | feat(84-01): add non-blocking embeddings smoke test on startup | EXISTS |
| `d4d227de2b` | feat(84-01): pass all required env vars through deploy.sh | EXISTS |
| `8356361df3` | fix(84): switch Dockerfile from Alpine to Debian for sqlite-vec gl... | EXISTS |

---

## Anti-Patterns Found

None. No TODO/FIXME/placeholder comments in modified files. No stub implementations. No empty handlers. The smoke test is fully wired: it calls the actual embedding provider, measures latency, and logs structured output at appropriate levels.

---

## Human Verification Required

### 1. Embeddings Smoke Test Production Confirmation

**Test:** Run `az containerapp logs show --name ca-kodiai --resource-group rg-kodiai --type console --follow false --tail 200` and search output for "Embeddings smoke test"
**Expected:** A line containing `"Embeddings smoke test passed"` with fields `model: "voyage-code-3"`, `dimensions: 1024`, and a numeric `latencyMs`
**Why human:** Live Azure container logs cannot be read from the local codebase

### 2. Clean Container Startup (No Error-Level Output)

**Test:** Review the same log output from above; scan for any line with level `"error"` or `"ERROR"` occurring during the initial startup sequence
**Expected:** Zero error-level lines from container boot through the "Server listening" line
**Why human:** Requires live container log access

### 3. Health Endpoint Live Check

**Test:** `curl -s https://$(az containerapp show --name ca-kodiai --resource-group rg-kodiai --query properties.configuration.ingress.fqdn -o tsv)/health`
**Expected:** HTTP 200 with a valid JSON response body
**Why human:** Requires network access to the deployed Azure environment

---

## Gaps Summary

No gaps in the static codebase. All three Plan 01 must-have truths are implemented correctly and wired:

- The smoke test is non-blocking (uses `void Promise.resolve()` as specified), skips the no-op provider (`model === "none"` check correct), calls `embeddingProvider.generate()` with a test string, and logs structured pass/fail at INFO/WARN respectively.
- `deploy.sh` validates all 9 required env vars, passes secrets as Azure secret refs in both create and update paths, and includes them in the YAML probe template.
- The Dockerfile is confirmed Debian-based with no alpine remnants.

The two unverified truths (live embeddings smoke test result, clean container boot) are inherently live-environment concerns documented by the SUMMARY as passing. Human confirmation is the appropriate gate here.

---

_Verified: 2026-02-19_
_Verifier: Claude (gsd-verifier)_
