import { describe, expect, test } from "bun:test";
import { detectScopeCoordination } from "./scope-coordinator.ts";

describe("detectScopeCoordination", () => {
  test("groups packages sharing a scope when 2+ present", () => {
    const result = detectScopeCoordination(["@babel/core", "@babel/parser"]);
    expect(result).toEqual([
      { scope: "@babel", packages: ["@babel/core", "@babel/parser"] },
    ]);
  });

  test("returns empty array when each scope has only one package", () => {
    const result = detectScopeCoordination(["@babel/core", "@types/node"]);
    expect(result).toEqual([]);
  });

  test("returns multiple groups when multiple scopes have 2+ packages", () => {
    const result = detectScopeCoordination([
      "@babel/core",
      "@babel/parser",
      "@types/node",
      "@types/jest",
    ]);

    expect(result).toEqual([
      { scope: "@babel", packages: ["@babel/core", "@babel/parser"] },
      { scope: "@types", packages: ["@types/jest", "@types/node"] },
    ]);
  });

  test("empty array returns empty result", () => {
    expect(detectScopeCoordination([])).toEqual([]);
  });

  test("non-scoped packages are ignored", () => {
    expect(detectScopeCoordination(["react", "lodash"])).toEqual([]);
  });

  test("single scoped package returns empty result", () => {
    expect(detectScopeCoordination(["@babel/core"])).toEqual([]);
  });
});
