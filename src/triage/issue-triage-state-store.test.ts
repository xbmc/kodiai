import { describe, expect, it } from "bun:test";
import type { Sql } from "../db/client.ts";
import { createIssueTriageStateStore } from "./issue-triage-state-store.ts";

function createSqlHarness(opts?: {
  claimRows?: Array<{ delivery_id: string }>;
  recordRows?: Array<{ id: number }>;
  confirmRows?: Array<{ id: number }>;
  storeRows?: Array<{ id: number }>;
}) {
  const calls: Array<{ strings: string[]; values: unknown[] }> = [];
  const fn = async (...args: unknown[]) => {
    const strings = Array.from(args[0] as TemplateStringsArray);
    const joined = strings.join("");
    const values = args.slice(1);
    calls.push({ strings, values });

    if (joined.includes("INSERT INTO issue_triage_state")) {
      return opts?.claimRows ?? [{ delivery_id: "delivery-1" }];
    }
    if (joined.includes("SET duplicate_count")) {
      return opts?.recordRows ?? [{ id: 1 }];
    }
    if (joined.includes("duplicate_count IS NOT NULL")) {
      return opts?.confirmRows ?? [{ id: 1 }];
    }
    if (joined.includes("SET comment_github_id")) {
      return opts?.storeRows ?? [{ id: 1 }];
    }
    return [];
  };

  return {
    sql: new Proxy(fn, {
      apply: (_target, _thisArg, args) => fn(...args),
    }) as unknown as Sql,
    calls,
  };
}

describe("createIssueTriageStateStore", () => {
  it("claims by returning a delivery-bound claim object", async () => {
    const { sql, calls } = createSqlHarness();
    const store = createIssueTriageStateStore(sql);

    const claim = await store.claim({
      repo: "owner/repo",
      issueNumber: 123,
      deliveryId: "delivery-1",
      cooldownMinutes: 30,
    });

    expect(claim?.deliveryId).toBe("delivery-1");
    expect(claim?.recordDuplicateCount).toBeFunction();
    expect(claim?.confirmPublish).toBeFunction();
    expect(claim?.storeCommentId).toBeFunction();
    expect(calls[0]!.strings.join("")).toContain("RETURNING delivery_id");
  });

  it("keeps duplicate count and comment id writes bound to the delivery claim", async () => {
    const { sql, calls } = createSqlHarness();
    const store = createIssueTriageStateStore(sql);
    const claim = await store.claim({
      repo: "owner/repo",
      issueNumber: 123,
      deliveryId: "delivery-1",
      cooldownMinutes: 30,
    });

    await expect(claim!.recordDuplicateCount({
      duplicateCount: 2,
    })).resolves.toBe(true);
    await expect(claim!.storeCommentId({
      commentGithubId: 999,
    })).resolves.toBe(true);

    const recordSql = calls[1]!.strings.join("");
    const storeSql = calls[2]!.strings.join("");
    expect(recordSql).toContain("delivery_id");
    expect(storeSql).toContain("delivery_id");
    expect(calls[1]!.values).toContain("delivery-1");
    expect(calls[2]!.values).toContain("delivery-1");
  });

  it("confirms publish rights only after duplicate detection has completed for the same claim", async () => {
    const { sql, calls } = createSqlHarness({ confirmRows: [] });
    const store = createIssueTriageStateStore(sql);
    const claim = await store.claim({
      repo: "owner/repo",
      issueNumber: 123,
      deliveryId: "delivery-1",
      cooldownMinutes: 30,
    });

    await expect(claim!.confirmPublish()).resolves.toBe(false);

    expect(calls[1]!.strings.join("")).toContain("duplicate_count IS NOT NULL");
    expect(calls[1]!.values).toContain("delivery-1");
  });
});
