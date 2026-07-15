import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

describe("Dockerfile runtime permissions", () => {
  test("makes runtime files readable before switching to the bun user", () => {
    const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
    const copyDistIndex = dockerfile.indexOf("COPY --from=deps /app/dist ./dist");
    const chmodIndex = dockerfile.indexOf("chmod a+rx /app");
    const userIndex = dockerfile.indexOf("USER bun");

    expect(copyDistIndex).toBeGreaterThanOrEqual(0);
    expect(chmodIndex).toBeGreaterThan(copyDistIndex);
    expect(chmodIndex).toBeLessThan(userIndex);
    expect(dockerfile).toContain("chmod a+r /app/package.json /app/bun.lock /app/tsconfig.json");
    expect(dockerfile).toContain("chmod -R a+rX /app/dist /app/node_modules");
  });
});
