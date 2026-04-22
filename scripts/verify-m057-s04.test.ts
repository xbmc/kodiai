import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("verify m057 s04", () => {
  test("exports the expected verifier command bundle", async () => {
    const verifier = await import("./verify-m057-s04.ts");

    expect(verifier.COMMAND_NAME).toBe("verify:m057:s04");
    expect(verifier.VERIFY_COMMANDS).toEqual([
      ["bun", "test", "./scripts/check-orphaned-tests.test.ts"],
      ["bun", "test", "./src/execution/executor.test.ts"],
      ["bun", "run", "./scripts/check-orphaned-tests.ts", "--json"],
    ]);
  });

  test("wires the package verifier command to the local script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m057:s04"]).toBe(
      "bun scripts/verify-m057-s04.ts",
    );
  });
});
