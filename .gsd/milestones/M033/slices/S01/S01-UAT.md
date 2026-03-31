# S01: Remove GITHUB_INSTALLATION_TOKEN from container env — UAT

**Milestone:** M033
**Written:** 2026-03-31T11:38:40.616Z

## UAT: Remove GITHUB_INSTALLATION_TOKEN from container env

### Preconditions
- Repository cloned, `bun install` done
- No local modifications to aca-launcher.ts, executor.ts, or their test files beyond what S01 delivered

---

### TC-01: APPLICATION_SECRET_NAMES contains GITHUB_INSTALLATION_TOKEN

**Purpose:** Confirm the token is permanently blocked at the enforcement-array level.

**Steps:**
1. Open `src/jobs/aca-launcher.ts`
2. Find the `APPLICATION_SECRET_NAMES` export

**Expected:** `"GITHUB_INSTALLATION_TOKEN"` appears in the array.

**Automated check:** `bun test ./src/jobs/aca-launcher.test.ts --test "GITHUB_INSTALLATION_TOKEN is in APPLICATION_SECRET_NAMES"` → pass

---

### TC-02: BuildAcaJobSpecOpts has no githubInstallationToken field

**Purpose:** Confirm static enforcement — the token cannot be injected via the options type.

**Steps:**
1. Open `src/jobs/aca-launcher.ts`
2. Inspect the `BuildAcaJobSpecOpts` interface

**Expected:** No `githubInstallationToken` field exists.

**Automated check:** `bun run tsc --noEmit` → exit 0 (would fail with type error if the field were referenced anywhere)

---

### TC-03: buildAcaJobSpec() env array never contains GITHUB_INSTALLATION_TOKEN

**Purpose:** Confirm runtime behavior — the spec produced by the function has no token entry.

**Steps:**
1. Run `bun test ./src/jobs/aca-launcher.test.ts --test "GITHUB_INSTALLATION_TOKEN always absent from spec env array"`

**Expected:** Test passes — `spec.env` does not contain any entry with `name === "GITHUB_INSTALLATION_TOKEN"`.

---

### TC-04: Runtime guard throws if token somehow injected

**Purpose:** Confirm defense-in-depth — even if a caller manufactured an env entry, buildAcaJobSpec throws.

**Steps:**
1. Run `bun test ./src/jobs/aca-launcher.test.ts --test "throws if APPLICATION_SECRET_NAMES passed via opts"`

**Expected:** Test passes — the function throws `"Security violation: APPLICATION_SECRET_NAMES found in ACA job env array"` when any APPLICATION_SECRET_NAMES key appears in the opts.additionalEnv.

---

### TC-05: Full test suite passes

**Purpose:** Confirm no regressions.

**Steps:**
1. Run `bun test ./src/jobs/aca-launcher.test.ts`

**Expected:** 21 pass, 0 fail.

---

### TC-06: TypeScript compiles cleanly

**Purpose:** Confirm executor.ts and executor.test.ts no longer reference the removed field.

**Steps:**
1. Run `bun run tsc --noEmit`

**Expected:** Exit 0, no output.

---

### Edge Cases

- **Passing githubInstallationToken to buildAcaJobSpec:** TypeScript will reject this at compile time (field does not exist on BuildAcaJobSpecOpts). No runtime path exists to inject the token.
- **Concurrent job executions:** Each job gets a fresh buildAcaJobSpec call with no githubInstallationToken in any opts — the enforcement is per-call, not stateful.
- **Future token needs:** If the agent ever requires a GitHub token, it must obtain one via its own installed GitHub App credentials or a per-job token injected through a separate mechanism reviewed against the APPLICATION_SECRET_NAMES allowlist.
