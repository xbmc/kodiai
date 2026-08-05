import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BoundedFileTooLargeError, readTextFileBounded } from "./bounded-file.ts";

describe("readTextFileBounded", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test("reads a file whose byte size equals the limit", async () => {
    dir = await mkdtemp(join(tmpdir(), "bounded-file-"));
    const path = join(dir, "value.txt");
    await Bun.write(path, "éé");
    await expect(readTextFileBounded(path, 4)).resolves.toBe("éé");
  });

  test("rejects before reading when byte size exceeds the limit", async () => {
    dir = await mkdtemp(join(tmpdir(), "bounded-file-"));
    const path = join(dir, "value.txt");
    await Bun.write(path, "secret-value");
    const error = await readTextFileBounded(path, 4).catch((caught) => caught);
    expect(error).toBeInstanceOf(BoundedFileTooLargeError);
    expect(error).toMatchObject({ path, actualBytes: 12, maxBytes: 4 });
    expect(String(error)).not.toContain("secret-value");
  });

  test("preserves the missing-file failure", async () => {
    dir = await mkdtemp(join(tmpdir(), "bounded-file-"));
    await expect(readTextFileBounded(join(dir, "missing.txt"), 4)).rejects.toThrow();
  });
});
