import { describe, expect, test } from "bun:test";
import {
  syncTriageReactionRecords,
  syncTriageReactionRepos,
  TRIAGE_REACTION_REPO_SYNC_CONCURRENCY,
  TRIAGE_REACTION_SYNC_CONCURRENCY,
} from "./triage-reaction-sync.ts";

describe("syncTriageReactionRecords", () => {
  test("processes reaction comments with bounded concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const release: Array<() => void> = [];
    const started: number[] = [];

    const run = syncTriageReactionRecords(
      [1, 2, 3],
      async (record) => {
        started.push(record);
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => release.push(resolve));
        active--;
      },
      2,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([1, 2]);
    release.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([1, 2, 3]);
    release.splice(0).forEach((resolve) => resolve());
    await run;

    expect(maxActive).toBe(2);
    expect(TRIAGE_REACTION_SYNC_CONCURRENCY).toBe(4);
  });

  test("processes repo groups with bounded concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const release: Array<() => void> = [];
    const started: string[] = [];

    const run = syncTriageReactionRepos(
      ["a/repo", "b/repo", "c/repo"],
      async (repo) => {
        started.push(repo);
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => release.push(resolve));
        active--;
      },
      2,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["a/repo", "b/repo"]);
    release.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["a/repo", "b/repo", "c/repo"]);
    release.splice(0).forEach((resolve) => resolve());
    await run;

    expect(maxActive).toBe(2);
    expect(TRIAGE_REACTION_REPO_SYNC_CONCURRENCY).toBe(2);
  });
});
