import { describe, expect, test } from "bun:test";

type VerifyModule = {
  evaluateM046S01?: unknown;
  renderM046S01Report?: unknown;
};

const importModule = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<unknown>;

async function loadVerifyModule(): Promise<VerifyModule | null> {
  return (await importModule("./verify-m046-s01.ts").catch(
    () => null,
  )) as VerifyModule | null;
}

describe("verify m046 s01", () => {
  test("exposes a verifier entrypoint and report renderer", async () => {
    const verifyModule = await loadVerifyModule();

    expect(verifyModule).not.toBeNull();
    if (!verifyModule) {
      return;
    }

    expect(typeof verifyModule.evaluateM046S01).toBe("function");
    expect(typeof verifyModule.renderM046S01Report).toBe("function");
  });
});
