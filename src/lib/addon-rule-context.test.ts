import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectAddonRuleContext } from "./addon-rule-context.ts";

const tempDirs: string[] = [];

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-addon-rule-context-"));
  tempDirs.push(dir);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(dir, relativePath);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, content);
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("collectAddonRuleContext", () => {
  test("groups changed files by addon and reads scoped file content", async () => {
    const workspaceDir = await makeWorkspace({
      "plugin.video.foo/addon.xml": "<addon id='plugin.video.foo' />",
      "plugin.video.foo/resources/lib/main.py": "print('hello')",
      "plugin.video.foo/resources/web/app.js": "console.log('hello')",
      "plugin.video.foo/resources/settings.xml": "<settings />",
      "plugin.video.foo/LICENSE.txt": "GPL-2.0-or-later",
      "README.md": "root readme",
    });

    const contexts = await collectAddonRuleContext({
      workspaceDir,
      files: [
        { filename: "plugin.video.foo/addon.xml" },
        { filename: "plugin.video.foo/resources/lib/main.py" },
        { filename: "plugin.video.foo/resources/web/app.js" },
        { filename: "plugin.video.foo/resources/settings.xml" },
        { filename: "README.md" },
      ],
    });

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.addonId).toBe("plugin.video.foo");
    expect(contexts[0]?.hasLicenseFile).toBe(true);
    expect(contexts[0]?.allChangedPaths).toContain("plugin.video.foo/resources/settings.xml");
    expect(contexts[0]?.allChangedPaths).not.toContain("README.md");
    expect(contexts[0]?.files).toEqual([
      { path: "plugin.video.foo/addon.xml", content: "<addon id='plugin.video.foo' />" },
      { path: "plugin.video.foo/resources/lib/main.py", content: "print('hello')" },
      { path: "plugin.video.foo/resources/settings.xml", omittedReason: "out-of-scope" },
      { path: "plugin.video.foo/resources/web/app.js", content: "console.log('hello')" },
    ]);
  });

  test("truncates large scoped file content", async () => {
    const workspaceDir = await makeWorkspace({
      "script.module.foo/default.py": "abcdefghij",
    });

    const contexts = await collectAddonRuleContext({
      workspaceDir,
      maxFileChars: 4,
      files: [{ filename: "script.module.foo/default.py" }],
    });

    expect(contexts[0]?.files[0]).toEqual({
      path: "script.module.foo/default.py",
      content: "abcd",
      omittedReason: "truncated",
    });
  });

  test("omits missing scoped file content without throwing", async () => {
    const workspaceDir = await makeWorkspace({});

    const contexts = await collectAddonRuleContext({
      workspaceDir,
      files: [{ filename: "plugin.video.missing/addon.xml" }],
    });

    expect(contexts[0]?.files[0]).toEqual({
      path: "plugin.video.missing/addon.xml",
      omittedReason: "missing",
    });
    expect(contexts[0]?.hasLicenseFile).toBe(false);
  });
});
