import type { Sql } from "../db/client.ts";

/**
 * Bulk-insert check run results into ci_check_history.
 *
 * Uses a single INSERT with multiple value rows for efficiency.
 */
export async function recordCheckRuns(
  sql: Sql,
  params: {
    repo: string;
    headSha: string;
    prNumber?: number;
    checkSuiteId?: number;
    runs: Array<{ name: string; conclusion: string }>;
  },
): Promise<void> {
  if (params.runs.length === 0) return;

  const values = params.runs.map((run) => ({
    repo: params.repo,
    check_name: run.name,
    head_sha: params.headSha,
    conclusion: run.conclusion,
    check_suite_id: params.checkSuiteId ?? null,
    pr_number: params.prNumber ?? null,
  }));

  await sql`
    INSERT INTO ci_check_history ${sql(values, "repo", "check_name", "head_sha", "conclusion", "check_suite_id", "pr_number")}
  `;
}

/**
 * For each check name, query the last 20 rows (by created_at DESC) and count
 * failures. Returns a Map keyed by check_name with {failures, total}.
 *
 * If a check has no history, it is absent from the Map.
 */
export async function getFlakiness(
  sql: Sql,
  params: { repo: string; checkNames: string[] },
): Promise<Map<string, { failures: number; total: number }>> {
  const result = new Map<string, { failures: number; total: number }>();
  if (params.checkNames.length === 0) return result;

  const rows = await sql`
    SELECT check_name, conclusion
    FROM (
      SELECT
        check_name,
        conclusion,
        ROW_NUMBER() OVER (PARTITION BY check_name ORDER BY created_at DESC) AS rn
      FROM ci_check_history
      WHERE repo = ${params.repo}
        AND check_name = ANY(${params.checkNames})
    ) sub
    WHERE rn <= 20
  `;

  // Aggregate per check_name
  const stats = new Map<string, { failures: number; total: number }>();
  for (const row of rows) {
    const name = row.check_name as string;
    const conclusion = row.conclusion as string;
    if (!stats.has(name)) {
      stats.set(name, { failures: 0, total: 0 });
    }
    const stat = stats.get(name)!;
    stat.total += 1;
    if (conclusion === "failure") {
      stat.failures += 1;
    }
  }

  for (const [name, stat] of stats) {
    result.set(name, stat);
  }

  return result;
}
