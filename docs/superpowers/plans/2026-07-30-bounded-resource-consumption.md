# Bounded Resource Consumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound configuration, ACA result, fabricated-content diff, and staged secret-scan inputs without weakening current security or publication behavior.

**Architecture:** Add one canonical bounded-file reader and one streaming capped-line process primitive. File consumers reject oversized input before parsing; diff consumers scan incrementally, report incomplete advisory scans, and fail closed when a write-policy security scan cannot complete.

**Tech Stack:** Bun 1.3.8, TypeScript, Bun test, Git subprocesses.

## Global Constraints

- `.kodiai.yml` maximum size is exactly 256 KiB (`256 * 1024` bytes).
- ACA `result.json` maximum size is exactly 16 MiB (`16 * 1024 * 1024` bytes).
- Fabricated-content commit diff maximum output is exactly 2 MiB (`2 * 1024 * 1024` bytes).
- Staged write-policy diff maximum output is exactly 8 MiB (`8 * 1024 * 1024` bytes).
- Oversized configuration and result files must be rejected before `text()` or JSON/YAML parsing.
- Fabricated-content scanning is advisory: incomplete scans return an explicit bounded warning and must not be represented as complete.
- Secret scanning is mandatory when enabled: incomplete scans fail closed with `write-policy-secret-scan-incomplete`.
- No repository content may appear in over-limit error metadata or messages.
- Every production change follows red-green-refactor with a test observed failing for the intended reason before implementation.

---

### Task 1: Canonical bounded text-file reader

**Files:**
- Create: `src/lib/bounded-file.ts`
- Create: `src/lib/bounded-file.test.ts`

**Interfaces:**
- Consumes: Bun's `Bun.file(path)` API.
- Produces: `readTextFileBounded(path: string, maxBytes: number): Promise<string>` and `BoundedFileTooLargeError` with readonly `path`, `actualBytes`, and `maxBytes` fields.

- [ ] **Step 1: Write failing boundary tests**

Create `src/lib/bounded-file.test.ts` using a real temporary directory. The production changes that must make these tests fail are: removing the pre-read size check, changing `>` to `>=`, or leaking file contents into the error.

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BoundedFileTooLargeError, readTextFileBounded } from "./bounded-file.ts";

describe("readTextFileBounded", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test("reads a file whose byte size equals the limit", async () => {
    dir = await mkdtemp(join(tmpdir(), "bounded-file-"));
    const path = join(dir, "value.txt");
    await Bun.write(path, "éé");
    await expect(readTextFileBounded(path, 4)).resolves.toBe("éé");
  });

  test("rejects before reading when byte size exceeds the limit", async () => {
    dir = await mkdtemp(join(tmpdir(), "bounded-file-"));
    const path = join(dir, "value.txt");
    await Bun.write(path, "secret-value");
    const error = await readTextFileBounded(path, 4).catch((caught) => caught);
    expect(error).toBeInstanceOf(BoundedFileTooLargeError);
    expect(error).toMatchObject({ path, actualBytes: 12, maxBytes: 4 });
    expect(String(error)).not.toContain("secret-value");
  });

  test("preserves the missing-file failure", async () => {
    dir = await mkdtemp(join(tmpdir(), "bounded-file-"));
    await expect(readTextFileBounded(join(dir, "missing.txt"), 4)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `bun test src/lib/bounded-file.test.ts`

Expected: FAIL because `src/lib/bounded-file.ts` does not exist.

- [ ] **Step 3: Implement the bounded reader**

Create `src/lib/bounded-file.ts` with this public shape:

```ts
export class BoundedFileTooLargeError extends Error {
  constructor(
    readonly path: string,
    readonly actualBytes: number,
    readonly maxBytes: number,
  ) {
    super(`File exceeds ${maxBytes}-byte limit: ${path} (${actualBytes} bytes)`);
    this.name = "BoundedFileTooLargeError";
  }
}

export async function readTextFileBounded(path: string, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }
  const file = Bun.file(path);
  if (!(await file.exists())) return await file.text();
  if (file.size > maxBytes) throw new BoundedFileTooLargeError(path, file.size, maxBytes);
  return await file.text();
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `bun test src/lib/bounded-file.test.ts`

Expected: 3 tests pass with no warnings.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bounded-file.ts src/lib/bounded-file.test.ts
git commit -m "feat: add bounded text file reader"
```

### Task 2: Bound repository configuration and ACA results

**Files:**
- Modify: `src/execution/config.ts:758-769`
- Modify: `src/execution/config.test.ts`
- Modify: `src/jobs/aca-launcher.ts:56-57,580-587`
- Modify: `src/jobs/aca-launcher.test.ts:756-789`

**Interfaces:**
- Consumes: `readTextFileBounded` from Task 1.
- Produces: exported `MAX_REPO_CONFIG_BYTES = 256 * 1024` and `MAX_JOB_RESULT_BYTES = 16 * 1024 * 1024`; existing `loadRepoConfig` and `readJobResult` signatures remain unchanged.

- [ ] **Step 1: Write failing consumer boundary tests**

Add one real-file test to each existing test file. These tests catch either consumer reverting to unbounded `file.text()`.

```ts
test("rejects .kodiai.yml larger than 256 KiB before YAML parsing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-config-limit-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), `#${"x".repeat(256 * 1024)}`);
    await expect(loadRepoConfig(dir)).rejects.toMatchObject({
      actualBytes: 256 * 1024 + 1,
      maxBytes: 256 * 1024,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

```ts
test("rejects result.json larger than 16 MiB before JSON parsing", async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "aca-result-limit-"));
  await Bun.write(join(tmpDir, "result.json"), "x".repeat(16 * 1024 * 1024 + 1));
  await expect(readJobResult(tmpDir)).rejects.toMatchObject({
    actualBytes: 16 * 1024 * 1024 + 1,
    maxBytes: 16 * 1024 * 1024,
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `bun test src/execution/config.test.ts src/jobs/aca-launcher.test.ts`

Expected: both new tests fail because each consumer currently materializes the whole file.

- [ ] **Step 3: Route both consumers through the bounded reader**

In `config.ts`, export the limit and replace the direct read:

```ts
export const MAX_REPO_CONFIG_BYTES = 256 * 1024;
// ...
const raw = await readTextFileBounded(configPath, MAX_REPO_CONFIG_BYTES);
```

In `aca-launcher.ts`, export the result limit and replace the direct read:

```ts
export const MAX_JOB_RESULT_BYTES = 16 * 1024 * 1024;
// ...
const text = await readTextFileBounded(resultPath, MAX_JOB_RESULT_BYTES);
```

Do not catch `BoundedFileTooLargeError`; existing callers already convert read failures into the executor's failure shape.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `bun test src/lib/bounded-file.test.ts src/execution/config.test.ts src/jobs/aca-launcher.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/execution/config.ts src/execution/config.test.ts src/jobs/aca-launcher.ts src/jobs/aca-launcher.test.ts
git commit -m "fix: bound config and agent result reads"
```

### Task 3: Streaming capped-line subprocess primitive

**Files:**
- Modify: `src/lib/capped-process.ts`
- Modify: `src/lib/capped-process.test.ts`

**Interfaces:**
- Consumes: existing `runCommandWithCappedOutput` process and timeout conventions.
- Produces: `runCommandWithCappedLines(params): Promise<Omit<CappedProcessResult, "stdout"> & { stdout: "" }>` with `onStdoutLine(line: string): void` and no accumulated stdout text.

- [ ] **Step 1: Write failing streaming tests**

Add tests using `process.execPath` and `-e`. The production changes these catch are buffering stdout, losing a line across chunk boundaries, failing to flag truncation, or delivering bytes beyond the limit.

```ts
test("streams complete stdout lines without retaining stdout", async () => {
  const lines: string[] = [];
  const result = await runCommandWithCappedLines({
    command: process.execPath,
    args: ["-e", "process.stdout.write('alpha\\nbeta')"],
    maxStdoutBytes: 64,
    onStdoutLine: (line) => lines.push(line),
  });
  expect(lines).toEqual(["alpha", "beta"]);
  expect(result.stdout).toBe("");
  expect(result.stdoutTruncated).toBe(false);
});

test("stops line delivery and reports truncation at the byte limit", async () => {
  const lines: string[] = [];
  const result = await runCommandWithCappedLines({
    command: process.execPath,
    args: ["-e", "process.stdout.write('1234\\n5678\\n')"],
    maxStdoutBytes: 6,
    onStdoutLine: (line) => lines.push(line),
  });
  expect(lines).toEqual(["1234"]);
  expect(result.stdout).toBe("");
  expect(result.stdoutTruncated).toBe(true);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `bun test src/lib/capped-process.test.ts`

Expected: FAIL because `runCommandWithCappedLines` is not exported.

- [ ] **Step 3: Implement line streaming without duplicating process orchestration**

Refactor the private stream reader so it accepts an optional line sink and `captureText` flag. Maintain a decoder carry string, call `onStdoutLine` only for newline-terminated lines, and deliver the final unterminated line only when the stream completes without truncation. `runCommandWithCappedOutput` must retain byte-for-byte existing behavior.

Expose this exact parameter extension:

```ts
export async function runCommandWithCappedLines(params: {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxStdoutBytes: number;
  maxStderrBytes?: number;
  onStdoutLine(line: string): void;
}): Promise<CappedProcessResult>
```

Return `stdout: ""`; retain bounded `stderr`, exit code, timeout, and truncation fields.

- [ ] **Step 4: Run capped-process tests and verify GREEN**

Run: `bun test src/lib/capped-process.test.ts`

Expected: existing capped-output tests and both new streaming tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capped-process.ts src/lib/capped-process.test.ts
git commit -m "feat: stream capped subprocess lines"
```

### Task 4: Make fabricated-content scan completeness explicit

**Files:**
- Modify: `src/handlers/mention-pr-review-diff.ts:1-20`
- Modify: `src/handlers/mention-write-pr-draft.ts:1-49`
- Modify: `src/handlers/mention-write-pr-draft.test.ts`
- Create: `src/handlers/mention-pr-review-diff.test.ts`

**Interfaces:**
- Consumes: `runCommandWithCappedLines` from Task 3 and `scanLinesForFabricatedContent`.
- Produces: `FabricatedContentScanResult = { warnings: string[]; complete: boolean; reason?: "command-failed" | "output-truncated" }`; `scanDiffForFabricatedContent` returns this type.

- [ ] **Step 1: Write failing scan and draft tests**

Add a scanner test with an injected runner returning lines plus `stdoutTruncated: true`, and a draft test whose injected scanner returns an incomplete result. The draft must preserve real detector warnings and append exactly one bounded operational warning:

```ts
expect(result).toEqual({
  warnings: ["detected-marker"],
  complete: false,
  reason: "output-truncated",
});
```

```ts
expect(draft.warnings).toEqual([
  "detected-marker",
  "Fabricated-content scan incomplete; review the generated changes manually.",
]);
```

The scanner injection is a production seam, not a test-only method:

```ts
type RunDiffLines = (params: Parameters<typeof runCommandWithCappedLines>[0]) =>
  ReturnType<typeof runCommandWithCappedLines>;

export async function scanDiffForFabricatedContent(
  dir: string,
  runDiffLines: RunDiffLines = runCommandWithCappedLines,
): Promise<FabricatedContentScanResult>;
```

- [ ] **Step 2: Run tests and verify RED**

Run: `bun test src/handlers/mention-pr-review-diff.test.ts src/handlers/mention-write-pr-draft.test.ts`

Expected: FAIL because the scanner currently returns only `string[]` and has no completeness signal.

- [ ] **Step 3: Implement the typed scan**

Use `runCommandWithCappedLines` with:

```ts
export const FABRICATED_CONTENT_DIFF_MAX_BYTES = 2 * 1024 * 1024;
```

Collect only added lines (`+` but not `+++`). A non-zero exit, timeout, or thrown process error returns `{ warnings: [], complete: false, reason: "command-failed" }`. Truncation retains findings from delivered complete lines and returns `reason: "output-truncated"`.

Update `buildMentionWritePullRequestDraft` and its injection type to consume `FabricatedContentScanResult`. Append the operational warning only when `complete` is false, after detector warnings. Do not place command stderr or repository text in the warning.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `bun test src/handlers/mention-pr-review-diff.test.ts src/handlers/mention-write-pr-draft.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/mention-pr-review-diff.ts src/handlers/mention-pr-review-diff.test.ts src/handlers/mention-write-pr-draft.ts src/handlers/mention-write-pr-draft.test.ts
git commit -m "fix: expose incomplete fabricated-content scans"
```

### Task 5: Fail closed on incomplete staged secret scans

**Files:**
- Modify: `src/lib/write-policy-error.ts`
- Modify: `src/lib/write-policy-formatting.ts`
- Modify: `src/jobs/workspace.ts:306-439`
- Modify: `src/jobs/workspace.test.ts`

**Interfaces:**
- Consumes: `runCommandWithCappedLines` from Task 3.
- Produces: `write-policy-secret-scan-incomplete` error code and `maxBytes?: number` metadata; existing successful and secret-detected behavior remains unchanged.

- [ ] **Step 1: Write failing fail-closed and formatting tests**

Add an injectable `runStagedDiffLines` option to `enforceWritePolicy`'s input type in the test's desired API. Use a fake that calls `onStdoutLine` with a safe added line and returns `stdoutTruncated: true`. Assert:

```ts
await expect(enforceWritePolicy({
  dir,
  stagedPaths: ["src/value.ts"],
  allowPaths: [],
  denyPaths: [],
  secretScanEnabled: true,
  runStagedDiffLines: async (params) => {
    params.onStdoutLine("diff --git a/src/value.ts b/src/value.ts");
    params.onStdoutLine("+++ b/src/value.ts");
    params.onStdoutLine("+export const value = 1;");
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false, stdoutTruncated: true, stderrTruncated: false };
  },
})).rejects.toMatchObject({
  code: "write-policy-secret-scan-incomplete",
  rule: "secretScan",
  maxBytes: 8 * 1024 * 1024,
});
```

Add a formatter assertion that the refusal states the scan was incomplete, recommends reducing/splitting the change, includes the byte limit, and contains no staged content.

- [ ] **Step 2: Run tests and verify RED**

Run: `bun test src/jobs/workspace.test.ts`

Expected: FAIL because the error code, metadata, runner seam, and fail-closed path do not exist.

- [ ] **Step 3: Implement one-pass per-file secret scanning**

Export:

```ts
export const STAGED_SECRET_SCAN_MAX_BYTES = 8 * 1024 * 1024;
```

Extend `WritePolicyError` with `write-policy-secret-scan-incomplete` and readonly `maxBytes`. Replace whole-diff maps with streaming per-file state:

```ts
type StagedSecretScanState = {
  currentPath?: string;
  addedLinesByPath: Map<string, string[]>;
};
```

The line sink changes `currentPath` on `diff --git` headers, ignores metadata and removed/context lines, strips the leading `+`, and retains added lines only for `stagedPaths`. Run existing regex and entropy detectors over each file's bounded added-line collection. If the process times out, exits non-zero, throws, or truncates, throw `write-policy-secret-scan-incomplete` before accepting the write.

Update `buildWritePolicyRefusalMessage` with a dedicated incomplete-scan branch. Do not reuse the “remove/redact a secret” guidance because no secret was necessarily found.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `bun test src/jobs/workspace.test.ts src/handlers/mention-write-pr-draft.test.ts`

Expected: write-policy and mention draft tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/write-policy-error.ts src/lib/write-policy-formatting.ts src/jobs/workspace.ts src/jobs/workspace.test.ts
git commit -m "fix: fail closed on incomplete secret scans"
```

### Task 6: Bounded-resource integration verification

**Files:**
- Modify only if verification exposes a regression in files changed by Tasks 1-5.

**Interfaces:**
- Consumes: all interfaces produced by Tasks 1-5.
- Produces: fresh verification evidence for the complete bounded-resource slice.

- [ ] **Step 1: Run the complete targeted test set**

Run:

```bash
bun test \
  src/lib/bounded-file.test.ts \
  src/lib/capped-process.test.ts \
  src/execution/config.test.ts \
  src/jobs/aca-launcher.test.ts \
  src/handlers/mention-pr-review-diff.test.ts \
  src/handlers/mention-write-pr-draft.test.ts \
  src/jobs/workspace.test.ts
```

Expected: all targeted tests pass with zero failures.

- [ ] **Step 2: Run static verification**

Run:

```bash
bunx tsc --noEmit
bun run lint
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the repository test lanes**

Run:

```bash
bun run test:unit
bun run test:db
```

Expected: both lanes exit 0 with zero failing tests.

- [ ] **Step 4: Handle any verification regression through the owning task**

If verification exposes a regression, reopen the task that owns the affected interface, add a failing regression test there, observe RED, implement the smallest correction, rerun that task's covering tests, and use that task's explicit commit command. If verification is clean, do not create an empty commit.
