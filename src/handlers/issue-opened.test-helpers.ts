import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { Sql } from "../db/client.ts";
import type { RepoConfig } from "../execution/config.ts";
import type { WorkspaceManager } from "../jobs/types.ts";
import type { IssueStore } from "../knowledge/issue-types.ts";
import type { EmbeddingProvider, EmbeddingResult } from "../knowledge/types.ts";
import type {
  IssueTriageClaim,
  IssueTriageStateStore,
} from "../triage/issue-triage-state-store.ts";
import type { EventHandler, EventRouter, WebhookEvent } from "../webhook/types.ts";

export function createMockLogger(): Logger {
  return {
    warn: () => {},
    info: () => {},
    debug: () => {},
    error: () => {},
    child: () => createMockLogger(),
  } as unknown as Logger;
}

type CapturedHandler = { key: string; handler: EventHandler };

export function createMockEventRouter(): EventRouter & { captured: CapturedHandler[] } {
  const captured: CapturedHandler[] = [];
  return {
    captured,
    register(eventKey: string, handler: EventHandler) {
      captured.push({ key: eventKey, handler });
    },
    dispatch: async () => {},
  };
}

function createMockOctokit(opts?: {
  comments?: Array<{ body?: string | null }>;
  addLabelsError?: Error;
}) {
  return {
    rest: {
      issues: {
        listComments: async () => ({
          data: opts?.comments ?? [],
        }),
        createComment: async () => ({ data: { id: 1 } }),
        addLabels: async () => {
          if (opts?.addLabelsError) throw opts.addLabelsError;
          return { data: [] };
        },
      },
    },
  };
}

export function createMockGithubApp(octokitOpts?: Parameters<typeof createMockOctokit>[0]): GitHubApp {
  return {
    getInstallationOctokit: async () => createMockOctokit(octokitOpts) as any,
    getAppSlug: () => "kodiai",
    initialize: async () => {},
    checkConnectivity: async () => true,
  } as unknown as GitHubApp;
}

export function createMockIssueStore(results: any[] = []): IssueStore {
  return {
    searchByEmbedding: async () => results,
  } as unknown as IssueStore;
}

export function createMockEmbeddingProvider(
  result: EmbeddingResult = {
    embedding: new Float32Array([0.1, 0.2, 0.3]),
    model: "voyage-code-3",
    dimensions: 3,
  },
): EmbeddingProvider {
  return {
    generate: async () => result,
    model: "voyage-code-3",
    dimensions: 3,
  };
}

export type IssueTriageStateStoreCall =
  | { kind: "claim"; input: Parameters<IssueTriageStateStore["claim"]>[0] }
  | {
    kind: "recordDuplicateCount";
    deliveryId: string;
    input: Parameters<IssueTriageClaim["recordDuplicateCount"]>[0];
  }
  | { kind: "confirmPublish"; deliveryId: string }
  | {
    kind: "storeCommentId";
    deliveryId: string;
    input: Parameters<IssueTriageClaim["storeCommentId"]>[0];
  };

export type IssueTriageStateStoreHarness = IssueTriageStateStore & {
  calls: IssueTriageStateStoreCall[];
  callsByKind: <K extends IssueTriageStateStoreCall["kind"]>(
    kind: K,
  ) => Array<Extract<IssueTriageStateStoreCall, { kind: K }>>;
};

export function createIssueTriageStateStoreHarness(opts?: {
  claimDeliveryId?: string | null;
  recordDuplicateCountResult?: "success" | "stale" | "error";
  confirmPublishResult?: boolean;
  failCommentIdStore?: boolean;
  onCall?: (call: IssueTriageStateStoreCall) => void;
}): IssueTriageStateStoreHarness {
  const calls: IssueTriageStateStoreCall[] = [];
  const claimDeliveryId =
    Object.hasOwn(opts ?? {}, "claimDeliveryId") ? opts?.claimDeliveryId : "delivery-1";
  const recordDuplicateCountResult = opts?.recordDuplicateCountResult ?? "success";
  const confirmPublishResult = opts?.confirmPublishResult ?? true;

  const store: IssueTriageStateStoreHarness = {
    calls,
    callsByKind: (kind) =>
      calls.filter((call): call is Extract<IssueTriageStateStoreCall, { kind: typeof kind }> => call.kind === kind),
    async claim(input) {
      const call = { kind: "claim" as const, input };
      calls.push(call);
      opts?.onCall?.(call);
      if (claimDeliveryId == null) {
        return null;
      }

      return {
        deliveryId: claimDeliveryId,
        async recordDuplicateCount(input) {
          const call = {
            kind: "recordDuplicateCount" as const,
            deliveryId: claimDeliveryId,
            input,
          };
          calls.push(call);
          opts?.onCall?.(call);
          if (recordDuplicateCountResult === "error") {
            throw new Error("duplicate count write failed");
          }
          return recordDuplicateCountResult === "success";
        },
        async confirmPublish() {
          const call = { kind: "confirmPublish" as const, deliveryId: claimDeliveryId };
          calls.push(call);
          opts?.onCall?.(call);
          return confirmPublishResult;
        },
        async storeCommentId(input) {
          const call = {
            kind: "storeCommentId" as const,
            deliveryId: claimDeliveryId,
            input,
          };
          calls.push(call);
          opts?.onCall?.(call);
          if (opts?.failCommentIdStore) {
            throw new Error("DB connection lost");
          }
          return true;
        },
      };
    },
  };
  return store;
}

export function createMockSql(opts?: { thresholdRows?: unknown[] }): Sql {
  const fn = async (...args: any[]) => {
    if (Array.isArray(args[0])) {
      const joined = Array.from(args[0]).join("");
      if (joined.includes("SELECT") && joined.includes("triage_threshold_state")) {
        return opts?.thresholdRows ?? [];
      }
    }
    return [];
  };
  return new Proxy(fn, {
    apply: (_target, _thisArg, args) => fn(...args),
  }) as unknown as Sql;
}

export function createMockWorkspaceManager(config?: Partial<RepoConfig>): WorkspaceManager {
  return {
    create: async () => {
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const path = await import("node:path");
      const dir = await mkdtemp(path.join(tmpdir(), "issue-opened-test-"));

      const yaml = await import("js-yaml");
      const configObj = {
        triage: {
          enabled: config?.triage?.enabled ?? false,
          autoTriageOnOpen: config?.triage?.autoTriageOnOpen ?? false,
          duplicateThreshold: config?.triage?.duplicateThreshold ?? 75,
          maxDuplicateCandidates: config?.triage?.maxDuplicateCandidates ?? 3,
          duplicateLabel: config?.triage?.duplicateLabel ?? "possible-duplicate",
          cooldownMinutes: 30,
        },
      };
      await writeFile(
        path.join(dir, ".kodiai.yml"),
        yaml.dump(configObj),
        "utf-8",
      );

      return {
        dir,
        cleanup: async () => {
          const { rm } = await import("node:fs/promises");
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        },
      };
    },
    cleanupStale: async () => 0,
  };
}

export function makeEvent(overrides?: Partial<WebhookEvent["payload"]>): WebhookEvent {
  return {
    id: "delivery-123",
    name: "issues",
    installationId: 1,
    payload: {
      action: "opened",
      issue: {
        number: 100,
        title: "App crashes on login",
        body: "When I try to login, the app crashes.",
        user: { login: "testuser" },
      },
      repository: {
        full_name: "owner/repo",
        name: "repo",
        owner: { login: "owner" },
        default_branch: "main",
      },
      ...overrides,
    },
  };
}

export function makeSearchResult(
  issueNumber: number,
  title: string,
  state: string,
  distance: number,
) {
  return {
    record: {
      id: issueNumber,
      createdAt: "2026-01-01",
      repo: "owner/repo",
      owner: "owner",
      issueNumber,
      title,
      body: null,
      state,
      authorLogin: "user",
      authorAssociation: null,
      labelNames: [],
      templateSlug: null,
      commentCount: 0,
      assignees: [],
      milestone: null,
      reactionCount: 0,
      isPullRequest: false,
      locked: false,
      embedding: null,
      embeddingModel: null,
      githubCreatedAt: "2026-01-01",
      githubUpdatedAt: null,
      closedAt: null,
    },
    distance,
  };
}
