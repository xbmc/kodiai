import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import {
  buildRereviewTeamCandidates,
  requestRereviewTeamBestEffort,
} from "./rereview-team.ts";

function createNoopLogger(): Logger {
  return {
    fatal: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    silent: () => undefined,
  } as unknown as Logger;
}

describe("rereview-team helpers", () => {
  test("buildRereviewTeamCandidates normalizes owner/team input and adds alias", () => {
    expect(buildRereviewTeamCandidates("xbmc/aireview")).toEqual(["aireview", "ai-review"]);
    expect(buildRereviewTeamCandidates("ai-review")).toEqual(["ai-review", "aireview"]);
  });

  test("requestRereviewTeamBestEffort skips request when team already present", async () => {
    let requestCalls = 0;
    const result = await requestRereviewTeamBestEffort({
      octokit: {
        rest: {
          pulls: {
            listRequestedReviewers: async () => ({
              data: { users: [], teams: [{ slug: "aireview", name: "aireview" }] },
            }),
            requestReviewers: async () => {
              requestCalls += 1;
              return { data: {} };
            },
          },
        },
      },
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 1,
      configuredTeam: "aireview",
      logger: createNoopLogger(),
    });

    expect(result.alreadyRequested).toBe(true);
    expect(result.requestedTeam).toBeUndefined();
    expect(requestCalls).toBe(0);
  });

  test("requestRereviewTeamBestEffort falls back from aireview to ai-review on 422", async () => {
    const attempted: string[] = [];

    const result = await requestRereviewTeamBestEffort({
      octokit: {
        rest: {
          pulls: {
            listRequestedReviewers: async () => ({ data: { users: [], teams: [] } }),
            requestReviewers: async (params: { team_reviewers: string[]; reviewers?: string[] }) => {
              const slug = params.team_reviewers[0] ?? params.reviewers?.[0] ?? "";
              attempted.push(slug);
              if (slug === "aireview") {
                const err = new Error("Validation failed") as Error & { status: number };
                err.status = 422;
                throw err;
              }
              return { data: {} };
            },
          },
        },
      },
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 2,
      configuredTeam: "aireview",
      logger: createNoopLogger(),
    });

    expect(attempted).toEqual(["aireview", "ai-review"]);
    expect(result.requestedTeam).toBe("ai-review");
    expect(result.alreadyRequested).toBe(false);
  });

  test("requestRereviewTeamBestEffort requests fallback reviewer when teams fail", async () => {
    const attemptedTeams: string[] = [];
    let fallbackReviewer: string | undefined;

    await requestRereviewTeamBestEffort({
      octokit: {
        rest: {
          pulls: {
            listRequestedReviewers: async () => ({ data: { users: [], teams: [] } }),
            requestReviewers: async (params: { team_reviewers: string[]; reviewers?: string[] }) => {
              if (params.team_reviewers.length > 0) {
                attemptedTeams.push(params.team_reviewers[0] ?? "");
                const err = new Error("team failed") as Error & { status: number };
                err.status = 422;
                throw err;
              }
              fallbackReviewer = params.reviewers?.[0];
              return { data: {} };
            },
          },
        },
      },
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 3,
      configuredTeam: "aireview",
      fallbackReviewer: "kodiai",
      logger: createNoopLogger(),
    });

    expect(attemptedTeams).toEqual(["aireview", "ai-review"]);
    expect(fallbackReviewer).toBe("kodiai");
  });
});
