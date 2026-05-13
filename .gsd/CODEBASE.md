# Codebase Map

Generated: 2026-05-13T05:03:09Z | Files: 500 | Described: 0/500
<!-- gsd:codebase-meta {"generatedAt":"2026-05-13T05:03:09Z","fingerprint":"05998590b430eec488208f219e5917dadd668cfc","fileCount":500,"truncated":true} -->
Note: Truncated to first 500 files. Run with higher --max-files to include all.

### (root)/
- `.dockerignore`
- `.env.example`
- `.gitignore`
- `.kodiai.yml`
- `bunfig.toml`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `deploy.sh`
- `docker-compose.yml`
- `Dockerfile`
- `Dockerfile.agent`
- `eslint.config.mjs`
- `LICENSE`
- `package.json`
- `README.md`

### .github/workflows/
- `.github/workflows/ci.yml`
- `.github/workflows/nightly-issue-sync.yml`
- `.github/workflows/nightly-reaction-sync.yml`

### docs/
- `docs/architecture.md`
- `docs/configuration.md`
- `docs/deployment.md`
- `docs/GRACEFUL-RESTART-RUNBOOK.md`
- `docs/guardrails.md`
- `docs/INDEX.md`
- `docs/issue-intelligence.md`
- `docs/knowledge-system.md`
- `docs/m029-s04-ops-runbook.md`
- `docs/README.md`

### docs/operations/
- `docs/operations/embedding-integrity.md`

### docs/runbooks/
- `docs/runbooks/aca-job-debugging.md`
- `docs/runbooks/deploy-rollback.md`
- `docs/runbooks/formatter-suggestions.md`
- `docs/runbooks/key-rotation.md`
- `docs/runbooks/m065-rollout-proof.md`
- `docs/runbooks/mentions.md`
- `docs/runbooks/nightly-sync-failures.md`
- `docs/runbooks/recent-review-audit.md`
- `docs/runbooks/review-requested-debug.md`
- `docs/runbooks/scale.md`
- `docs/runbooks/slack-integration.md`
- `docs/runbooks/slack-webhook-relay.md`
- `docs/runbooks/xbmc-cutover.md`
- `docs/runbooks/xbmc-ops.md`

### docs/smoke/
- `docs/smoke/m053-formatter-suggestions.md`
- `docs/smoke/m066-formatter-suggestions.md`
- `docs/smoke/m068-candidate-publication.md`
- `docs/smoke/phase27-uat-notes.md`
- `docs/smoke/phase72-telemetry-follow-through.md`
- `docs/smoke/phase74-reliability-regression-gate.md`
- `docs/smoke/phase75-live-ops-verification-closure.md`
- `docs/smoke/phase80-slack-operator-hardening.md`
- `docs/smoke/slack-webhook-relay.md`
- `docs/smoke/xbmc-kodiai-write-flow.md`
- `docs/smoke/xbmc-xbmc-write-flow.md`

### docs/superpowers/plans/
- `docs/superpowers/plans/2026-04-26-m055-docs-accuracy.md`

### docs/superpowers/specs/
- `docs/superpowers/specs/2026-04-26-m055-docs-accuracy-design.md`
- `docs/superpowers/specs/2026-04-28-small-diff-review-fast-path-design.md`

### fixtures/contributor-calibration/
- `fixtures/contributor-calibration/xbmc-manifest.json`
- `fixtures/contributor-calibration/xbmc-snapshot.json`

### fixtures/slack-webhook-relay/
- `fixtures/slack-webhook-relay/accepted.json`
- `fixtures/slack-webhook-relay/suppressed.json`

### scripts/
- *(226 files: 221 .ts, 3 .sh, 1 .py, 1 .md)*

### scripts/fixtures/
- `scripts/fixtures/m068-candidate-approved-proof.json`
- `scripts/fixtures/m068-direct-fallback-proof.json`

### src/
- `src/config.test.ts`
- `src/config.ts`

### src/api/
- `src/api/phase27-uat-example.ts`
- `src/api/phase28-inline-suppression-live-check.ts`

### src/auth/
- `src/auth/bot-user.ts`
- `src/auth/github-app.ts`

### src/contributor/
- *(28 files: 28 .ts)*

### src/db/
- `src/db/client.ts`
- `src/db/migrate.ts`

### src/db/migrations/
- *(82 files: 82 .sql)*

### src/enforcement/
- `src/enforcement/index.ts`
- `src/enforcement/severity-floors.test.ts`
- `src/enforcement/severity-floors.ts`
- `src/enforcement/tooling-detection.test.ts`
- `src/enforcement/tooling-detection.ts`
- `src/enforcement/tooling-suppression.test.ts`
- `src/enforcement/tooling-suppression.ts`
- `src/enforcement/types.ts`

### src/execution/
- *(29 files: 29 .ts)*

### src/execution/mcp/
- `src/execution/mcp/checkpoint-server.test.ts`
- `src/execution/mcp/checkpoint-server.ts`
- `src/execution/mcp/ci-status-server.ts`
- `src/execution/mcp/comment-server.test.ts`
- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/http-server.test.ts`
- `src/execution/mcp/http-server.ts`
- `src/execution/mcp/index.test.ts`
- `src/execution/mcp/index.ts`
- `src/execution/mcp/inline-review-server.test.ts`
- `src/execution/mcp/inline-review-server.ts`
- `src/execution/mcp/issue-comment-server.test.ts`
- `src/execution/mcp/issue-comment-server.ts`
- `src/execution/mcp/issue-label-server.test.ts`
- `src/execution/mcp/issue-label-server.ts`
- `src/execution/mcp/review-comment-thread-server.test.ts`
- `src/execution/mcp/review-comment-thread-server.ts`
- `src/execution/mcp/review-output-publication-gate.ts`

### src/feedback/
- `src/feedback/aggregator.test.ts`
- `src/feedback/aggregator.ts`
- `src/feedback/confidence-adjuster.test.ts`
- `src/feedback/confidence-adjuster.ts`
- `src/feedback/index.ts`
- `src/feedback/safety-guard.test.ts`
- `src/feedback/safety-guard.ts`
- `src/feedback/types.ts`

### src/handlers/
- *(30 files: 30 .ts)*
