import { describe, it, expect, mock } from "bun:test";
import { createClusterStore } from "./cluster-store.ts";
import type { ClusterRunState, ReviewCluster } from "./cluster-types.ts";

// ── Mock SQL ─────────────────────────────────────────────────────────

function createMockSql(responses: Record<string, unknown[]> = {}) {
  let callIndex = 0;
  const calls: Array<{ query: string; values: unknown[] }> = [];

  const sqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    const keys = Object.keys(responses);
    const result = keys[callIndex] !== undefined
      ? responses[keys[callIndex]!]
      : [];
    callIndex++;
    return Promise.resolve(result ?? []);
  };

  return { sql: sqlFn as any, calls };
}

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

describe("createClusterStore", () => {
  it("creates store with all methods", () => {
    const { sql } = createMockSql();
    const store = createClusterStore({ sql, logger: createMockLogger() });

    expect(store.upsertCluster).toBeDefined();
    expect(store.getActiveClusters).toBeDefined();
    expect(store.retireCluster).toBeDefined();
    expect(store.updateClusterLabel).toBeDefined();
    expect(store.pinClusterLabel).toBeDefined();
    expect(store.writeAssignments).toBeDefined();
    expect(store.clearAssignments).toBeDefined();
    expect(store.getAssignmentsByCluster).toBeDefined();
    expect(store.getRunState).toBeDefined();
    expect(store.saveRunState).toBeDefined();
  });

  describe("getRunState", () => {
    it("returns defaults when no row exists", async () => {
      const { sql } = createMockSql({ select: [] });
      const store = createClusterStore({ sql, logger: createMockLogger() });

      const state = await store.getRunState();

      expect(state.lastRunAt).toBeNull();
      expect(state.clustersDiscovered).toBe(0);
      expect(state.commentsProcessed).toBe(0);
      expect(state.labelsGenerated).toBe(0);
      expect(state.status).toBe("pending");
      expect(state.errorMessage).toBeNull();
    });

    it("parses existing row", async () => {
      const { sql } = createMockSql({
        select: [{
          id: 1,
          last_run_at: "2026-02-25T00:00:00Z",
          clusters_discovered: 5,
          comments_processed: 100,
          labels_generated: 5,
          status: "completed",
          error_message: null,
          updated_at: "2026-02-25T00:00:00Z",
        }],
      });
      const store = createClusterStore({ sql, logger: createMockLogger() });

      const state = await store.getRunState();

      expect(state.status).toBe("completed");
      expect(state.clustersDiscovered).toBe(5);
      expect(state.commentsProcessed).toBe(100);
    });
  });

  describe("getActiveClusters", () => {
    it("returns parsed cluster records", async () => {
      const { sql } = createMockSql({});
      // Override to return cluster rows
      const mockSql = (strings: TemplateStringsArray, ...values: unknown[]) => {
        return Promise.resolve([{
          id: 1,
          created_at: "2026-02-25T00:00:00Z",
          updated_at: "2026-02-25T00:00:00Z",
          repo: "test/repo",
          slug: "null-check-missing",
          label: "Missing null checks",
          centroid: "[0.1,0.2,0.3]",
          member_count: 5,
          member_count_at_label: 4,
          file_paths: ["src/a.ts", "src/b.ts"],
          label_updated_at: "2026-02-25T00:00:00Z",
          pinned: false,
          retired: false,
        }]);
      };
      const store = createClusterStore({ sql: mockSql as any, logger: createMockLogger() });

      const clusters = await store.getActiveClusters("test/repo");

      expect(clusters.length).toBe(1);
      expect(clusters[0]!.slug).toBe("null-check-missing");
      expect(clusters[0]!.memberCount).toBe(5);
      expect(clusters[0]!.centroid).toBeInstanceOf(Float32Array);
      expect(clusters[0]!.centroid.length).toBe(3);
      expect(clusters[0]!.filePaths).toEqual(["src/a.ts", "src/b.ts"]);
    });

    it("returns empty array when no active clusters", async () => {
      const { sql } = createMockSql({ select: [] });
      const store = createClusterStore({ sql, logger: createMockLogger() });

      const clusters = await store.getActiveClusters("test/repo");

      expect(clusters).toEqual([]);
    });
  });

  describe("writeAssignments", () => {
    it("handles empty assignments array", async () => {
      const { sql, calls } = createMockSql();
      const store = createClusterStore({ sql, logger: createMockLogger() });

      await store.writeAssignments([]);

      // No SQL calls should be made for empty array
      expect(calls.length).toBe(0);
    });

    it("writes assignment records", async () => {
      const { sql, calls } = createMockSql();
      const store = createClusterStore({ sql, logger: createMockLogger() });

      await store.writeAssignments([
        { clusterId: 1, reviewCommentId: 10, probability: 0.95 },
        { clusterId: 1, reviewCommentId: 20, probability: 0.8 },
      ]);

      expect(calls.length).toBe(2);
    });
  });

  describe("saveRunState", () => {
    it("saves run state", async () => {
      const { sql, calls } = createMockSql();
      const store = createClusterStore({ sql, logger: createMockLogger() });

      const state: ClusterRunState = {
        lastRunAt: new Date("2026-02-25"),
        clustersDiscovered: 3,
        commentsProcessed: 50,
        labelsGenerated: 3,
        status: "completed",
        errorMessage: null,
      };

      await store.saveRunState(state);

      expect(calls.length).toBe(1);
    });
  });
});
