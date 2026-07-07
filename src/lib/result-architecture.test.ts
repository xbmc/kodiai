import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";

describe("Result architecture", () => {
  test("keeps production Result returns behind shared constructors", () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const offenders: string[] = [];

    function scan(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          scan(path);
          continue;
        }
        if (!path.endsWith(".ts") || path.endsWith(".test.ts")) {
          continue;
        }

        const rel = relative(repoRoot, path);
        if (rel === "src/lib/result.ts") {
          continue;
        }

        const source = readFileSync(path, "utf8");
        if (
          /from\s+["'][^"']*\/result\.ts["']/.test(source)
          && /\breturn\s*\{\s*ok\s*:\s*(?:true|false)\b/.test(source)
        ) {
          offenders.push(rel);
        }
      }
    }

    scan(join(repoRoot, "src"));

    expect(offenders).toEqual([]);
  });

  test("keeps production result-like success flags behind the shared Result shape", () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const offenders: string[] = [];

    function scan(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          scan(path);
          continue;
        }
        if (!path.endsWith(".ts") || path.endsWith(".test.ts")) {
          continue;
        }

        const rel = relative(repoRoot, path);
        if (rel === "src/lib/result.ts") {
          continue;
        }

        const source = readFileSync(path, "utf8");
        if (/\bok\s*:\s*boolean\s*;/.test(source)) {
          offenders.push(rel);
        }
      }
    }

    scan(join(repoRoot, "src"));

    expect(offenders).toEqual([]);
  });
});
