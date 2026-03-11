# T01: 01-webhook-foundation 01

**Slice:** S01 — **Milestone:** M001

## Description

Initialize the Kodiai project, create the Hono HTTP server, implement webhook signature verification, delivery deduplication, health/readiness endpoints, and fail-fast configuration validation.

Purpose: Establish the foundation that all subsequent plans build on -- a running HTTP server that can receive GitHub webhooks, verify their authenticity, and reject invalid/duplicate requests.
Output: A working Bun + Hono server with POST /webhooks/github (signature verified, deduplicated), GET /health, GET /readiness endpoints, structured JSON logging via pino, and Zod-validated config that crashes on missing secrets.

## Must-Haves

- [ ] "POST /webhooks/github with valid HMAC-SHA256 signature returns 200"
- [ ] "POST /webhooks/github with invalid or missing signature returns 401"
- [ ] "Duplicate deliveries (same X-GitHub-Delivery) are detected and skipped"
- [ ] "GET /health returns 200 with {status: ok}"
- [ ] "Server crashes on startup if GITHUB_APP_ID, GITHUB_PRIVATE_KEY, or GITHUB_WEBHOOK_SECRET is missing"
- [ ] "All log output is structured JSON to stdout (no pretty-print)"

## Files

- `package.json`
- `tsconfig.json`
- `src/index.ts`
- `src/config.ts`
- `src/lib/logger.ts`
- `src/routes/webhooks.ts`
- `src/routes/health.ts`
- `src/webhook/verify.ts`
- `src/webhook/dedup.ts`
- `src/webhook/types.ts`
- `.env.example`
