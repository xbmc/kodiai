import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { WebhookQueueStore } from "./types.ts";

const DEFAULT_DEQUEUE_BATCH_SIZE = 100;

/**
 * Create a PostgreSQL-backed webhook queue store for durable queuing during shutdown drain.
 *
 * Webhooks arriving after SIGTERM are inserted into the webhook_queue table and
 * replayed after the next startup. Enqueue and dequeue operations also record
 * telemetry events per locked decision (fire-and-forget, never blocking the caller).
 */
export function createWebhookQueueStore(opts: {
  sql: Sql;
  logger: Logger;
  telemetryStore: TelemetryStore;
}): WebhookQueueStore {
  const { sql, logger, telemetryStore } = opts;

  return {
    async enqueue(entry) {
      const [row] = await sql`
        INSERT INTO webhook_queue (source, delivery_id, event_name, headers, body)
        VALUES (
          ${entry.source},
          ${entry.deliveryId ?? null},
          ${entry.eventName ?? null},
          ${JSON.stringify(entry.headers)}::jsonb,
          ${entry.body}
        )
        RETURNING id
      `;

      logger.info(
        {
          id: row?.id,
          source: entry.source,
          deliveryId: entry.deliveryId,
          eventName: entry.eventName,
        },
        "Webhook queued to PostgreSQL for drain-time replay",
      );

      // Telemetry: fire-and-forget (do not await -- enqueue must not block on telemetry)
      telemetryStore.record({
        repo: entry.source,
        eventType: "webhook_queued",
        model: "none",
        conclusion: "queued",
        deliveryId: entry.deliveryId ?? undefined,
        sessionId: row?.id?.toString(),
      }).catch((err) => {
        logger.warn({ err }, "Telemetry record failed for webhook_queued (non-fatal)");
      });
    },

    async dequeuePending(batchSize = DEFAULT_DEQUEUE_BATCH_SIZE) {
      const limit = Number.isFinite(batchSize)
        ? Math.max(1, Math.floor(batchSize))
        : DEFAULT_DEQUEUE_BATCH_SIZE;
      const entries = await sql.begin(async (tx) => {
        // Recover rows orphaned in 'processing' by a crash mid-replay: nothing
        // else ever resets that status, so without this they are lost forever.
        // The age guard keeps a concurrently starting replica from stealing a
        // row another instance claimed moments ago.
        const recovered = await (tx as unknown as Sql)`
          UPDATE webhook_queue
          SET status = 'pending'
          WHERE status = 'processing'
            AND queued_at < NOW() - INTERVAL '60 seconds'
          RETURNING id
        `;
        if (recovered.length > 0) {
          logger.warn(
            { count: recovered.length, ids: recovered.map((r: Record<string, unknown>) => r.id) },
            "Recovered webhook_queue rows stuck in 'processing' from a prior crash",
          );
        }

        const rows = await (tx as unknown as Sql)`
          SELECT id, source, delivery_id, event_name, headers, body, queued_at, processed_at, status
          FROM webhook_queue
          WHERE status = 'pending'
          ORDER BY queued_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        `;

        if (rows.length === 0) {
          return [];
        }

        const ids = rows.map((r: Record<string, unknown>) => r.id as number);
        await (tx as unknown as Sql)`
          UPDATE webhook_queue
          SET status = 'processing'
          WHERE id = ANY(${ids})
        `;

        return rows.map((r: Record<string, unknown>) => ({
          id: r.id as number,
          source: r.source as string,
          deliveryId: (r.delivery_id as string) ?? undefined,
          eventName: (r.event_name as string) ?? undefined,
          headers: r.headers as Record<string, string>,
          body: r.body as string,
          queuedAt: r.queued_at as Date,
          processedAt: (r.processed_at as Date) ?? undefined,
          status: r.status as string,
        }));
      });

      if (entries.length > 0) {
        logger.info({ count: entries.length }, "Dequeued pending webhooks for replay");

        // Telemetry: fire-and-forget per dequeued row
        for (const entry of entries) {
          telemetryStore.record({
            repo: entry.source,
            eventType: "webhook_replayed",
            model: "none",
            conclusion: "replayed",
            deliveryId: entry.deliveryId ?? undefined,
            sessionId: entry.id?.toString(),
          }).catch((err) => {
            logger.warn({ err, id: entry.id }, "Telemetry record failed for webhook_replayed (non-fatal)");
          });
        }
      }

      return entries;
    },

    async markCompleted(id) {
      await sql`
        UPDATE webhook_queue
        SET status = 'completed', processed_at = NOW()
        WHERE id = ${id}
      `;
    },

    async markFailed(id, error) {
      await sql`
        UPDATE webhook_queue
        SET status = 'failed', error_message = ${error?.slice(0, 2_000) ?? null}
        WHERE id = ${id}
      `;
    },
  };
}
