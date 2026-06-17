import { randomUUID } from "node:crypto";
import { parseRetryAfterDelayMs } from "../lib/retry-after.ts";
import { retryTransient } from "../lib/transient-retry.ts";

interface CreateSlackClientInput {
  botToken: string;
  fetchImpl?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

interface SlackApiResponse {
  ok?: boolean;
  error?: string;
}

class SlackApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly headers: Headers,
    readonly slackError?: string,
  ) {
    super(message);
    this.name = "SlackApiRequestError";
  }
}

function isRetryableSlackWriteError(error: unknown): boolean {
  if (error instanceof SlackApiRequestError) {
    return error.status === 429 || error.status >= 500 || error.slackError === "ratelimited";
  }
  return error instanceof TypeError || error instanceof DOMException;
}

function slackRetryAfterDelayMs(error: unknown): number | null {
  if (!(error instanceof SlackApiRequestError)) return null;
  return parseRetryAfterDelayMs(error.headers.get("retry-after"));
}

async function parseSlackPayload(response: Response, method: string): Promise<SlackApiResponse> {
  const raw = await response.text();

  if (!raw.trim()) {
    throw new Error(`Slack API ${method} returned empty response body`);
  }

  try {
    return JSON.parse(raw) as SlackApiResponse;
  } catch {
    throw new Error(`Slack API ${method} returned non-JSON response: ${raw.slice(0, 200)}`);
  }
}

async function postSlackJsonWithRetry<T extends SlackApiResponse>(params: {
  fetchImpl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
  botToken: string;
  timeoutMs: number;
  method: string;
  body: Record<string, unknown>;
}): Promise<T> {
  return await retryTransient(
    async () => {
      const response = await params.fetchImpl(`https://slack.com/api/${params.method}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${params.botToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(params.body),
        signal: AbortSignal.timeout(params.timeoutMs),
      });

      const payload = await parseSlackPayload(response, params.method) as T;
      if (!response.ok) {
        throw new SlackApiRequestError(
          `Slack API ${params.method} request failed: ${response.status}`,
          response.status,
          response.headers,
          payload.error,
        );
      }
      if (!payload.ok && payload.error === "ratelimited") {
        throw new SlackApiRequestError(`Slack API ${params.method} failed: ratelimited`, 429, response.headers, payload.error);
      }
      return payload;
    },
    {
      maxAttempts: 3,
      shouldRetry: isRetryableSlackWriteError,
      retryDelayMs: slackRetryAfterDelayMs,
    },
  );
}

export interface SlackThreadPublishInput {
  channel: string;
  threadTs: string;
  text: string;
}

export interface SlackStandaloneMessageInput {
  channel: string;
  text: string;
}

export interface SlackClient {
  postThreadMessage(input: SlackThreadPublishInput): Promise<void>;
  postStandaloneMessage(input: SlackStandaloneMessageInput): Promise<{ ts: string }>;
  addReaction(input: { channel: string; timestamp: string; name: string }): Promise<void>;
  removeReaction(input: { channel: string; timestamp: string; name: string }): Promise<void>;
  getTokenScopes(): Promise<string[]>;
}

export function createSlackClient(input: CreateSlackClientInput): SlackClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 10_000;

  return {
    async getTokenScopes(): Promise<string[]> {
      const response = await fetchImpl("https://slack.com/api/auth.test", {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.botToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`Slack API auth.test request failed: ${response.status}`);
      }

      const payload = await parseSlackPayload(response, "auth.test");
      if (!payload.ok) {
        throw new Error(`Slack API auth.test failed: ${payload.error ?? "unknown_error"}`);
      }

      const scopesHeader = response.headers.get("x-oauth-scopes") ?? "";
      return scopesHeader
        .split(",")
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0);
    },

    async addReaction(inputData: { channel: string; timestamp: string; name: string }): Promise<void> {
      const payload = await postSlackJsonWithRetry({
        fetchImpl,
        botToken: input.botToken,
        timeoutMs,
        method: "reactions.add",
        body: {
          channel: inputData.channel,
          timestamp: inputData.timestamp,
          name: inputData.name,
        },
      });
      if (!payload.ok && payload.error !== "already_reacted") {
        throw new Error(`Slack API reactions.add failed: ${payload.error ?? "unknown_error"}`);
      }
    },

    async removeReaction(inputData: { channel: string; timestamp: string; name: string }): Promise<void> {
      const payload = await postSlackJsonWithRetry({
        fetchImpl,
        botToken: input.botToken,
        timeoutMs,
        method: "reactions.remove",
        body: {
          channel: inputData.channel,
          timestamp: inputData.timestamp,
          name: inputData.name,
        },
      });
      if (!payload.ok && payload.error !== "no_reaction") {
        throw new Error(`Slack API reactions.remove failed: ${payload.error ?? "unknown_error"}`);
      }
    },

    async postThreadMessage(message: SlackThreadPublishInput): Promise<void> {
      const threadTs = message.threadTs.trim();
      if (!threadTs) {
        throw new Error("Slack thread_ts is required for thread-only replies");
      }

      const payload = await postSlackJsonWithRetry({
        fetchImpl,
        botToken: input.botToken,
        timeoutMs,
        method: "chat.postMessage",
        body: {
          channel: message.channel,
          thread_ts: threadTs,
          text: message.text,
          client_msg_id: randomUUID(),
        },
      });
      if (!payload.ok) {
        throw new Error(`Slack API chat.postMessage failed: ${payload.error ?? "unknown_error"}`);
      }
    },

    async postStandaloneMessage(messageInput: SlackStandaloneMessageInput): Promise<{ ts: string }> {
      const parsed = await postSlackJsonWithRetry<SlackApiResponse & { ts?: string }>({
        fetchImpl,
        botToken: input.botToken,
        timeoutMs,
        method: "chat.postMessage",
        body: {
          channel: messageInput.channel,
          text: messageInput.text,
          client_msg_id: randomUUID(),
        },
      });

      if (!parsed.ok) {
        throw new Error(`Slack API chat.postMessage failed: ${parsed.error ?? "unknown_error"}`);
      }

      if (!parsed.ts) {
        throw new Error("Slack API chat.postMessage response missing ts field");
      }

      return { ts: parsed.ts };
    },
  };
}
