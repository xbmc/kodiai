import { mapWithConcurrency } from "../src/lib/concurrency.ts";

export const TRIAGE_REACTION_SYNC_CONCURRENCY = 4;
export const TRIAGE_REACTION_REPO_SYNC_CONCURRENCY = 2;

export async function syncTriageReactionRecords<T>(
  records: readonly T[],
  processRecord: (record: T, index: number) => Promise<void>,
  concurrency = TRIAGE_REACTION_SYNC_CONCURRENCY,
): Promise<void> {
  await mapWithConcurrency(records, concurrency, processRecord);
}

export async function syncTriageReactionRepos<T>(
  repoGroups: readonly T[],
  processRepoGroup: (repoGroup: T, index: number) => Promise<void>,
  concurrency = TRIAGE_REACTION_REPO_SYNC_CONCURRENCY,
): Promise<void> {
  await mapWithConcurrency(repoGroups, concurrency, processRepoGroup);
}
