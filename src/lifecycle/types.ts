/**
 * Lifecycle types for graceful shutdown, request tracking, and webhook queuing.
 */

/** Tracks in-flight HTTP requests and background jobs for graceful drain. */
export interface RequestTracker {
  /** Increment active HTTP request count. Returns an untrack function. */
  trackRequest(): () => void;
  /** Increment active background job count. Returns an untrack function. */
  trackJob(): () => void;
  /** Current counts of in-flight work. */
  activeCount(): { requests: number; jobs: number; total: number };
  /**
   * Returns a Promise that resolves when all in-flight work completes,
   * or rejects after timeoutMs if work remains.
   */
  waitForDrain(timeoutMs: number): Promise<void>;
}

/** Manages SIGTERM/SIGINT handling with drain logic and grace window. */
export interface ShutdownManager {
  /** Register signal handlers. Call once at startup. */
  start(): void;
  /** Whether a shutdown signal has been received. */
  isShuttingDown(): boolean;
}

/** Shape of a queued webhook row in the webhook_queue table. */
export interface WebhookQueueEntry {
  id?: number;
  source: string;
  deliveryId?: string;
  eventName?: string;
  headers: Record<string, string>;
  body: string;
  queuedAt?: Date;
  processedAt?: Date;
  status?: string;
}

/** Durable PostgreSQL-backed webhook queue for drain-time queuing. */
export interface WebhookQueueStore {
  /** Queue a webhook for later replay. */
  enqueue(entry: Omit<WebhookQueueEntry, "id" | "queuedAt" | "processedAt" | "status">): Promise<void>;
  /** Dequeue all pending entries, marking them as 'processing'. Returns the entries. */
  dequeuePending(): Promise<WebhookQueueEntry[]>;
  /** Mark a queued entry as completed. */
  markCompleted(id: number): Promise<void>;
  /** Mark a queued entry as failed. */
  markFailed(id: number, error?: string): Promise<void>;
}
