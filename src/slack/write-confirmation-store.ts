import { createInMemoryCache } from "../lib/in-memory-cache.ts";

export interface SlackWritePendingConfirmation {
  pending: true;
  channel: string;
  threadTs: string;
  owner: string;
  repo: string;
  keyword: "apply" | "change" | "plan";
  request: string;
  prompt: string;
  command: string;
  createdAt: number;
  expiresAt: number;
}

export interface SlackWriteConfirmationStore {
  openPending(input: {
    channel: string;
    threadTs: string;
    owner: string;
    repo: string;
    keyword: "apply" | "change" | "plan";
    request: string;
    prompt: string;
    timeoutMs: number;
  }): SlackWritePendingConfirmation;
  getPending(channel: string, threadTs: string): SlackWritePendingConfirmation | undefined;
  confirm(channel: string, threadTs: string, command: string):
    | { outcome: "confirmed"; pending: SlackWritePendingConfirmation }
    | { outcome: "not_found" }
    | { outcome: "mismatch"; pending: SlackWritePendingConfirmation };
}

function buildStoreKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`;
}

function buildCommand(keyword: "apply" | "change" | "plan", request: string): string {
  return `${keyword}: ${request.length > 0 ? request : "<same request>"}`;
}

export function createInMemoryWriteConfirmationStore(
  now: () => number = Date.now,
  options?: { maxSize?: number; ttlMs?: number },
): SlackWriteConfirmationStore {
  const cache = createInMemoryCache<string, SlackWritePendingConfirmation>({
    maxSize: options?.maxSize ?? 1_000,
    ttlMs: options?.ttlMs ?? 15 * 60 * 1000,
    now,
  });

  return {
    openPending(input) {
      const createdAt = now();
      const pending: SlackWritePendingConfirmation = {
        pending: true,
        channel: input.channel,
        threadTs: input.threadTs,
        owner: input.owner,
        repo: input.repo,
        keyword: input.keyword,
        request: input.request,
        prompt: input.prompt,
        command: buildCommand(input.keyword, input.request),
        createdAt,
        expiresAt: createdAt + input.timeoutMs,
      };

      cache.set(buildStoreKey(input.channel, input.threadTs), pending);
      return pending;
    },

    getPending(channel, threadTs) {
      return cache.get(buildStoreKey(channel, threadTs));
    },

    confirm(channel, threadTs, command) {
      const key = buildStoreKey(channel, threadTs);
      const pending = cache.get(key);

      if (!pending) {
        return { outcome: "not_found" };
      }

      if (command !== pending.command) {
        return { outcome: "mismatch", pending };
      }

      cache.delete(key);
      return { outcome: "confirmed", pending };
    },
  };
}
