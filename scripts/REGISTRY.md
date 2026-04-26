# Script Registry

This document is the canonical inventory for tracked files under `scripts/`.

Scope: every tracked `scripts/*.ts`, `scripts/*.test.ts`, and `scripts/*.sh` file must appear exactly once in the table below.

Usage contract:
- Use `package:<name>` for package-script entrypoints from `package.json`.
- Use `workflow:<path>#<command>` for direct workflow commands.
- Use `none` only when no package-script or direct workflow command references the file.
- `.sh` helpers and wrappers are represented inline as first-class rows; they are not implied by a separate appendix.

Lifecycle vocabulary:
- `active` — current operational or verification surface.
- `internal` — repo-local helper, test, or maintenance surface not intended as a primary operator entrypoint.
- `deprecated` — retained compatibility surface that should not gain new callers.
- `sunset` — retained only for bounded removal or historical verification.

| path | purpose | owner | lifecycle | usage |
| --- | --- | --- | --- | --- |
| scripts/backfill-issues.ts | Backfill utility for issues. | ops | active | workflow:.github/workflows/nightly-issue-sync.yml#run: bun scripts/backfill-issues.ts --sync |
| scripts/backfill-pr-evidence.ts | Backfill utility for pr evidence. | ops | internal | none |
| scripts/backfill-review-comments.ts | Backfill utility for review comments. | ops | active | package:backfill:reviews |
| scripts/backfill-wiki.ts | Backfill utility for wiki. | ops | active | package:backfill:wiki |
| scripts/check-migrations-have-downs.test.ts | Regression tests for check migrations have downs. | db | internal | none |
| scripts/check-migrations-have-downs.ts | Repository check for migrations have downs. | db | active | package:check:migrations-have-downs |
| scripts/check-orphaned-tests.test.ts | Regression tests for check orphaned tests. | repo | internal | none |
| scripts/check-orphaned-tests.ts | Repository check for orphaned tests. | repo | active | package:check:orphaned-tests |
| scripts/cleanup-legacy-branches.ts | Cleanup utility for legacy branches. | ops | internal | none |
| scripts/cleanup-wiki-issue.ts | Cleanup utility for wiki issue. | ops | internal | none |
| scripts/deploy-timeout-alignment.test.ts | Regression tests for deploy timeout alignment. | deploy | internal | none |
| scripts/deploy.test.ts | Regression tests for deploy. | deploy | internal | none |
| scripts/embedding-audit.test.ts | Regression tests for embedding audit. | repo | internal | none |
| scripts/embedding-audit.ts | Script for embedding audit. | ops | active | package:audit:embeddings |
| scripts/embedding-comparison.ts | Script for embedding comparison. | repo | internal | none |
| scripts/embedding-repair.test.ts | Regression tests for embedding repair. | repo | internal | none |
| scripts/embedding-repair.ts | Script for embedding repair. | ops | active | package:repair:embeddings |
| scripts/generate-wiki-updates.ts | Generator for wiki updates. | ops | internal | none |
| scripts/gh-pr-create.sh | Script for gh pr create. | repo | internal | none |
| scripts/gh-pr-set-body.sh | Script for gh pr set body. | repo | internal | none |
| scripts/migrate-sqlite-to-postgres.ts | Migration utility for sqlite to postgres. | db | active | package:migrate:sqlite-to-pg |
| scripts/phase-m061-token-regression-gate.test.ts | Regression tests for phase  m061 token regression gate. | repo | internal | none |
| scripts/phase-m061-token-regression-gate.ts | Proof or smoke harness for phase  m061 token regression gate. | repo | active | package:verify:m061:regression |
| scripts/phase72-telemetry-follow-through.test.ts | Regression tests for phase 72 telemetry follow through. | Phase72 | internal | none |
| scripts/phase72-telemetry-follow-through.ts | Proof or smoke harness for phase 72 telemetry follow through. | Phase72 | active | package:verify:phase72 |
| scripts/phase73-trigger-degraded-review.ts | Proof or smoke harness for phase 73 trigger degraded review. | Phase73 | active | package:trigger:phase73:degraded |
| scripts/phase74-reliability-regression-gate.test.ts | Regression tests for phase 74 reliability regression gate. | Phase74 | internal | none |
| scripts/phase74-reliability-regression-gate.ts | Proof or smoke harness for phase 74 reliability regression gate. | Phase74 | active | package:verify:phase74 |
| scripts/phase75-live-ops-verification-closure.test.ts | Regression tests for phase 75 live ops verification closure. | Phase75 | internal | none |
| scripts/phase75-live-ops-verification-closure.ts | Proof or smoke harness for phase 75 live ops verification closure. | Phase75 | active | package:verify:phase75 |
| scripts/phase80-slack-regression-gate.test.ts | Regression tests for phase 80 slack regression gate. | Phase80 | internal | none |
| scripts/phase80-slack-regression-gate.ts | Proof or smoke harness for phase 80 slack regression gate. | Phase80 | active | package:verify:phase80:regression |
| scripts/phase80-slack-smoke.test.ts | Regression tests for phase 80 slack smoke. | Phase80 | internal | none |
| scripts/phase80-slack-smoke.ts | Proof or smoke harness for phase 80 slack smoke. | Phase80 | active | package:verify:phase80:smoke |
| scripts/phase81-slack-write-regression-gate.test.ts | Regression tests for phase 81 slack write regression gate. | Phase81 | internal | none |
| scripts/phase81-slack-write-regression-gate.ts | Proof or smoke harness for phase 81 slack write regression gate. | Phase81 | active | package:verify:phase81:regression |
| scripts/phase81-slack-write-smoke.test.ts | Regression tests for phase 81 slack write smoke. | Phase81 | internal | none |
| scripts/phase81-slack-write-smoke.ts | Proof or smoke harness for phase 81 slack write smoke. | Phase81 | active | package:verify:phase81:smoke |
| scripts/provision-postgres.sh | Script for provision postgres. | repo | internal | none |
| scripts/publish-wiki-updates.ts | Publisher for wiki updates. | ops | internal | none |
| scripts/retriever-verify.test.ts | Regression tests for retriever verify. | repo | internal | none |
| scripts/retriever-verify.ts | Script for retriever verify. | repo | active | package:verify:retriever |
| scripts/sync-triage-reactions.ts | Sync utility for triage reactions. | ops | active | workflow:.github/workflows/nightly-reaction-sync.yml#run: bun scripts/sync-triage-reactions.ts |
| scripts/test-aca-job.ts | Test helper for aca job. | ops | internal | none |
| scripts/usage-report.test.ts | Regression tests for usage report. | repo | internal | none |
| scripts/usage-report.ts | Script for usage report. | repo | active | package:report |
| scripts/verify-m027-s01.test.ts | Regression tests for verify m027 s01. | M027 | internal | none |
| scripts/verify-m027-s01.ts | Verifier harness for m027 s01. | M027 | active | package:verify:m027:s01 |
| scripts/verify-m027-s02.test.ts | Regression tests for verify m027 s02. | M027 | internal | none |
| scripts/verify-m027-s02.ts | Verifier harness for m027 s02. | M027 | active | package:verify:m027:s02 |
| scripts/verify-m027-s03.test.ts | Regression tests for verify m027 s03. | M027 | internal | none |
| scripts/verify-m027-s03.ts | Verifier harness for m027 s03. | M027 | active | package:verify:m027:s03 |
| scripts/verify-m027-s04.test.ts | Regression tests for verify m027 s04. | M027 | internal | none |
| scripts/verify-m027-s04.ts | Verifier harness for m027 s04. | M027 | active | package:verify:m027:s04 |
| scripts/verify-m028-s02.test.ts | Regression tests for verify m028 s02. | M028 | internal | none |
| scripts/verify-m028-s02.ts | Verifier harness for m028 s02. | M028 | active | package:verify:m028:s02 |
| scripts/verify-m028-s03.test.ts | Regression tests for verify m028 s03. | M028 | internal | none |
| scripts/verify-m028-s03.ts | Verifier harness for m028 s03. | M028 | active | package:verify:m028:s03 |
| scripts/verify-m028-s04.test.ts | Regression tests for verify m028 s04. | M028 | internal | none |
| scripts/verify-m028-s04.ts | Verifier harness for m028 s04. | M028 | active | package:verify:m028:s04 |
| scripts/verify-m029-s04.test.ts | Regression tests for verify m029 s04. | M029 | internal | none |
| scripts/verify-m029-s04.ts | Verifier harness for m029 s04. | M029 | active | package:verify:m029:s04 |
| scripts/verify-m031.test.ts | Regression tests for verify m031. | M031 | internal | none |
| scripts/verify-m031.ts | Verifier harness for m031. | M031 | active | package:verify:m031 |
| scripts/verify-m032.test.ts | Regression tests for verify m032. | M032 | internal | none |
| scripts/verify-m032.ts | Verifier harness for m032. | M032 | active | package:verify:m032 |
| scripts/verify-m036-s01.test.ts | Regression tests for verify m036 s01. | M036 | internal | none |
| scripts/verify-m036-s01.ts | Verifier harness for m036 s01. | M036 | active | package:verify:m036:s01 |
| scripts/verify-m036-s02.test.ts | Regression tests for verify m036 s02. | M036 | internal | none |
| scripts/verify-m036-s02.ts | Verifier harness for m036 s02. | M036 | active | package:verify:m036:s02 |
| scripts/verify-m036-s03.test.ts | Regression tests for verify m036 s03. | M036 | internal | none |
| scripts/verify-m036-s03.ts | Verifier harness for m036 s03. | M036 | active | package:verify:m036:s03 |
| scripts/verify-m037-s01.test.ts | Regression tests for verify m037 s01. | M037 | internal | none |
| scripts/verify-m037-s01.ts | Verifier harness for m037 s01. | M037 | active | package:verify:m037:s01 |
| scripts/verify-m037-s02.test.ts | Regression tests for verify m037 s02. | M037 | internal | none |
| scripts/verify-m037-s02.ts | Verifier harness for m037 s02. | M037 | active | package:verify:m037:s02 |
| scripts/verify-m037-s03.test.ts | Regression tests for verify m037 s03. | M037 | internal | none |
| scripts/verify-m037-s03.ts | Verifier harness for m037 s03. | M037 | active | package:verify:m037:s03 |
| scripts/verify-m038-s02.test.ts | Regression tests for verify m038 s02. | M038 | internal | none |
| scripts/verify-m038-s02.ts | Verifier harness for m038 s02. | M038 | active | package:verify:m038:s02 |
| scripts/verify-m038-s03.test.ts | Regression tests for verify m038 s03. | M038 | internal | none |
| scripts/verify-m038-s03.ts | Verifier harness for m038 s03. | M038 | active | package:verify:m038:s03 |
| scripts/verify-m040-s02.test.ts | Regression tests for verify m040 s02. | M040 | internal | none |
| scripts/verify-m040-s02.ts | Verifier harness for m040 s02. | M040 | active | package:verify:m040:s02 |
| scripts/verify-m040-s03.test.ts | Regression tests for verify m040 s03. | M040 | internal | none |
| scripts/verify-m040-s03.ts | Verifier harness for m040 s03. | M040 | active | package:verify:m040:s03 |
| scripts/verify-m041-s02.test.ts | Regression tests for verify m041 s02. | M041 | internal | none |
| scripts/verify-m041-s02.ts | Verifier harness for m041 s02. | M041 | active | package:verify:m041:s02 |
| scripts/verify-m041-s03.test.ts | Regression tests for verify m041 s03. | M041 | internal | none |
| scripts/verify-m041-s03.ts | Verifier harness for m041 s03. | M041 | active | package:verify:m041:s03 |
| scripts/verify-m042-s01.test.ts | Regression tests for verify m042 s01. | M042 | internal | none |
| scripts/verify-m042-s01.ts | Verifier harness for m042 s01. | M042 | active | package:verify:m042:s01 |
| scripts/verify-m042-s02.test.ts | Regression tests for verify m042 s02. | M042 | internal | none |
| scripts/verify-m042-s02.ts | Verifier harness for m042 s02. | M042 | active | package:verify:m042:s02 |
| scripts/verify-m042-s03.test.ts | Regression tests for verify m042 s03. | M042 | internal | none |
| scripts/verify-m042-s03.ts | Verifier harness for m042 s03. | M042 | active | package:verify:m042:s03 |
| scripts/verify-m044-s01.test.ts | Regression tests for verify m044 s01. | M044 | internal | none |
| scripts/verify-m044-s01.ts | Verifier harness for m044 s01. | M044 | active | package:verify:m044, package:verify:m044:s01 |
| scripts/verify-m045-s01.test.ts | Regression tests for verify m045 s01. | M045 | internal | none |
| scripts/verify-m045-s01.ts | Verifier harness for m045 s01. | M045 | active | package:verify:m045:s01 |
| scripts/verify-m045-s03.test.ts | Regression tests for verify m045 s03. | M045 | internal | none |
| scripts/verify-m045-s03.ts | Verifier harness for m045 s03. | M045 | active | package:verify:m045:s03 |
| scripts/verify-m046-s01.test.ts | Regression tests for verify m046 s01. | M046 | internal | none |
| scripts/verify-m046-s01.ts | Verifier harness for m046 s01. | M046 | active | package:verify:m046:s01 |
| scripts/verify-m046-s02.test.ts | Regression tests for verify m046 s02. | M046 | internal | none |
| scripts/verify-m046-s02.ts | Verifier harness for m046 s02. | M046 | active | package:verify:m046:s02 |
| scripts/verify-m046.test.ts | Regression tests for verify m046. | M046 | internal | none |
| scripts/verify-m046.ts | Verifier harness for m046. | M046 | active | package:verify:m046 |
| scripts/verify-m047-s01.test.ts | Regression tests for verify m047 s01. | M047 | internal | none |
| scripts/verify-m047-s01.ts | Verifier harness for m047 s01. | M047 | active | package:verify:m047:s01 |
| scripts/verify-m047-s02.test.ts | Regression tests for verify m047 s02. | M047 | internal | none |
| scripts/verify-m047-s02.ts | Verifier harness for m047 s02. | M047 | active | package:verify:m047:s02 |
| scripts/verify-m047.test.ts | Regression tests for verify m047. | M047 | internal | none |
| scripts/verify-m047.ts | Verifier harness for m047. | M047 | active | package:verify:m047 |
| scripts/verify-m048-s01.test.ts | Regression tests for verify m048 s01. | M048 | internal | none |
| scripts/verify-m048-s01.ts | Verifier harness for m048 s01. | M048 | active | package:verify:m048:s01 |
| scripts/verify-m048-s02.test.ts | Regression tests for verify m048 s02. | M048 | internal | none |
| scripts/verify-m048-s02.ts | Verifier harness for m048 s02. | M048 | active | package:verify:m048:s02 |
| scripts/verify-m048-s03.test.ts | Regression tests for verify m048 s03. | M048 | internal | none |
| scripts/verify-m048-s03.ts | Verifier harness for m048 s03. | M048 | active | package:verify:m048:s03 |
| scripts/verify-m049-s02.test.ts | Regression tests for verify m049 s02. | M049 | internal | none |
| scripts/verify-m049-s02.ts | Verifier harness for m049 s02. | M049 | active | package:verify:m049:s02 |
| scripts/verify-m052-s01.test.ts | Regression tests for verify m052 s01. | M052 | internal | none |
| scripts/verify-m052-s01.ts | Verifier harness for m052 s01. | M052 | internal | none |
| scripts/verify-m052-s02.test.ts | Regression tests for verify m052 s02. | M052 | internal | none |
| scripts/verify-m052-s02.ts | Verifier harness for m052 s02. | M052 | internal | none |
| scripts/verify-m052.test.ts | Regression tests for verify m052. | M052 | internal | none |
| scripts/verify-m052.ts | Verifier harness for m052. | M052 | internal | none |
| scripts/verify-m053.test.ts | Regression tests for verify m053. | M053 | internal | none |
| scripts/verify-m053.ts | Verifier harness for m053. | M053 | active | package:verify:m053 |
| scripts/verify-m054-s01.test.ts | Regression tests for verify m054 s01. | M054 | internal | none |
| scripts/verify-m054-s01.ts | Verifier harness for m054 s01. | M054 | active | package:verify:m054:s01 |
| scripts/verify-m054-s02.test.ts | Regression tests for verify m054 s02. | M054 | internal | none |
| scripts/verify-m054-s02.ts | Verifier harness for m054 s02. | M054 | active | package:verify:m054:s02 |
| scripts/verify-m054-s03.test.ts | Regression tests for verify m054 s03. | M054 | internal | none |
| scripts/verify-m054-s03.ts | Verifier harness for m054 s03. | M054 | active | package:verify:m054:s03 |
| scripts/verify-m054-s04.test.ts | Regression tests for verify m054 s04. | M054 | internal | none |
| scripts/verify-m054-s04.ts | Verifier harness for m054 s04. | M054 | active | package:verify:m054:s04 |
| scripts/verify-m055-s01.test.ts | Regression tests for verify m055 s01. | M055 | internal | none |
| scripts/verify-m055-s01.ts | Verifier harness for m055 s01. | M055 | active | package:verify:m055:s01 |
| scripts/verify-m055-s02.test.ts | Regression tests for verify m055 s02. | M055 | internal | none |
| scripts/verify-m055-s02.ts | Verifier harness for m055 s02. | M055 | active | package:verify:m055:s02 |
| scripts/verify-m055-s03.test.ts | Regression tests for verify m055 s03. | M055 | internal | none |
| scripts/verify-m055-s03.ts | Verifier harness for m055 s03. | M055 | active | package:verify:m055:s03 |
| scripts/verify-m056-s01.test.ts | Regression tests for verify m056 s01. | M056 | internal | none |
| scripts/verify-m056-s01.ts | Verifier harness for m056 s01. | M056 | active | package:verify:m056:s01 |
| scripts/verify-m056-s02.test.ts | Regression tests for verify m056 s02. | M056 | internal | none |
| scripts/verify-m056-s02.ts | Verifier harness for m056 s02. | M056 | active | package:verify:m056:s02 |
| scripts/verify-m056-s03.test.ts | Regression tests for verify m056 s03. | M056 | internal | none |
| scripts/verify-m056-s03.ts | Verifier harness for m056 s03. | M056 | active | package:verify:m056:s03 |
| scripts/verify-m057-s01.test.ts | Regression tests for verify m057 s01. | M057 | internal | none |
| scripts/verify-m057-s01.ts | Verifier harness for m057 s01. | M057 | active | package:verify:m057:s01 |
| scripts/verify-m057-s02.test.ts | Regression tests for verify m057 s02. | M057 | internal | none |
| scripts/verify-m057-s02.ts | Verifier harness for m057 s02. | M057 | active | package:verify:m057:s02 |
| scripts/verify-m057-s03.test.ts | Regression tests for verify m057 s03. | M057 | internal | none |
| scripts/verify-m057-s03.ts | Verifier harness for m057 s03. | M057 | active | package:verify:m057:s03 |
| scripts/verify-m057-s04.test.ts | Regression tests for verify m057 s04. | M057 | internal | none |
| scripts/verify-m057-s04.ts | Verifier harness for m057 s04. | M057 | active | package:verify:m057:s04 |
| scripts/verify-m058-s01.test.ts | Regression tests for verify m058 s01. | M058 | internal | none |
| scripts/verify-m058-s01.ts | Verifier harness for m058 s01. | M058 | active | package:verify:m058:s01 |
| scripts/verify-m058-s02.test.ts | Regression tests for verify m058 s02. | M058 | internal | none |
| scripts/verify-m058-s02.ts | Verifier harness for m058 s02. | M058 | active | package:verify:m058:s02 |
| scripts/verify-m058-s03.test.ts | Regression tests for verify m058 s03. | M058 | internal | none |
| scripts/verify-m058-s03.ts | Verifier harness for m058 s03. | M058 | active | package:verify:m058:s03 |
| scripts/verify-m059-s01.test.ts | Regression tests for verify m059 s01. | M059 | internal | none |
| scripts/verify-m059-s01.ts | Verifier harness for m059 s01. | M059 | active | package:verify:m059:s01 |
| scripts/verify-m059-s02.test.ts | Regression tests for verify m059 s02. | M059 | internal | none |
| scripts/verify-m059-s02.ts | Verifier harness for m059 s02. | M059 | active | package:verify:m059:s02 |
| scripts/verify-m060-s01.test.ts | Regression tests for the M060 S01 direct-test coverage verifier. | M060 | internal | none |
| scripts/verify-m060-s01.ts | Verification CLI for the M060 S01 knowledge direct-test coverage contract. | M060 | active | package:verify:m060:s01 |
| scripts/verify-m060-s02.test.ts | Regression tests for the M060 S02 ownership-boundary verifier. | M060 | internal | none |
| scripts/verify-m060-s02.ts | Verification CLI for the M060 S02 M060-vs-M027 ownership-boundary contract. | M060 | active | package:verify:m060:s02 |
| scripts/verify-m061-s01.test.ts | Regression tests for verify m061 s01. | M061 | internal | none |
| scripts/verify-m061-s01.ts | Verifier harness for m061 s01. | M061 | active | package:verify:m061:s01 |
| scripts/verify-m061-s02.test.ts | Regression tests for verify m061 s02. | M061 | internal | none |
| scripts/verify-m061-s02.ts | Verifier harness for m061 s02. | M061 | active | package:verify:m061:s02 |
| scripts/verify-m061-s03.test.ts | Regression tests for verify m061 s03. | M061 | internal | none |
| scripts/verify-m061-s03.ts | Verifier harness for m061 s03. | M061 | active | package:verify:m061:s03 |
| scripts/verify-m061-s04.test.ts | Regression tests for verify m061 s04. | M061 | internal | none |
| scripts/verify-m061-s04.ts | Verifier harness for m061 s04. | M061 | active | package:verify:m061:s04 |
| scripts/verify-m061-s05.test.ts | Regression tests for verify m061 s05. | M061 | internal | none |
| scripts/verify-m061-s05.ts | Verifier harness for m061 s05. | M061 | active | package:verify:m061:s05 |
| scripts/verify-m062-s01.test.ts | Regression tests for verify m062 s01. | M062 | internal | none |
| scripts/verify-m062-s01.ts | Verifier harness for m062 s01. | M062 | active | package:verify:m062:s01 |
| scripts/verify-m062-s03.test.ts | Regression tests for verify m062 s03. | M062 | internal | none |
| scripts/verify-m062-s03.ts | Verifier harness for m062 s03. | M062 | active | package:verify:m062:s03 |
| scripts/verify-m063-s01.test.ts | Regression tests for verify m063 s01. | M063 | internal | none |
| scripts/verify-m063-s01.ts | Verifier harness for m063 s01. | M063 | active | package:verify:m063:s01 |
| scripts/verify-m063-s02.test.ts | Regression tests for verify m063 s02. | M063 | internal | none |
| scripts/verify-m063-s02.ts | Verifier harness for m063 s02. | M063 | active | package:verify:m063:s02 |
| scripts/verify-m063-s03.test.ts | Regression tests for verify m063 s03. | M063 | internal | none |
| scripts/verify-m063-s03.ts | Verifier harness for m063 s03. | M063 | active | package:verify:m063:s03 |
| scripts/verify-m064-s01.test.ts | Regression tests for verify m064 s01. | M064 | internal | none |
| scripts/verify-m064-s01.ts | Verifier harness for m064 s01. | M064 | active | package:verify:m064:s01 |
| scripts/verify-m064-s02.test.ts | Regression tests for verify m064 s02. | M064 | internal | none |
| scripts/verify-m064-s02.ts | Verifier harness for m064 s02. | M064 | active | package:verify:m064:s02 |
| scripts/verify-m064-s03.test.ts | Regression tests for verify m064 s03. | M064 | internal | none |
| scripts/verify-m064-s03.ts | Verifier harness for m064 s03. | M064 | active | package:verify:m064:s03 |
| scripts/verify-m065-s02.test.ts | Regression tests for verify m065 s02. | M065 | internal | none |
| scripts/verify-m065-s02.ts | Verifier harness for m065 s02. | M065 | active | package:verify:m065:s02 |
| scripts/verify-m065-s03.test.ts | Regression tests for verify m065 s03. | M065 | internal | none |
| scripts/verify-m065-s03.ts | Verifier harness for m065 s03. | M065 | active | package:verify:m065:s03 |
| scripts/verify-m065.test.ts | Regression tests for verify m065. | M065 | internal | none |
| scripts/verify-m065.ts | Verifier harness for m065. | M065 | active | package:verify:m065 |
| scripts/verify-phase127-fork-mode.ts | Verifier harness for phase 127 fork mode. | Phase127 | internal | none |
| scripts/wiki-embedding-backfill.ts | Script for wiki embedding backfill. | ops | internal | none |
| scripts/wiki-embedding-repair.test.ts | Regression tests for wiki embedding repair. | repo | internal | none |
| scripts/wiki-embedding-repair.ts | Script for wiki embedding repair. | ops | active | package:repair:wiki-embeddings |

## S02 Orphan Audit

| path | disposition | rationale |
| --- | --- | --- |
| scripts/backfill-pr-evidence.ts | retained | Retained as a repo-local operator or maintenance script without a package-script or workflow entrypoint. |
| scripts/check-migrations-have-downs.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/check-orphaned-tests.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/cleanup-legacy-branches.ts | retained | Retained as a repo-local operator or maintenance script without a package-script or workflow entrypoint. |
| scripts/cleanup-wiki-issue.ts | retained | Retained as a repo-local operator or maintenance script without a package-script or workflow entrypoint. |
| scripts/deploy-timeout-alignment.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/deploy.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/embedding-audit.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/embedding-comparison.ts | retained | Retained as a repo-local operator or maintenance script without a package-script or workflow entrypoint. |
| scripts/embedding-repair.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/generate-wiki-updates.ts | retained | Retained as a repo-local operator or maintenance script without a package-script or workflow entrypoint. |
| scripts/gh-pr-create.sh | retained | Retained as a repo-local shell helper; no direct package or workflow entrypoint references it today. |
| scripts/gh-pr-set-body.sh | retained | Retained as a repo-local shell helper; no direct package or workflow entrypoint references it today. |
| scripts/phase-m061-token-regression-gate.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/phase72-telemetry-follow-through.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/phase74-reliability-regression-gate.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/phase75-live-ops-verification-closure.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/phase80-slack-regression-gate.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/phase80-slack-smoke.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/phase81-slack-write-regression-gate.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/phase81-slack-write-smoke.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/provision-postgres.sh | retained | Retained as a repo-local shell helper; no direct package or workflow entrypoint references it today. |
| scripts/publish-wiki-updates.ts | retained | Retained as a repo-local operator or maintenance script without a package-script or workflow entrypoint. |
| scripts/retriever-verify.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/test-aca-job.ts | retained | Retained as a repo-local operator or maintenance script without a package-script or workflow entrypoint. |
| scripts/usage-report.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m027-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m027-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m027-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m027-s04.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m028-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m028-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m028-s04.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m029-s04.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m031.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m032.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m036-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m036-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m036-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m037-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m037-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m037-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m038-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m038-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m040-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m040-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m041-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m041-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m042-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m042-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m042-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m044-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m045-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m045-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m046-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m046-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m046.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m047-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m047-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m047.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m048-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m048-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m048-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m049-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m052-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m052-s01.ts | retained | Retained as a repo-local operator or maintenance script without a package-script or workflow entrypoint. |
| scripts/verify-m052-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m052-s02.ts | retained | Retained as a repo-local operator or maintenance script without a package-script or workflow entrypoint. |
| scripts/verify-m052.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m052.ts | retained | Retained as a repo-local operator or maintenance script without a package-script or workflow entrypoint. |
| scripts/verify-m053.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m054-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m054-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m054-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m054-s04.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m055-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m055-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m055-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m056-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m056-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m056-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m057-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m057-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m057-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m057-s04.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m058-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m058-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m058-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m059-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m059-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m060-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m060-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m061-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m061-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m061-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m061-s04.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m061-s05.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m062-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m062-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m063-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m063-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m063-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m064-s01.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m064-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m064-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m065-s02.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m065-s03.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-m065.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
| scripts/verify-phase127-fork-mode.ts | retained | Retained as a repo-local operator or maintenance script without a package-script or workflow entrypoint. |
| scripts/wiki-embedding-backfill.ts | retained | Retained as a repo-local operator or maintenance script without a package-script or workflow entrypoint. |
| scripts/wiki-embedding-repair.test.ts | retained | Retained as repo-local regression coverage; invoked by targeted `bun test` runs rather than package or workflow entrypoints. |
