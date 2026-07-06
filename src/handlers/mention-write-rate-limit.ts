import type { WriteRateLimitStore } from "../lib/mention-state-stores.ts";
import { recordMentionWriteRateLimitSuccess } from "./mention-publication-state.ts";

export type MentionWriteRateLimitCheck =
  | { allowed: true }
  | { allowed: false; retryInSeconds: number };

export type MentionWriteRateLimitRuntime = {
  check(owner: string, repo: string): MentionWriteRateLimitCheck;
  recordSuccess(owner: string, repo: string): void;
};

export function createMentionWriteRateLimitRuntime(params: {
  store: WriteRateLimitStore;
  installationId: number;
  minIntervalSeconds: number;
  now?: () => number;
}): MentionWriteRateLimitRuntime {
  const now = params.now ?? Date.now;
  const enabled = params.minIntervalSeconds > 0;
  const minIntervalMs = Math.max(0, params.minIntervalSeconds) * 1000;
  const keyFor = (owner: string, repo: string): string => `${params.installationId}:${owner}/${repo}`;

  return {
    check(owner, repo) {
      if (!enabled) return { allowed: true };

      const last = params.store.getLastWriteAt(keyFor(owner, repo));
      const elapsedMs = last === undefined ? minIntervalMs : now() - last;
      if (last === undefined || elapsedMs >= minIntervalMs) {
        return { allowed: true };
      }

      return {
        allowed: false,
        retryInSeconds: Math.ceil((minIntervalMs - elapsedMs) / 1000),
      };
    },
    recordSuccess(owner, repo) {
      if (!enabled) return;
      recordMentionWriteRateLimitSuccess({
        store: params.store,
        installationId: params.installationId,
        owner,
        repo,
      });
    },
  };
}
