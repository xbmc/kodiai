# S04: verify:m032 Proof Harness + Deploy Updates

**Goal:** Contract proof harness scripts/verify-m032.ts exits 0 across all pure-code checks. deploy.sh idempotently creates all required Azure resources: Storage account, Files share, volume mounts on both containers, ACA Job definition, managed identity role assignment.
**Demo:** After this: After S04: bun run verify:m032 → all checks pass, exits 0. ./deploy.sh run against existing env → all Azure resources verified/created, exits 0 (idempotent re-run succeeds).

## Tasks
