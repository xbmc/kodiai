import { describe, expect, test } from "bun:test";
import { extractReviewGraph } from "./extractors.ts";

const PYTHON_FIXTURE = `from app.helpers import helper
import pytest

class Service:
    def process(self, payload):
        helper(payload)
        return payload

def test_process_uses_helper():
    service = Service()
    service.process("ok")
`;

const CPP_FIXTURE = `#include <vector>
#include "service.h"

void helper() {
}

void runService() {
  helper();
}

void ServiceTest_runs_helper() {
  runService();
}
`;

describe("extractReviewGraph", () => {
  test("extracts python files, symbols, imports, calls, and probable test relationships", () => {
    const result = extractReviewGraph({
      repo: "owner/repo",
      workspaceKey: "workspace-a",
      path: "tests/test_service.py",
      content: PYTHON_FIXTURE,
      language: "python",
    });

    expect(result.file.language).toBe("python");
    expect(result.metrics.fileNodeCount).toBe(1);
    expect(result.metrics.symbolNodeCount).toBeGreaterThanOrEqual(2);
    expect(result.metrics.importNodeCount).toBeGreaterThanOrEqual(2);
    expect(result.metrics.callsiteNodeCount).toBeGreaterThanOrEqual(2);
    expect(result.metrics.testNodeCount).toBeGreaterThanOrEqual(1);
    expect(result.metrics.probableEdgeCount).toBeGreaterThanOrEqual(1);

    const symbolNames = result.nodes.filter((node) => node.nodeKind === "symbol").map((node) => node.qualifiedName);
    expect(symbolNames).toContain("Service.process");
    expect(symbolNames).toContain("test_process_uses_helper");

    const importTargets = result.nodes
      .filter((node) => node.nodeKind === "import")
      .map((node) => String(node.attributes?.target ?? ""));
    expect(importTargets).toContain("app.helpers");
    expect(importTargets).toContain("pytest");

    const callEdges = result.edges.filter((edge) => edge.edgeKind === "calls");
    expect(callEdges.some((edge) => edge.targetStableKey.includes("Service.process"))).toBe(true);

    const helperCallsite = result.nodes.find(
      (node) => node.nodeKind === "callsite" && node.qualifiedName === "helper",
    );
    expect(helperCallsite).toBeDefined();

    const testEdges = result.edges.filter((edge) => edge.edgeKind === "tests");
    expect(testEdges.length).toBeGreaterThanOrEqual(1);
    expect(testEdges.some((edge) => (edge.confidence ?? 0) >= 0.9)).toBe(true);
  });

  test("extracts cpp includes, symbols, callsites, and probable test confidence surfaces", () => {
    const result = extractReviewGraph({
      repo: "owner/repo",
      workspaceKey: "workspace-a",
      path: "src/service_test.cpp",
      content: CPP_FIXTURE,
      language: "cpp",
    });

    expect(result.file.language).toBe("cpp");
    expect(result.metrics.fileNodeCount).toBe(1);
    expect(result.metrics.symbolNodeCount).toBeGreaterThanOrEqual(3);
    expect(result.metrics.importNodeCount).toBe(2);
    expect(result.metrics.callsiteNodeCount).toBeGreaterThanOrEqual(2);
    expect(result.metrics.testNodeCount).toBeGreaterThanOrEqual(1);
    expect(result.metrics.probableEdgeCount).toBeGreaterThanOrEqual(1);

    const includeEdges = result.edges.filter((edge) => edge.edgeKind === "includes");
    expect(includeEdges).toHaveLength(2);

    const symbols = result.nodes.filter((node) => node.nodeKind === "symbol");
    expect(symbols.some((node) => node.qualifiedName === "helper")).toBe(true);
    expect(symbols.some((node) => node.qualifiedName === "runService")).toBe(true);
    expect(symbols.some((node) => node.qualifiedName === "ServiceTest_runs_helper")).toBe(true);

    const callEdges = result.edges.filter((edge) => edge.edgeKind === "calls");
    expect(callEdges.some((edge) => edge.targetStableKey.includes("helper"))).toBe(true);
    expect(callEdges.some((edge) => edge.targetStableKey.includes("runService"))).toBe(true);

    const testEdges = result.edges.filter((edge) => edge.edgeKind === "tests");
    expect(testEdges).toHaveLength(1);
    expect(testEdges[0]?.confidence).toBeGreaterThan(0.6);
    expect(testEdges[0]?.confidence).toBeLessThan(1);
  });
});
