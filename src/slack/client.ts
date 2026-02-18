interface CreateSlackClientInput {
  botToken: string;
  fetchImpl?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

interface SlackApiResponse {
  ok?: boolean;
  error?: string;
}

export interface SlackThreadPublishInput {
  channel: string;
  threadTs: string;
  text: string;
}

export interface SlackClient {
  postThreadMessage(input: SlackThreadPublishInput): Promise<void>;
}

export function createSlackClient(input: CreateSlackClientInput): SlackClient {
  const fetchImpl = input.fetchImpl ?? fetch;

  return {
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
        throw new Error(`Slack API request failed: ${response.status}`);
      }

      const payload = (await response.json()) as SlackApiResponse;
      if (!payload.ok) {
        throw new Error(`Slack API chat.postMessage failed: ${payload.error ?? "unknown_error"}`);
      }
    },
  };
}
