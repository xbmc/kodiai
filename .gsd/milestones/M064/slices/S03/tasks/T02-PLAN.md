---
estimated_steps: 1
estimated_files: 5
skills_used: []
---

# T02: Ship the S03 verifier/report command and lock its operator contract

Add the top-level `verify:m064:s03` script that uses the shared resolver/report builder to expose both human and JSON output. Follow the existing verifier/report style: deterministic fixture-driven default execution for CI, explicit invalid-arg handling, and optional operator-lookup mode driven by review output key input. Ensure the rendered report leads with authoritative outcome, final stop reason, authoritative attempt identity, projection status, and supersession metadata. Add script tests that keep expectations independent from the helper under test, prove degraded and pending projection statuses render explicitly, and verify package.json wiring for `verify:m064:s03`.

## Inputs

- ``src/knowledge/continuation-operator-evidence.ts``
- ``src/knowledge/continuation-operator-evidence.test.ts``
- ``scripts/verify-m064-s01.ts``
- ``scripts/verify-m064-s02.ts``
- ``scripts/usage-report.ts``
- ``package.json``

## Expected Output

- ``scripts/verify-m064-s03.ts``
- ``scripts/verify-m064-s03.test.ts``
- ``package.json``

## Verification

bun test scripts/verify-m064-s03.test.ts

## Observability Impact

Creates the operator-supported inspection surface. The command must make projection degradation, missing canonical rows, and malformed input visible in stable status codes and text/JSON detail so later agents can diagnose lifecycle state without reading logs.
