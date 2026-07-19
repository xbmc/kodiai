import { describe, expect, test } from "bun:test";
import { collectAddonRuleContext } from "./addon-rule-context.ts";

describe("collectAddonRuleContext", () => {
  test("groups changed files by addon and retains bounded scoped patches", () => {
    const contexts = collectAddonRuleContext({
      files: [
        {
          filename: "script.example/addon.xml",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-<addon version=\"1.0.0\"/>\n+<addon version=\"2.0.0\"/>",
        },
        {
          filename: "script.example/resources/lib/main.py",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-old()\n+new()",
        },
        {
          filename: "script.example/resources/settings.xml",
          status: "modified",
          additions: 2,
          deletions: 0,
          patch: "@@ -0,0 +1,2 @@\n+not\n+in scope",
        },
        { filename: "README.md", status: "modified", patch: "@@ -1 +1 @@" },
      ],
    });

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.addonId).toBe("script.example");
    expect(contexts[0]?.allChangedPaths).toEqual([
      "script.example/addon.xml",
      "script.example/resources/lib/main.py",
      "script.example/resources/settings.xml",
    ]);
    expect(contexts[0]?.files).toEqual([
      {
        path: "script.example/addon.xml",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-<addon version=\"1.0.0\"/>\n+<addon version=\"2.0.0\"/>",
      },
      {
        path: "script.example/resources/lib/main.py",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-old()\n+new()",
      },
      {
        path: "script.example/resources/settings.xml",
        status: "modified",
        additions: 2,
        deletions: 0,
        omittedReason: "out-of-scope",
      },
    ]);
  });

  test("marks a missing scoped patch unavailable instead of reading the workspace", () => {
    const contexts = collectAddonRuleContext({
      files: [{ filename: "script.example/default.py", status: "modified" }],
    });

    expect(contexts[0]?.files[0]).toEqual({
      path: "script.example/default.py",
      status: "modified",
      additions: undefined,
      deletions: undefined,
      omittedReason: "patch-unavailable",
    });
  });

  test("caps oversized patches and marks them truncated", () => {
    const contexts = collectAddonRuleContext({
      maxPatchChars: 4,
      files: [{
        filename: "script.example/default.py",
        status: "modified",
        patch: "abcdefghij",
      }],
    });

    expect(contexts[0]?.files[0]).toEqual({
      path: "script.example/default.py",
      status: "modified",
      additions: undefined,
      deletions: undefined,
      patch: "abcd",
      omittedReason: "truncated",
    });
  });

  test("normalizes paths, sorts addons, and ignores root-level files", () => {
    const contexts = collectAddonRuleContext({
      files: [
        { filename: "z.addon\\default.py", status: "added", patch: "+z" },
        { filename: "/a.addon/addon.xml", status: "added", patch: "+a" },
        { filename: "README.md", status: "modified", patch: "+root" },
      ],
    });

    expect(contexts.map((context) => context.addonId)).toEqual(["a.addon", "z.addon"]);
  });
});
