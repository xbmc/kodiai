type RepairCandidateRow = {
  id: number;
  page_id: number;
  page_title: string;
  chunk_index: number;
  token_count: number;
  chunk_text: string;
  embedding_model: string | null;
  embedding: unknown;
  stale: boolean;
  deleted: boolean;
};

type RawRepairCandidateRow = RepairCandidateRow & {
  pageId?: number;
  pageTitle?: string;
  chunkIndex?: number;
  tokenCount?: number;
  chunkText?: string;
  embeddingModel?: string | null;
};

export type RepairWindow = {
  page_id: number;
  page_title: string;
  window_index: number;
  windows_total: number;
  chunk_ids: number[];
  chunk_indexes: number[];
  approx_tokens: number;
};

type RepairPlanPage = {
  page_id: number;
  page_title: string;
  chunk_ids: number[];
  windows: RepairWindow[];
};

export const TARGET_WIKI_EMBEDDING_MODEL = "voyage-context-3";

export const DEFAULT_REPAIR_LIMITS = {
  maxChunksPerWindow: 8,
  maxApproxTokensPerWindow: 3200,
  minChunksPerWindow: 1,
  maxTransientRetries: 2,
};

type LoggerLike = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
};

type RepairFailure = {
  status: "failed";
  failure_class: string;
  message: string;
  retryable: boolean;
  should_split: boolean;
};

type RepairSuccess = {
  status: "ok";
  embeddings: Array<{ chunk_id: number; embedding: Float32Array }>;
  retry_count?: number;
};

type RepairStore = {
  listRepairCandidates: (params?: { pageTitle?: string }) => Promise<RawRepairCandidateRow[]>;
  getRepairCheckpoint: () => Promise<{
    page_id: number | null;
    page_title: string | null;
    window_index: number | null;
    repaired: number;
    skipped: number;
    failed: number;
    last_failure_class: string | null;
  } | null>;
  saveRepairCheckpoint: (state: {
    page_id: number | null;
    page_title: string | null;
    window_index: number | null;
    windows_total: number | null;
    repaired: number;
    skipped: number;
    failed: number;
    last_failure_class: string | null;
    last_failure_message: string | null;
    retry_count?: number;
    used_split_fallback?: boolean;
    updated_at?: string;
    pageId?: number | null;
    pageTitle?: string | null;
    windowIndex?: number | null;
    windowsTotal?: number | null;
    lastFailureClass?: string | null;
    lastFailureMessage?: string | null;
    retryCount?: number;
    usedSplitFallback?: boolean;
  }) => Promise<void>;
  writeRepairEmbeddingsBatch: (payload: {
    page_id: number;
    page_title: string;
    chunk_ids: number[];
    target_model: string;
    embeddings: Array<{ chunk_id: number; embedding: Float32Array }>;
    pageId?: number;
    pageTitle?: string;
    chunkIds?: number[];
    targetModel?: string;
  }) => Promise<void>;
};

function normalizeCandidateRow(row: RawRepairCandidateRow): RepairCandidateRow {
  return {
    id: row.id,
    page_id: row.page_id ?? row.pageId ?? 0,
    page_title: row.page_title ?? row.pageTitle ?? "",
    chunk_index: row.chunk_index ?? row.chunkIndex ?? 0,
    token_count: row.token_count ?? row.tokenCount ?? 0,
    chunk_text: row.chunk_text ?? row.chunkText ?? "",
    embedding_model: row.embedding_model ?? row.embeddingModel ?? null,
    embedding: row.embedding,
    stale: row.stale,
    deleted: row.deleted,
  };
}

function isRepairCandidate(row: RepairCandidateRow, targetModel: string): boolean {
  if (row.deleted) return false;
  if (row.embedding == null) return true;
  if (row.stale) return true;
  return row.embedding_model !== targetModel;
}

function sortRows(rows: RepairCandidateRow[]): RepairCandidateRow[] {
  return [...rows].sort((a, b) => a.chunk_index - b.chunk_index || a.id - b.id);
}

function groupRowsByPage(rows: RepairCandidateRow[]): Map<number, RepairCandidateRow[]> {
  const grouped = new Map<number, RepairCandidateRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.page_id) ?? [];
    group.push(row);
    grouped.set(row.page_id, group);
  }
  for (const [pageId, pageRows] of grouped) {
    grouped.set(pageId, sortRows(pageRows));
  }
  return grouped;
}

function makeWindow(pageRows: RepairCandidateRow[], page_id: number, page_title: string, window_index: number, windows_total: number): RepairWindow {
  return {
    page_id,
    page_title,
    window_index,
    windows_total,
    chunk_ids: pageRows.map((row) => row.id),
    chunk_indexes: pageRows.map((row) => row.chunk_index),
    approx_tokens: pageRows.reduce((sum, row) => sum + row.token_count, 0),
  };
}

function buildWindowsFromGroups(pageRows: RepairCandidateRow[][], page_id: number, page_title: string): RepairWindow[] {
  return pageRows.map((group, index) => makeWindow(group, page_id, page_title, index, pageRows.length));
}

export function splitWikiRepairWindows(
  rows: RepairCandidateRow[],
  limits?: {
    maxChunksPerWindow?: number;
    maxApproxTokensPerWindow?: number;
  },
): RepairWindow[] {
  if (rows.length === 0) return [];

  const sorted = sortRows(rows);
  const page_id = sorted[0]!.page_id;
  const page_title = sorted[0]!.page_title;
  const maxChunksPerWindow = Math.max(1, limits?.maxChunksPerWindow ?? DEFAULT_REPAIR_LIMITS.maxChunksPerWindow);
  const maxApproxTokensPerWindow = Math.max(1, limits?.maxApproxTokensPerWindow ?? DEFAULT_REPAIR_LIMITS.maxApproxTokensPerWindow);

  const groups: RepairCandidateRow[][] = [];
  let current: RepairCandidateRow[] = [];
  let currentTokens = 0;

  for (const row of sorted) {
    const rowTokens = Math.max(0, row.token_count);
    const wouldExceedChunkLimit = current.length >= maxChunksPerWindow;
    const wouldExceedTokenLimit = current.length > 0 && currentTokens + rowTokens > maxApproxTokensPerWindow;

    if (wouldExceedChunkLimit || wouldExceedTokenLimit) {
      groups.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(row);
    currentTokens += rowTokens;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return buildWindowsFromGroups(groups, page_id, page_title);
}

export function buildWikiRepairPlan(input: {
  rows: RepairCandidateRow[];
  targetModel?: string;
  checkpoint?: {
    page_id: number | null;
    window_index: number | null;
  } | null;
  limits?: {
    maxChunksPerWindow?: number;
    maxApproxTokensPerWindow?: number;
  };
}): {
  target_model: string;
  total_pages: number;
  total_chunks: number;
  resume_from: {
    page_id: number | null;
    window_index: number | null;
  } | null;
  pages: RepairPlanPage[];
} {
  const targetModel = input.targetModel ?? TARGET_WIKI_EMBEDDING_MODEL;
  const candidateRows = input.rows.filter((row) => isRepairCandidate(row, targetModel));
  const pages = [...groupRowsByPage(candidateRows).values()].map((pageRows) => {
    const first = pageRows[0]!;
    return {
      page_id: first.page_id,
      page_title: first.page_title,
      chunk_ids: pageRows.map((row) => row.id),
      windows: splitWikiRepairWindows(pageRows, input.limits),
    };
  });

  return {
    target_model: targetModel,
    total_pages: pages.length,
    total_chunks: candidateRows.length,
    resume_from: input.checkpoint ?? null,
    pages,
  };
}

function splitWindowRows(rows: RepairCandidateRow[], minChunksPerWindow: number): RepairCandidateRow[][] {
  if (rows.length <= minChunksPerWindow) {
    return [rows];
  }

  const midpoint = Math.ceil(rows.length / 2);
  const left = rows.slice(0, midpoint);
  const right = rows.slice(midpoint);
  return [left, right].filter((group) => group.length > 0);
}

function buildCheckpointState(params: {
  page_id: number | null;
  page_title: string | null;
  window_index: number | null;
  windows_total: number | null;
  repaired: number;
  skipped: number;
  failed: number;
  last_failure_class: string | null;
  last_failure_message: string | null;
  retry_count: number;
  used_split_fallback: boolean;
}): Awaited<Parameters<RepairStore["saveRepairCheckpoint"]>[0]> {
  return {
    ...params,
    updated_at: new Date().toISOString(),
    pageId: params.page_id,
    pageTitle: params.page_title,
    windowIndex: params.window_index,
    windowsTotal: params.windows_total,
    lastFailureClass: params.last_failure_class,
    lastFailureMessage: params.last_failure_message,
    retryCount: params.retry_count,
    usedSplitFallback: params.used_split_fallback,
  };
}

function buildWriteBatch(params: {
  page_id: number;
  page_title: string;
  chunk_ids: number[];
  target_model: string;
  embeddings: Array<{ chunk_id: number; embedding: Float32Array }>;
}): Awaited<Parameters<RepairStore["writeRepairEmbeddingsBatch"]>[0]> {
  return {
    ...params,
    embeddings: params.embeddings.map((item) => ({
      ...item,
      chunkId: item.chunk_id,
    })),
    pageId: params.page_id,
    pageTitle: params.page_title,
    chunkIds: params.chunk_ids,
    targetModel: params.target_model,
  };
}

function normalizeCheckpoint(checkpoint: Awaited<ReturnType<RepairStore["getRepairCheckpoint"]>> & {
  pageId?: number | null;
  pageTitle?: string | null;
  windowIndex?: number | null;
  repaired?: number;
  skipped?: number;
  failed?: number;
  lastFailureClass?: string | null;
}): {
  page_id: number | null;
  page_title: string | null;
  window_index: number | null;
  repaired: number;
  skipped: number;
  failed: number;
  last_failure_class: string | null;
} | null {
  if (!checkpoint) return null;
  return {
    page_id: checkpoint.page_id ?? checkpoint.pageId ?? null,
    page_title: checkpoint.page_title ?? checkpoint.pageTitle ?? null,
    window_index: checkpoint.window_index ?? checkpoint.windowIndex ?? null,
    repaired: checkpoint.repaired ?? 0,
    skipped: checkpoint.skipped ?? 0,
    failed: checkpoint.failed ?? 0,
    last_failure_class: checkpoint.last_failure_class ?? checkpoint.lastFailureClass ?? null,
  };
}

export async function runWikiEmbeddingRepair(input: {
  pageTitle?: string;
  resume?: boolean;
  limits?: {
    maxChunksPerWindow?: number;
    maxApproxTokensPerWindow?: number;
    minChunksPerWindow?: number;
    maxTransientRetries?: number;
  };
  logger?: LoggerLike;
  store: RepairStore;
  embedWindow: (window: RepairWindow, attempt: number) => Promise<RepairSuccess | RepairFailure>;
}): Promise<{
  success: boolean;
  status_code: string;
  target_model: string;
  resumed: boolean;
  repaired: number;
  skipped: number;
  failed: number;
  used_split_fallback: boolean;
  progress: Array<{
    page_id: number;
    page_title: string;
    window_index: number;
    windows_total: number;
    repaired: number;
    skipped: number;
    failed: number;
    failure_class: string | null;
    retry_count: number;
    target_model: string;
  }>;
  cursor: {
    page_id: number | null;
    page_title: string | null;
    window_index: number | null;
    windows_total: number | null;
  };
}> {
  const logger = input.logger ?? {};
  const limits = {
    ...DEFAULT_REPAIR_LIMITS,
    ...input.limits,
  };
  const checkpoint = input.resume ? normalizeCheckpoint(await input.store.getRepairCheckpoint()) : null;
  const rows = (await input.store.listRepairCandidates(input.pageTitle ? { pageTitle: input.pageTitle } : undefined))
    .map((row) => normalizeCandidateRow(row));
  const plan = buildWikiRepairPlan({
    rows,
    targetModel: TARGET_WIKI_EMBEDDING_MODEL,
    checkpoint: checkpoint ? { page_id: checkpoint.page_id, window_index: checkpoint.window_index } : null,
    limits,
  });

  let repaired = checkpoint?.repaired ?? 0;
  let skipped = checkpoint?.skipped ?? 0;
  let failed = checkpoint?.failed ?? 0;
  let usedSplitFallback = false;
  const progress: Array<{
    page_id: number;
    page_title: string;
    window_index: number;
    windows_total: number;
    repaired: number;
    skipped: number;
    failed: number;
    failure_class: string | null;
    retry_count: number;
    target_model: string;
  }> = [];
  let cursor = {
    page_id: checkpoint?.page_id ?? null,
    page_title: checkpoint?.page_title ?? null,
    window_index: checkpoint?.window_index ?? null,
    windows_total: null as number | null,
  };

  for (const page of plan.pages) {
    const pageRows = sortRows(rows.filter((row) => row.page_id === page.page_id && isRepairCandidate(row, TARGET_WIKI_EMBEDDING_MODEL)));
    let groups = splitWikiRepairWindows(pageRows, limits).map((window, index) => ({ window, rows: groupsRowsFromWindow(pageRows, window, index) }));

    let currentIndex = 0;
    if (checkpoint && checkpoint.page_id === page.page_id && checkpoint.window_index !== null) {
      currentIndex = checkpoint.window_index;
      if (currentIndex >= groups.length) {
        continue;
      }
    } else if (checkpoint && checkpoint.page_id !== null && page.page_id < checkpoint.page_id) {
      continue;
    }

    while (currentIndex < groups.length) {
      const item = groups[currentIndex]!;
      const window = {
        ...item.window,
        window_index: currentIndex,
        windows_total: groups.length,
      };
      cursor = {
        page_id: page.page_id,
        page_title: page.page_title,
        window_index: currentIndex,
        windows_total: groups.length,
      };

      let attempt = 0;
      let resolved = false;
      while (attempt <= limits.maxTransientRetries && !resolved) {
        const outcome = await input.embedWindow(window, attempt);
        if (outcome.status === "ok") {
          await input.store.writeRepairEmbeddingsBatch(buildWriteBatch({
            page_id: page.page_id,
            page_title: page.page_title,
            chunk_ids: window.chunk_ids,
            target_model: TARGET_WIKI_EMBEDDING_MODEL,
            embeddings: outcome.embeddings,
          }));

          repaired += outcome.embeddings.length;
          progress.push({
            page_id: page.page_id,
            page_title: page.page_title,
            window_index: currentIndex,
            windows_total: groups.length,
            repaired,
            skipped,
            failed,
            failure_class: null,
            retry_count: outcome.retry_count ?? attempt,
            target_model: TARGET_WIKI_EMBEDDING_MODEL,
          });
          await input.store.saveRepairCheckpoint(buildCheckpointState({
            page_id: page.page_id,
            page_title: page.page_title,
            window_index: currentIndex,
            windows_total: groups.length,
            repaired,
            skipped,
            failed,
            last_failure_class: null,
            last_failure_message: null,
            retry_count: outcome.retry_count ?? attempt,
            used_split_fallback: usedSplitFallback,
          }));
          resolved = true;
          currentIndex += 1;
          break;
        }

        if (outcome.retryable && attempt < limits.maxTransientRetries) {
          attempt += 1;
          logger.warn?.({
            page_id: page.page_id,
            page_title: page.page_title,
            window_index: currentIndex,
            failure_class: outcome.failure_class,
            retry_count: attempt,
          }, "Retrying wiki repair window after transient failure");
          continue;
        }

        const canSplit = outcome.should_split && item.rows.length > limits.minChunksPerWindow;
        if (canSplit) {
          usedSplitFallback = true;
          const splitGroups = splitWindowRows(item.rows, limits.minChunksPerWindow);
          if (splitGroups.length > 1) {
            const replacementWindows = buildWindowsFromGroups(splitGroups, page.page_id, page.page_title).map((nextWindow, index) => ({
              window: nextWindow,
              rows: splitGroups[index]!,
            }));
            groups.splice(currentIndex, 1, ...replacementWindows);
            logger.info?.({
              page_id: page.page_id,
              page_title: page.page_title,
              previous_window_index: currentIndex,
              new_windows_total: groups.length,
              failure_class: outcome.failure_class,
            }, "Split wiki repair window after size-related failure");
            resolved = true;
            break;
          }
        }

        failed += item.rows.length;
        progress.push({
          page_id: page.page_id,
          page_title: page.page_title,
          window_index: currentIndex,
          windows_total: groups.length,
          repaired,
          skipped,
          failed,
          failure_class: outcome.failure_class,
          retry_count: attempt,
          target_model: TARGET_WIKI_EMBEDDING_MODEL,
        });
        await input.store.saveRepairCheckpoint(buildCheckpointState({
          page_id: page.page_id,
          page_title: page.page_title,
          window_index: currentIndex,
          windows_total: groups.length,
          repaired,
          skipped,
          failed,
          last_failure_class: outcome.failure_class,
          last_failure_message: outcome.message,
          retry_count: attempt,
          used_split_fallback: usedSplitFallback,
        }));
        return {
          success: false,
          status_code: "repair_failed",
          target_model: TARGET_WIKI_EMBEDDING_MODEL,
          resumed: Boolean(checkpoint),
          repaired,
          skipped,
          failed,
          used_split_fallback: usedSplitFallback,
          progress,
          cursor,
        };
      }
    }
  }

  return {
    success: true,
    status_code: "repair_completed",
    target_model: TARGET_WIKI_EMBEDDING_MODEL,
    resumed: Boolean(checkpoint),
    repaired,
    skipped,
    failed,
    used_split_fallback: usedSplitFallback,
    progress,
    cursor,
  };
}

function groupsRowsFromWindow(pageRows: RepairCandidateRow[], window: RepairWindow, windowIndex: number): RepairCandidateRow[] {
  const rowsById = new Map(pageRows.map((row) => [row.id, row]));
  return window.chunk_ids.map((chunkId) => rowsById.get(chunkId)).filter((row): row is RepairCandidateRow => Boolean(row));
}
