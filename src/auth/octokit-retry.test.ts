import { describe, expect, test } from "bun:test";
import { Octokit } from "@octokit/rest";
import { installOctokitRetry } from "./octokit-retry.ts";

function createNoopLogger() {
  const noop = () => undefined;
  return { info: noop, warn: noop, error: noop, debug: noop, child: () => createNoopLogger() } as never;
}

function httpError(status: number, message = "boom", headers?: Record<string, string>) {
  return Object.assign(new Error(message), {
    status,
    ...(headers ? { response: { status, headers } } : {}),
  });
}

/**
 * Drive the hook through Octokit's real hook pipeline with a stubbed fetch
 * so the retry policy is exercised exactly as production requests are.
 */
function createClient(responder: (attempt: number) => Response | Error) {
  let attempts = 0;
  const octokit = new Octokit({
    request: {
      fetch: async () => {
        attempts++;
        const result = responder(attempts);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  });
  installOctokitRetry(octokit, createNoopLogger());
  // Zero out retry sleep by intercepting timers is overkill here: delays come
  // from retryGitHubTransient defaults (250ms initial), acceptable in tests.
  return { octokit, getAttempts: () => attempts };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("installOctokitRetry", () => {
  test("retries GET on 500 and succeeds", async () => {
    const { octokit, getAttempts } = createClient((attempt) =>
      attempt === 1 ? jsonResponse(500, { message: "server error" }) : jsonResponse(200, { id: 1 }),
    );

    const result = await octokit.request("GET /repos/{owner}/{repo}", { owner: "x", repo: "y" });
    expect(result.status).toBe(200);
    expect(getAttempts()).toBe(2);
  });

  test("does NOT retry POST on 500 (could double-apply the mutation)", async () => {
    const { octokit, getAttempts } = createClient(() => jsonResponse(500, { message: "server error" }));

    await expect(
      octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
        owner: "x",
        repo: "y",
        issue_number: 1,
        body: "hi",
      }),
    ).rejects.toMatchObject({ status: 500 });
    expect(getAttempts()).toBe(1);
  });

  test("retries POST on 429 rate-limit rejection", async () => {
    const { octokit, getAttempts } = createClient((attempt) =>
      attempt === 1
        ? jsonResponse(429, { message: "rate limited" }, { "retry-after": "0" })
        : jsonResponse(201, { id: 2 }),
    );

    const result = await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      owner: "x",
      repo: "y",
      issue_number: 1,
      body: "hi",
    });
    expect(result.status).toBe(201);
    expect(getAttempts()).toBe(2);
  });

  test("retries POST on 403 secondary rate limit", async () => {
    const { octokit, getAttempts } = createClient((attempt) =>
      attempt === 1
        ? jsonResponse(403, { message: "You have exceeded a secondary rate limit" }, { "retry-after": "0" })
        : jsonResponse(201, { id: 3 }),
    );

    const result = await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      owner: "x",
      repo: "y",
      issue_number: 1,
      body: "hi",
    });
    expect(result.status).toBe(201);
    expect(getAttempts()).toBe(2);
  });

  test("does not retry GET on 404", async () => {
    const { octokit, getAttempts } = createClient(() => jsonResponse(404, { message: "not found" }));

    await expect(
      octokit.request("GET /repos/{owner}/{repo}", { owner: "x", repo: "y" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(getAttempts()).toBe(1);
  });
});

// keep helper referenced for future direct-policy tests
void httpError;
