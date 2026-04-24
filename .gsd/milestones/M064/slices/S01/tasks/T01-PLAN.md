---
estimated_steps: 1
estimated_files: 6
skills_used: []
---

# T01: Define the canonical continuation-family schema, enums, and store/query seam

Add the dedicated durable continuation-family authority surface chosen in D187 so continuation truth stops living in `review_checkpoints` JSON or `resilience_events` rows. Create the migration, TypeScript contract types, and store methods needed to upsert/read one canonical family record keyed by review family identity plus base `reviewOutputKey`, with controlled enums for authoritative outcome and final stop reason. Cover restart-shaped durability and supersession-safe compare/update behavior with real store tests before any handler wiring.

## Inputs

- ``src/db/migrations/001-initial-schema.sql``
- ``src/knowledge/types.ts``
- ``src/knowledge/store.ts``
- ``src/knowledge/store.test.ts``
- ``src/handlers/review-idempotency.ts``

## Expected Output

- ``src/db/migrations/039-continuation-family-state.sql``
- ``src/db/migrations/039-continuation-family-state.down.sql``
- ``src/knowledge/types.ts``
- ``src/knowledge/store.ts``
- ``src/knowledge/store.test.ts``

## Verification

bun test src/knowledge/store.test.ts

## Observability Impact

Adds the durable inspection surface that later verifier/report tooling will query directly instead of scraping checkpoint or telemetry projections.
