interface CreateSlackClientInput {
  botToken: string;
  fetchImpl?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

interface SlackApiResponse {
  ok?: boolean;
  error?: string;
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

export interface SlackThreadPublishInput {
  channel: string;
  threadTs: string;
  text: string;
}

export interface SlackClient {
  postThreadMessage(input: SlackThreadPublishInput): Promise<void>;
  addReaction(input: { channel: string; timestamp: string; name: string }): Promise<void>;
  removeReaction(input: { channel: string; timestamp: string; name: string }): Promise<void>;
  getTokenScopes(): Promise<string[]>;
}

export function createSlackClient(input: CreateSlackClientInput): SlackClient {
  const fetchImpl = input.fetchImpl ?? fetch;

  return {
    async getTokenScopes(): Promise<string[]> {
      const response = await fetchImpl("https://slack.com/api/auth.test", {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.botToken}`,
          "content-type": "application/json; charset=utf-8",
        },
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
      const response = await fetchImpl("https://slack.com/api/reactions.add", {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.botToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          channel: inputData.channel,
          timestamp: inputData.timestamp,
          name: inputData.name,
        }),
      });

      if (!response.ok) {
        throw new Error(`Slack API reactions.add request failed: ${response.status}`);
      }

      const payload = await parseSlackPayload(response, "reactions.add");
      if (!payload.ok) {
        throw new Error(`Slack API reactions.add failed: ${payload.error ?? "unknown_error"}`);
      }
    },

    async removeReaction(inputData: { channel: string; timestamp: string; name: string }): Promise<void> {
      const response = await fetchImpl("https://slack.com/api/reactions.remove", {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.botToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          channel: inputData.channel,
          timestamp: inputData.timestamp,
          name: inputData.name,
        }),
      });

      if (!response.ok) {
        throw new Error(`Slack API reactions.remove request failed: ${response.status}`);
      }

      const payload = await parseSlackPayload(response, "reactions.remove");
      if (!payload.ok) {
        throw new Error(`Slack API reactions.remove failed: ${payload.error ?? "unknown_error"}`);
      }
    },

    async postThreadMessage(message: SlackThreadPublishInput): Promise<void> {
      const threadTs = message.threadTs.trim();
      if (!threadTs) {
        throw new Error("Slack thread_ts is required for thread-only replies");
      }

      const response = await fetchImpl("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.botToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          channel: message.channel,
          thread_ts: threadTs,
          text: message.text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Slack API chat.postMessage request failed: ${response.status}`);
      }

      const payload = await parseSlackPayload(response, "chat.postMessage");
      if (!payload.ok) {
        throw new Error(`Slack API chat.postMessage failed: ${payload.error ?? "unknown_error"}`);
      }
    },
  };
}
