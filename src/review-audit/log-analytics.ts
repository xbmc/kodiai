export type LogAnalyticsRow = Record<string, unknown>;

export type NormalizedLogAnalyticsRow = {
  timeGenerated: string | null;
  rawLog: string | null;
  malformed: boolean;
  deliveryId: string | null;
  reviewOutputKey: string | null;
  message: string | null;
  revisionName: string | null;
  containerAppName: string | null;
  parsedLog: Record<string, unknown> | null;
};

type RunAzJson = (args: string[]) => Promise<unknown>;

function escapeKqlString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function defaultRunAzJson(args: string[]): Promise<unknown> {
  const proc = Bun.spawn(["az", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `az ${args.join(" ")} exited with code ${exitCode}`);
  }

  return JSON.parse(stdout);
}

export function buildReviewAuditLogQuery(params: {
  reviewOutputKey?: string;
  deliveryId?: string;
  limit?: number;
}): string {
  const lines = [
    "ContainerAppConsoleLogs_CL",
  ];

  if (params.reviewOutputKey) {
    lines.push(`| where Log_s has "${escapeKqlString(params.reviewOutputKey)}"`);
  }

  if (params.deliveryId) {
    lines.push(`| where Log_s has "${escapeKqlString(params.deliveryId)}"`);
  }

  lines.push(
    "| project TimeGenerated, Log_s, RevisionName_s, ContainerAppName_s",
    "| order by TimeGenerated asc",
    `| take ${Math.max(1, params.limit ?? 200)}`,
  );

  return lines.join("\n");
}

export async function discoverLogAnalyticsWorkspaceIds(params: {
  resourceGroup: string;
  explicitWorkspaceIds?: string[];
  runAzJson?: RunAzJson;
}): Promise<string[]> {
  if (params.explicitWorkspaceIds && params.explicitWorkspaceIds.length > 0) {
    return [...new Set(params.explicitWorkspaceIds)];
  }

  const rows = await (params.runAzJson ?? defaultRunAzJson)([
    "monitor",
    "log-analytics",
    "workspace",
    "list",
    "-g",
    params.resourceGroup,
    "-o",
    "json",
  ]) as Array<{ customerId?: string | null }>;

  return rows
    .map((row) => row.customerId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function normalizeLogAnalyticsRows(rows: LogAnalyticsRow[]): NormalizedLogAnalyticsRow[] {
  return rows.map((row) => {
    const rawLog = typeof row.Log_s === "string" ? row.Log_s : null;
    let parsedLog: Record<string, unknown> | null = null;
    let malformed = false;

    if (rawLog) {
      try {
        const parsed = JSON.parse(rawLog);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          parsedLog = parsed as Record<string, unknown>;
        } else {
          malformed = true;
        }
      } catch {
        malformed = true;
      }
    }

    return {
      timeGenerated: typeof row.TimeGenerated === "string" ? row.TimeGenerated : null,
      rawLog,
      malformed,
      deliveryId: typeof parsedLog?.deliveryId === "string" ? parsedLog.deliveryId : null,
      reviewOutputKey: typeof parsedLog?.reviewOutputKey === "string" ? parsedLog.reviewOutputKey : null,
      message: typeof parsedLog?.msg === "string" ? parsedLog.msg : rawLog,
      revisionName: typeof row.RevisionName_s === "string" ? row.RevisionName_s : null,
      containerAppName: typeof row.ContainerAppName_s === "string" ? row.ContainerAppName_s : null,
      parsedLog,
    };
  });
}

export async function queryReviewAuditLogs(params: {
  workspaceIds: string[];
  reviewOutputKey?: string;
  deliveryId?: string;
  timespan?: string;
  limit?: number;
  runAzJson?: RunAzJson;
}): Promise<{ query: string; rows: NormalizedLogAnalyticsRow[] }> {
  if (params.workspaceIds.length === 0) {
    return {
      query: buildReviewAuditLogQuery(params),
      rows: [],
    };
  }

  const query = buildReviewAuditLogQuery(params);
  const [primaryWorkspace, ...additionalWorkspaces] = params.workspaceIds;
  const args = [
    "monitor",
    "log-analytics",
    "query",
    "-w",
    primaryWorkspace!,
    "--analytics-query",
    query,
    "-o",
    "json",
  ];

  if (params.timespan) {
    args.push("-t", params.timespan);
  }

  if (additionalWorkspaces.length > 0) {
    args.push("--workspaces", ...additionalWorkspaces);
  }

  const rawRows = await (params.runAzJson ?? defaultRunAzJson)(args) as LogAnalyticsRow[];
  return {
    query,
    rows: normalizeLogAnalyticsRows(rawRows),
  };
}
