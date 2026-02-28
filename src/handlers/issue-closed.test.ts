import { describe, it, expect, beforeEach } from "bun:test";
import { createIssueClosedHandler } from "./issue-closed.ts";
import type { EventRouter, WebhookEvent, EventHandler } from "../webhook/types.ts";
import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";

// -- Test helpers -------------------------------------------------------------

function createMockLogger(): Logger {
  return {
    warn: () => {},
    info: () => {},
    debug: () => {},
    error: () => {},
    child: () => createMockLogger(),
  } as unknown as Logger;
}

type CapturedHandler = { key: string; handler: EventHandler };

function createMockEventRouter(): EventRouter & { captured: CapturedHandler[] } {
  const captured: CapturedHandler[] = [];
  return {
    captured,
    register(eventKey: string, handler: EventHandler) {
      captured.push({ key: eventKey, handler });
    },
    dispatch: async () => {},
  };
}

interface SqlCall {
  strings: string[];
  values: unknown[];
}

function createMockSql(opts?: {
  triageRows?: Array<Record<string, unknown>>;
  insertResult?: Array<Record<string, unknown>>;
}): Sql & { calls: SqlCall[] } {
  const calls: SqlCall[] = [];
  const triageRows = opts?.triageRows ?? [];
  const insertResult = opts?.insertResult ?? [{ id: 1 }];

  // Tagged template literal function that inspects the SQL string
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call: SqlCall = { strings: Array.from(strings), values };
    calls.push(call);

    const joined = strings.join("");
    if (joined.includes("SELECT") && joined.includes("issue_triage_state")) {
      return Promise.resolve(triageRows);
    }
    if (joined.includes("INSERT") && joined.includes("issue_outcome_feedback")) {
      return Promise.resolve(insertResult);
    }
    return Promise.resolve([]);
  };

  const proxy = new Proxy(fn, {
    apply: (_target, _thisArg, args) => fn(args[0], ...args.slice(1)),
    get: (_target, prop) => {
      if (prop === "calls") return calls;
      return undefined;
    },
  }) as unknown as Sql & { calls: SqlCall[] };

  return proxy;
}

function makeEvent(overrides?: Record<string, unknown>): WebhookEvent {
  return {
    id: "delivery-456",
    name: "issues",
    installationId: 1,
    payload: {
      action: "closed",
      issue: {
        number: 42,
        title: "Bug report",
        body: "Something is broken",
        state: "closed",
        state_reason: "completed",
        labels: [],
        user: { login: "testuser" },
        closed_at: "2026-02-28T00:00:00Z",
      },
      repository: {
        full_name: "owner/repo",
        name: "repo",
        owner: { login: "owner" },
      },
      ...overrides,
    },
  };
}

// -- Tests --------------------------------------------------------------------

describe("createIssueClosedHandler", () => {
  let router: ReturnType<typeof createMockEventRouter>;

  beforeEach(() => {
    router = createMockEventRouter();
  });

  it("registers on issues.closed event", () => {
    createIssueClosedHandler({
      eventRouter: router,
      sql: createMockSql(),
      logger: createMockLogger(),
    });

    expect(router.captured).toHaveLength(1);
    expect(router.captured[0].key).toBe("issues.closed");
  });

  it("skips pull request closure events", async () => {
    const mockSql = createMockSql();

    createIssueClosedHandler({
      eventRouter: router,
      sql: mockSql,
      logger: createMockLogger(),
    });

    const event = makeEvent({
      issue: {
        number: 42,
        title: "PR title",
        body: null,
        state: "closed",
        state_reason: "completed",
        labels: [],
        pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/42" },
        user: { login: "testuser" },
        closed_at: "2026-02-28T00:00:00Z",
      },
    });

    await router.captured[0].handler(event);

    // No SQL calls should have been made (PR filtered before any DB queries)
    expect(mockSql.calls).toHaveLength(0);
  });

  it("records completed outcome from state_reason", async () => {
    const mockSql = createMockSql();

    createIssueClosedHandler({
      eventRouter: router,
      sql: mockSql,
      logger: createMockLogger(),
    });

    const event = makeEvent({
      issue: {
        number: 42,
        title: "Bug report",
        body: "Something is broken",
        state: "closed",
        state_reason: "completed",
        labels: [],
        user: { login: "testuser" },
        closed_at: "2026-02-28T00:00:00Z",
      },
    });

    await router.captured[0].handler(event);

    // Should have 2 SQL calls: SELECT triage + INSERT outcome
    expect(mockSql.calls).toHaveLength(2);

    const insertCall = mockSql.calls[1];
    const insertStr = insertCall.strings.join("");
    expect(insertStr).toContain("INSERT");
    expect(insertStr).toContain("issue_outcome_feedback");

    // Values: repo, issueNumber, triageId, outcome, kodiaiPredictedDuplicate, confirmedDuplicate, stateReason, labelNames, deliveryId
    expect(insertCall.values[3]).toBe("completed"); // outcome
    expect(insertCall.values[5]).toBe(false); // confirmed_duplicate
  });

  it("records duplicate outcome from state_reason", async () => {
    const mockSql = createMockSql();

    createIssueClosedHandler({
      eventRouter: router,
      sql: mockSql,
      logger: createMockLogger(),
    });

    const event = makeEvent({
      issue: {
        number: 42,
        title: "Dup issue",
        body: null,
        state: "closed",
        state_reason: "duplicate",
        labels: [],
        user: { login: "testuser" },
        closed_at: "2026-02-28T00:00:00Z",
      },
    });

    await router.captured[0].handler(event);

    const insertCall = mockSql.calls[1];
    expect(insertCall.values[3]).toBe("duplicate"); // outcome
    expect(insertCall.values[5]).toBe(true); // confirmed_duplicate
  });

  it("records duplicate from label fallback when state_reason is null", async () => {
    const mockSql = createMockSql();

    createIssueClosedHandler({
      eventRouter: router,
      sql: mockSql,
      logger: createMockLogger(),
    });

    const event = makeEvent({
      issue: {
        number: 42,
        title: "Dup via label",
        body: null,
        state: "closed",
        state_reason: null,
        labels: [{ name: "duplicate" }],
        user: { login: "testuser" },
        closed_at: "2026-02-28T00:00:00Z",
      },
    });

    await router.captured[0].handler(event);

    const insertCall = mockSql.calls[1];
    expect(insertCall.values[3]).toBe("duplicate"); // outcome
    expect(insertCall.values[5]).toBe(true); // confirmed_duplicate
  });

  it("records unknown outcome when no state_reason and no duplicate label", async () => {
    const mockSql = createMockSql();

    createIssueClosedHandler({
      eventRouter: router,
      sql: mockSql,
      logger: createMockLogger(),
    });

    const event = makeEvent({
      issue: {
        number: 42,
        title: "Closed issue",
        body: null,
        state: "closed",
        state_reason: null,
        labels: [],
        user: { login: "testuser" },
        closed_at: "2026-02-28T00:00:00Z",
      },
    });

    await router.captured[0].handler(event);

    const insertCall = mockSql.calls[1];
    expect(insertCall.values[3]).toBe("unknown"); // outcome
    expect(insertCall.values[5]).toBe(false); // confirmed_duplicate
  });

  it("does not treat possible-duplicate label as confirmed duplicate", async () => {
    const mockSql = createMockSql();

    createIssueClosedHandler({
      eventRouter: router,
      sql: mockSql,
      logger: createMockLogger(),
    });

    const event = makeEvent({
      issue: {
        number: 42,
        title: "Maybe dup",
        body: null,
        state: "closed",
        state_reason: null,
        labels: [{ name: "possible-duplicate" }],
        user: { login: "testuser" },
        closed_at: "2026-02-28T00:00:00Z",
      },
    });

    await router.captured[0].handler(event);

    const insertCall = mockSql.calls[1];
    expect(insertCall.values[3]).toBe("unknown"); // outcome -- NOT "duplicate"
    expect(insertCall.values[5]).toBe(false); // confirmed_duplicate
  });

  it("links to triage record when one exists", async () => {
    const mockSql = createMockSql({
      triageRows: [{ id: 42, duplicate_count: 2 }],
    });

    createIssueClosedHandler({
      eventRouter: router,
      sql: mockSql,
      logger: createMockLogger(),
    });

    await router.captured[0].handler(makeEvent());

    const insertCall = mockSql.calls[1];
    expect(insertCall.values[2]).toBe(42); // triage_id
    expect(insertCall.values[4]).toBe(true); // kodiai_predicted_duplicate (duplicate_count > 0)
  });

  it("sets triage_id null when no triage record", async () => {
    const mockSql = createMockSql({
      triageRows: [],
    });

    createIssueClosedHandler({
      eventRouter: router,
      sql: mockSql,
      logger: createMockLogger(),
    });

    await router.captured[0].handler(makeEvent());

    const insertCall = mockSql.calls[1];
    expect(insertCall.values[2]).toBeNull(); // triage_id
    expect(insertCall.values[4]).toBe(false); // kodiai_predicted_duplicate
  });

  it("skips insert on delivery-ID conflict", async () => {
    const mockSql = createMockSql({
      insertResult: [], // ON CONFLICT DO NOTHING returns empty
    });

    createIssueClosedHandler({
      eventRouter: router,
      sql: mockSql,
      logger: createMockLogger(),
    });

    // Should not throw
    await router.captured[0].handler(makeEvent());

    // Both SQL calls should have been made
    expect(mockSql.calls).toHaveLength(2);
  });

  it("fails open on handler error", async () => {
    // SQL that throws on any query
    const fn = () => {
      throw new Error("Database connection lost");
    };
    const throwingSql = new Proxy(fn, {
      apply: () => { throw new Error("Database connection lost"); },
    }) as unknown as Sql;

    createIssueClosedHandler({
      eventRouter: router,
      sql: throwingSql,
      logger: createMockLogger(),
    });

    // Should not throw -- handler catches and logs
    await router.captured[0].handler(makeEvent());
  });

  it("skips events with missing payload fields", async () => {
    const mockSql = createMockSql();

    createIssueClosedHandler({
      eventRouter: router,
      sql: mockSql,
      logger: createMockLogger(),
    });

    // No issue in payload
    const noIssueEvent = makeEvent({ issue: undefined });
    await router.captured[0].handler(noIssueEvent);
    expect(mockSql.calls).toHaveLength(0);

    // No repository in payload
    const noRepoEvent = makeEvent({ repository: undefined });
    await router.captured[0].handler(noRepoEvent);
    expect(mockSql.calls).toHaveLength(0);
  });
});
