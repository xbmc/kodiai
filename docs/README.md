# Kodiai Documentation

Kodiai is a GitHub App that provides AI-powered code reviews, issue triage, mention responses, and knowledge management. This directory contains all project documentation — from system design to operational runbooks.

## Architecture & Design

- **[Architecture](architecture.md)** — System design, module map, request lifecycles, data layer, and key abstractions
- **[Configuration](configuration.md)** — Complete `.kodiai.yml` reference with all fields, types, defaults, and examples

## Deployment & Operations

- **[Deployment](deployment.md)** — Azure Container Apps deployment, secrets, scaling, health probes, and common commands
- **[Graceful Restart Runbook](GRACEFUL-RESTART-RUNBOOK.md)** — Zero-downtime deploys with graceful shutdown and webhook queue replay

## Knowledge System

- **[Knowledge System](knowledge-system.md)** — 5-corpus retrieval pipeline (findings, threads, wiki, snippets, issues) with two-stage RRF merge, vector + BM25 search, and background sync
- **[Issue Intelligence](issue-intelligence.md)** — Automated issue triage, template validation, duplicate detection, Bayesian threshold learning, and troubleshooting retrieval
- **[Guardrails](guardrails.md)** — Epistemic guardrail pipeline for claim classification, hallucination prevention, and context-grounded response filtering

## Operational Runbooks

Troubleshooting and operations guides in [`runbooks/`](runbooks/):

- **[Mentions Debug](runbooks/mentions.md)** — Debug `@kodiai` / `@claude` mentions that don't produce replies
- **[Review Requested Debug](runbooks/review-requested-debug.md)** — Debug manual re-request flows that don't trigger reviews
- **[Scale](runbooks/scale.md)** — Handle large PRs, long threads, and timeout issues
- **[Slack Integration](runbooks/slack-integration.md)** — Deploy and operate Slack integration
- **[Slack Webhook Relay](runbooks/slack-webhook-relay.md)** — Configure and troubleshoot verified webhook-to-Slack relay sources
- **[xbmc/xbmc Cutover](runbooks/xbmc-cutover.md)** — Cut over xbmc/xbmc from GitHub Actions to the Kodiai GitHub App
- **[xbmc/xbmc Ops](runbooks/xbmc-ops.md)** — Day-2 operations for xbmc/xbmc after cutover

## Smoke Tests & UAT Records

Test evidence and verification records in [`smoke/`](smoke/):

- **[Phase 27 UAT Notes](smoke/phase27-uat-notes.md)** — Path-instruction testing notes
- **[Phase 72: Telemetry Follow-Through](smoke/phase72-telemetry-follow-through.md)** — Release evidence for OPS-04/OPS-05 telemetry
- **[Phase 74: Reliability Regression Gate](smoke/phase74-reliability-regression-gate.md)** — Pre-release reliability gate for issue write-mode
- **[Phase 75: Live OPS Verification Closure](smoke/phase75-live-ops-verification-closure.md)** — Release candidate OPS closure procedure
- **[Phase 80: Slack Operator Hardening](smoke/phase80-slack-operator-hardening.md)** — Slack v1 channel gating and operator verification
- **[Slack Webhook Relay](smoke/slack-webhook-relay.md)** — Accepted, suppressed, and failed-delivery smoke path for webhook relay
- **[xbmc/kodiai Write Flow](smoke/xbmc-kodiai-write-flow.md)** — End-to-end write-mode smoke test for xbmc/kodiai
- **[xbmc/xbmc Write Flow](smoke/xbmc-xbmc-write-flow.md)** — End-to-end write-mode smoke test for xbmc/xbmc
