import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

describe("Dockerfile runtime permissions", () => {
  test("makes bundled migrations readable before switching to the bun user", () => {
    const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
    const copyDistIndex = dockerfile.indexOf("COPY --from=deps /app/dist ./dist");
    const chmodIndex = dockerfile.indexOf("chmod -R a+rX /app/dist/migrations");
    const userIndex = dockerfile.indexOf("USER bun");

    expect(copyDistIndex).toBeGreaterThanOrEqual(0);
    expect(chmodIndex).toBeGreaterThan(copyDistIndex);
    expect(chmodIndex).toBeLessThan(userIndex);
  });
});
