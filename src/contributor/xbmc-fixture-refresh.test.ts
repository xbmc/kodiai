import { describe, expect, test } from "bun:test";

type RefreshModule = {
  refreshXbmcFixtureSnapshot?: unknown;
};

const importModule = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<unknown>;

async function loadRefreshModule(): Promise<RefreshModule | null> {
  return (await importModule("./xbmc-fixture-refresh.ts").catch(
    () => null,
  )) as RefreshModule | null;
}

describe("xbmc fixture refresh", () => {
  test("exposes a refresh entrypoint for rebuilding the xbmc snapshot", async () => {
    const refreshModule = await loadRefreshModule();

    expect(refreshModule).not.toBeNull();
    if (!refreshModule) {
      return;
    }

    expect(typeof refreshModule.refreshXbmcFixtureSnapshot).toBe("function");
  });
});
