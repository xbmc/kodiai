import { describe, expect, test } from "bun:test";
import { createSlackClient } from "./client.ts";

describe("createSlackClient", () => {
  test("reads token scopes from auth.test response header", async () => {
    const client = createSlackClient({
      botToken: "xoxb-test-token",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-oauth-scopes": "chat:write, reactions:write, app_mentions:read",
          },
        }),
    });

    const scopes = await client.getTokenScopes();

    expect(scopes).toEqual(["chat:write", "reactions:write", "app_mentions:read"]);
  });

  test("adds working reaction payload via Slack reactions.add", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];

    const client = createSlackClient({
      botToken: "xoxb-test-token",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await client.addReaction({
      channel: "C123KODIAI",
      timestamp: "1700000000.000777",
      name: "hourglass_flowing_sand",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://slack.com/api/reactions.add");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(requests[0]?.init?.headers).toEqual({
      authorization: "Bearer xoxb-test-token",
      "content-type": "application/json; charset=utf-8",
    });
    expect(requests[0]?.init?.body).toBe(
      JSON.stringify({
        channel: "C123KODIAI",
        timestamp: "1700000000.000777",
        name: "hourglass_flowing_sand",
      }),
    );
  });

  test("removes working reaction payload via Slack reactions.remove", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];

    const client = createSlackClient({
      botToken: "xoxb-test-token",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await client.removeReaction({
      channel: "C123KODIAI",
      timestamp: "1700000000.000777",
      name: "hourglass_flowing_sand",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://slack.com/api/reactions.remove");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(requests[0]?.init?.headers).toEqual({
      authorization: "Bearer xoxb-test-token",
      "content-type": "application/json; charset=utf-8",
    });
    expect(requests[0]?.init?.body).toBe(
      JSON.stringify({
        channel: "C123KODIAI",
        timestamp: "1700000000.000777",
        name: "hourglass_flowing_sand",
      }),
    );
  });

  test("posts thread-targeted message payload to Slack chat.postMessage", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];

    const client = createSlackClient({
      botToken: "xoxb-test-token",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await client.postThreadMessage({
      channel: "C123KODIAI",
      threadTs: "1700000000.000777",
      text: "Here is your answer.",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://slack.com/api/chat.postMessage");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(requests[0]?.init?.headers).toEqual({
      authorization: "Bearer xoxb-test-token",
      "content-type": "application/json; charset=utf-8",
    });
    expect(requests[0]?.init?.body).toBe(
      JSON.stringify({
        channel: "C123KODIAI",
        thread_ts: "1700000000.000777",
        text: "Here is your answer.",
      }),
    );
  });

  test("rejects missing thread target and does not call Slack API", async () => {
    let called = false;

    const client = createSlackClient({
      botToken: "xoxb-test-token",
      fetchImpl: async () => {
        called = true;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await expect(
      client.postThreadMessage({
        channel: "C123KODIAI",
        threadTs: "   ",
        text: "This should fail.",
      }),
    ).rejects.toThrow("Slack thread_ts is required for thread-only replies");

    expect(called).toBeFalse();
  });
});
