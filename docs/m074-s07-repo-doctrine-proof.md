# M074/S07 Repository Doctrine Proof

M074/S07 provides the executable R104 coverage proof for repository-declared review doctrine contracts. The accepted checked-in evidence is `scripts/fixtures/m074-s07-repo-doctrine-proof.json`, evaluated by:

```bash
bun run verify:m074:s07 -- --fixture scripts/fixtures/m074-s07-repo-doctrine-proof.json
```

The proof is intentionally compact and source-backed. It is not a live GitHub write test, and it does not require production credentials. Missing credentials are outside this proof path; the verifier checks committed source and a bounded fixture only.

## Accepted evidence

`verify:m074:s07` requires all of these checks to pass:

- `fixture.shape` — fixture uses the bounded `m074-s07-repo-doctrine-proof.v1` schema.
- `source.available` — fixture source is present and explicitly available.
- `config.schema.supported` — `.kodiai.yml` `review.doctrine` schema and fail-open malformed-contract fallback are implemented in source.
- `contract-types.covered` — all contract types from `REPO_DOCTRINE_CONTRACT_TYPES` are represented by aggregate fixture evidence.
- `review-plan.consumed` — ReviewPlan consumes a compact repo-doctrine projection and includes bounded summary diagnostics.
- `prompt.consumed` — prompt construction consumes bounded aggregate doctrine metadata only.
- `reducer.consumed` — reducer input and Review Details summary consume the aggregate projection.
- `review-details.aggregate` — Review Details exposes only bounded doctrine status/count/reason diagnostics.
- `handler.correlation` — the real review handler resolves, logs, and threads doctrine projection through plan, prompt, reducer, and details surfaces.
- `redaction.safe` — verifier output contains no raw doctrine text, prompts, model output, tool payloads, diffs, secrets, or canaries.
- `caps.enforced` — contract arrays, prompt contract lines, Review Details status lines, and reason code arrays stay under implementation caps.
- `side-effects.absent` — proof path creates no branch, separate PR, direct push, or public comment.
- `package-wiring.present` — `package.json` exposes `verify:m074:s07`.

The verifier also probes the source files that implement these surfaces, so config-only fixture evidence cannot pass if downstream consumption is removed.

## Public and private surfaces

Allowed public/diagnostic output is aggregate only:

- status code (`m074_s07_ok` or fail-closed status);
- check IDs and failed check IDs;
- contract, consumed, matched, omitted, and type coverage counts;
- bounded reason codes such as `disabled`, `skipped`, `parse-fallback`, `malformed-contract`, `unconsumed-contract`, and `redaction-applied`;
- redaction status and side-effect counters.

Forbidden output includes:

- raw `.kodiai.yml` doctrine instructions or evidence;
- raw prompts;
- raw model output;
- tool payloads;
- full diffs/patches;
- candidate bodies or public comment bodies;
- secrets or secret-like strings.

The verifier scans the fixture/report boundary for forbidden key names and canary values and reports only generic redaction failures, not the raw canary content.

## Failure semantics

The verifier fails closed for common false positives:

- config parsing exists but ReviewPlan does not consume doctrine evidence;
- prompt or reducer consumption is missing;
- Review Details leaks raw doctrine text or loses correlation;
- a contract type is missing;
- output exceeds caps;
- branch/PR/push/public-comment side-effect counters are nonzero;
- fixture is missing, malformed, or invalid JSON;
- package script wiring drifts.

Representative fail status codes:

- `m074_s07_contract_failed` — evidence shape is valid but one or more checks failed.
- `m074_s07_malformed_evidence` — fixture shape is malformed.
- `m074_s07_fixture_read_failed` — fixture path is missing or unreadable.
- `m074_s07_invalid_json` — fixture JSON could not be parsed.
- `m074_s07_invalid_arg` — CLI arguments are invalid.

## Commands

Run S07 verifier tests:

```bash
bun test scripts/verify-m074-s07.test.ts
```

Run the operator proof:

```bash
bun run verify:m074:s07 -- --fixture scripts/fixtures/m074-s07-repo-doctrine-proof.json
```

For machine-readable diagnostics:

```bash
bun run verify:m074:s07 -- --fixture scripts/fixtures/m074-s07-repo-doctrine-proof.json --json
```

## Requirement impact

This proof is the M074/S07 executable evidence for R104: repositories can declare bounded review invariant contracts in `.kodiai.yml`, and the review path consumes and exposes safe aggregate doctrine evidence. It replaces stale ownership-only claims with source-backed checks for config support, contract type coverage, ReviewPlan/prompt/reducer/Review Details/handler consumption, redaction, caps, and side-effect denial.

## Outside R104

S07 does not prove live repository adoption, user-authored doctrine quality, or broad production rollout. It also does not authorize repo doctrine to override system, security, publishing, or redaction policy. Doctrine remains untrusted repository-supplied metadata used only to focus review through bounded aggregate projections.
