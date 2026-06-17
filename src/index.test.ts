import { describe, expect, test } from "bun:test";

describe("production server entrypoint", () => {
  test("uses explicit Bun.serve instead of default-export auto serving", async () => {
    const source = await Bun.file(new URL("./index.ts", import.meta.url)).text();

    expect(source).toContain("Bun.serve");
    expect(source).not.toMatch(/export\s+default\s*\{/);
  });
});
