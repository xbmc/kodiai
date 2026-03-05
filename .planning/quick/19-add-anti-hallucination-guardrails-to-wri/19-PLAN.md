---
phase: quick-19
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
autonomous: true
requirements: [GUARD-01, GUARD-02]
must_haves:
  truths:
    - "Write-mode prompt instructs agent to never fabricate checksums, hashes, URLs, or version numbers"
    - "Write-mode prompt instructs agent to verify build-system completeness"
    - "Staged diff is scanned for repeating hex patterns before PR creation"
    - "PR body includes warnings section when suspicious patterns detected"
  artifacts:
    - path: "src/handlers/mention.ts"
      provides: "Anti-hallucination prompt instructions and scanDiffForFabricatedContent function"
      contains: "NEVER fabricate checksums"
    - path: "src/handlers/mention.test.ts"
      provides: "Tests for scanDiffForFabricatedContent"
      contains: "scanDiffForFabricatedContent"
  key_links:
    - from: "scanDiffForFabricatedContent"
      to: "generatePrBody"
      via: "warnings array passed into PR body generation"
      pattern: "warnings.*length"
---

<objective>
Add anti-hallucination guardrails to write-mode execution in the mention handler.

Purpose: Prevent the Claude agent from fabricating checksums, hashes, version numbers, and other verifiable data when creating PRs. Also detect fabricated content in diffs post-execution.
Output: Strengthened write-mode prompt + post-write diff scanner + warnings in PR body
</objective>

<execution_context>
@/home/keith/.claude/get-shit-done/workflows/execute-plan.md
@/home/keith/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/handlers/mention.ts
@src/handlers/mention.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Strengthen write-mode prompt and add diff scanner function</name>
  <files>src/handlers/mention.ts</files>
  <action>
Two changes to src/handlers/mention.ts:

**1. Strengthen writeInstructions (line ~1498)**

Add these lines to the writeInstructions array (the `writeEnabled` branch), after "Keep changes minimal and focused on the request.":

```
- NEVER fabricate checksums, hashes, version numbers, download URLs, or any verifiable data. If you need a real value (e.g. a SHA512 of a download), leave a clearly-marked TODO placeholder like `SHA512=TODO_REPLACE_WITH_REAL_HASH` instead of generating a fake one.
- NEVER invent API endpoints, package names, or configuration values that you have not verified exist in the codebase.
- Verify completeness: if you add a new module/component, trace it through the build system and make sure it is actually wired in (e.g., find_package calls, CMakeLists.txt, imports, etc.).
```

**2. Add scanDiffForFabricatedContent function**

Add a new exported-from-closure function (near the other helper functions like `generatePrBody` around line 380-432) called `scanDiffForFabricatedContent`:

```ts
async function scanDiffForFabricatedContent(dir: string): Promise<string[]> {
  const warnings: string[] = [];
  let diffText: string;
  try {
    diffText = (await $`git -C ${dir} diff HEAD~1 HEAD`.quiet()).text();
  } catch {
    return warnings; // no diff available, skip scan
  }

  const addedLines = diffText
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"));

  // Detect repeating hex patterns (classic hallucination signature)
  // Match 32+ char hex strings, then check if any 16-char substring repeats
  const hexPattern = /[0-9a-fA-F]{32,}/g;
  for (const line of addedLines) {
    let match: RegExpExecArray | null;
    while ((match = hexPattern.exec(line)) !== null) {
      const hex = match[0];
      // Check for 16-char substring repetition
      if (hex.length >= 32) {
        const half = hex.substring(0, 16);
        if (hex.includes(half, 16)) {
          warnings.push(
            `Suspicious repeating hex pattern in added line: \`${hex.substring(0, 40)}...\``,
          );
          break;
        }
      }
      // Check for all-same-character hex strings (e.g. "aaaaaa...")
      if (hex.length >= 32 && new Set(hex.toLowerCase()).size <= 2) {
        warnings.push(
          `Suspicious low-entropy hex pattern in added line: \`${hex.substring(0, 40)}...\``,
        );
        break;
      }
    }
  }

  return warnings;
}
```

**3. Wire diff scan into PR creation flow (line ~1949-1973)**

After the diffStat capture (line ~1949-1954) and before `generatePrBody` (line ~1962), add:

```ts
let fabricationWarnings: string[] = [];
try {
  fabricationWarnings = await scanDiffForFabricatedContent(workspace.dir);
} catch {
  // best-effort scan, do not block PR creation
}
```

**4. Update generatePrBody to accept and render warnings**

Add optional `warnings?: string[]` parameter to generatePrBody's params type.

In the function body, before the final `return lines.join("\n")`, add:

```ts
if (params.warnings && params.warnings.length > 0) {
  // Insert warnings before the metadata details block
  lines.splice(lines.indexOf("---"), 0,
    "## Automated warnings",
    "",
    ...params.warnings.map((w) => `- ${w}`),
    "",
  );
}
```

Pass `warnings: fabricationWarnings` in the generatePrBody call at line ~1962.
  </action>
  <verify>
    <automated>cd /home/keith/src/kodiai && npx tsc --noEmit src/handlers/mention.ts 2>&1 | head -20</automated>
  </verify>
  <done>
    - writeInstructions contains "NEVER fabricate checksums" text
    - scanDiffForFabricatedContent function exists and detects repeating hex patterns
    - generatePrBody accepts warnings param and renders them in PR body
    - Warnings are captured and passed through in the PR creation flow
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add tests for scanDiffForFabricatedContent</name>
  <files>src/handlers/mention.test.ts</files>
  <behavior>
    - Test: repeating hex pattern like "d1e5de5edf8d6add" repeated produces a warning
    - Test: all-same-char hex pattern like "aaaa...aaa" (32+ chars) produces a warning
    - Test: legitimate hex string (random, non-repeating, 64 chars) produces no warning
    - Test: diff with no hex strings produces no warnings
    - Test: short hex strings (< 32 chars) are ignored
  </behavior>
  <action>
Since scanDiffForFabricatedContent is defined inside createMentionHandler closure, we need to test it indirectly or extract the scanning logic.

Better approach: Extract the hex-scanning logic into a pure function `scanLinesForFabricatedContent(addedLines: string[]): string[]` that takes already-parsed added lines. Export this from mention.ts (or a small utility file if preferred, but keeping in mention.ts is fine since it's already large).

In Task 1, refactor: keep `scanDiffForFabricatedContent` as the git-calling wrapper, but have it delegate to `scanLinesForFabricatedContent` which is a pure function exported at module level.

Then in mention.test.ts, add a describe block:

```ts
describe("scanLinesForFabricatedContent", () => {
  test("detects repeating hex pattern", () => {
    const repeating = "d1e5de5edf8d6addd1e5de5edf8d6addd1e5de5edf8d6addd1e5de5edf8d6add";
    const warnings = scanLinesForFabricatedContent([`+SHA512=${repeating}`]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("repeating hex");
  });

  test("detects all-same-char hex", () => {
    const allA = "a".repeat(64);
    const warnings = scanLinesForFabricatedContent([`+hash=${allA}`]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("low-entropy");
  });

  test("ignores legitimate hex strings", () => {
    const legit = "3a7b9c2e1f4d8a6b5c0e7f2d9a4b8c1e6f3d7a0b5c9e2f8d1a4b7c0e3f6d9a";
    const warnings = scanLinesForFabricatedContent([`+SHA512=${legit}`]);
    expect(warnings).toEqual([]);
  });

  test("ignores short hex strings", () => {
    const short = "abcdef1234567890";
    const warnings = scanLinesForFabricatedContent([`+hash=${short}`]);
    expect(warnings).toEqual([]);
  });

  test("returns empty for lines without hex", () => {
    const warnings = scanLinesForFabricatedContent(["+const x = 42;", "+// comment"]);
    expect(warnings).toEqual([]);
  });
});
```
  </action>
  <verify>
    <automated>cd /home/keith/src/kodiai && bun test src/handlers/mention.test.ts 2>&1 | tail -30</automated>
  </verify>
  <done>
    - All 5 test cases pass
    - Repeating hex and low-entropy patterns are detected
    - Legitimate and short hex strings produce no false positives
  </done>
</task>

</tasks>

<verification>
- `bun test src/handlers/mention.test.ts` passes all tests including new scanLines tests
- `npx tsc --noEmit` shows no type errors in mention.ts
- grep confirms "NEVER fabricate" appears in mention.ts writeInstructions
</verification>

<success_criteria>
- Write-mode prompt contains anti-hallucination instructions (3 new bullet points)
- scanLinesForFabricatedContent is a testable pure function detecting repeating and low-entropy hex
- scanDiffForFabricatedContent wraps the pure function with git diff
- PR body includes "Automated warnings" section when suspicious patterns found
- All existing and new tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/19-add-anti-hallucination-guardrails-to-wri/19-SUMMARY.md`
</output>
