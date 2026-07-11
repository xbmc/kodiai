import { describe, expect, test } from "bun:test";

describe("production server entrypoint", () => {
  test("uses explicit Bun.serve instead of default-export auto serving", async () => {
    const source = await Bun.file(new URL("./index.ts", import.meta.url)).text();

    expect(source).toContain("Bun.serve");
    expect(source).not.toMatch(/export\s+default\s*\{/);
  });

  test("does not block startup on Azure Files stale workspace cleanup", async () => {
    const source = await Bun.file(new URL("./index.ts", import.meta.url)).text();

    expect(source).toContain("scheduleAzureFilesWorkspaceCleanup");
    expect(source).toContain("void cleanupStaleAzureFilesWorkspaceDirs");
    expect(source).not.toContain("const azureFilesStaleCount = await cleanupStaleAzureFilesWorkspaceDirs");
  });
});
