import { describe, expect, it } from "bun:test";
import { buildWritePolicyRefusalMessage } from "./write-policy-formatting.ts";

describe("write policy formatting", () => {
  it("does not import write-policy error types from job-layer modules", async () => {
    const source = await Bun.file(new URL("./write-policy-formatting.ts", import.meta.url)).text();

    expect(source).not.toContain("../jobs/");
  });

  it("formats neutral write-policy error contracts", async () => {
    const { WritePolicyError } = await import("./write-policy-error.ts");
    const message = buildWritePolicyRefusalMessage(
      new WritePolicyError("write-policy-not-allowed", "blocked", {
        path: "src/new-file.ts",
        rule: "allowPaths",
      }),
      ["src/**/*.ts"],
    );

    expect(message).toContain("Reason: write-policy-not-allowed");
    expect(message).toContain("File: src/new-file.ts");
    expect(message).toContain("Current allowPaths: 'src/**/*.ts'");
  });
});
