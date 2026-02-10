import type { Logger } from "pino";
import type { BotFilter, EventHandler, EventRouter, WebhookEvent } from "./types.ts";

/**
 * Creates an event router that dispatches webhook events to registered handlers.
 *
 * Features:
 * - Map-based handler registry keyed by "event.action" or "event" format
 * - Bot filtering applied before handler dispatch
 * - Handler errors isolated via Promise.allSettled (one failure does not block others)
 * - Unhandled event types silently dropped with debug-level logging
 */
export function createEventRouter(
  botFilter: BotFilter,
  logger: Logger,
): EventRouter {
  const handlers = new Map<string, EventHandler[]>();

  return {
    register(eventKey: string, handler: EventHandler): void {
      const existing = handlers.get(eventKey);
      if (existing) {
        existing.push(handler);
      } else {
        handlers.set(eventKey, [handler]);
      }
      logger.debug({ eventKey }, "Handler registered");
    },

    async dispatch(event: WebhookEvent): Promise<void> {
      // Extract sender from payload (some events like "installation" may not have sender)
      const sender = event.payload.sender as
        | { type: string; login: string }
        | undefined;

      // Apply bot filter if sender is present
      if (sender) {
        if (!botFilter.shouldProcess(sender)) {
          logger.info(
            {
              deliveryId: event.id,
              event: event.name,
              action: event.payload.action,
              sender: sender.login,
              filtered: true,
              filterReason: "bot-filter",
            },
            "Event filtered before dispatch",
          );
          return;
        }
      }

      // Build lookup keys
      const action = event.payload.action as string | undefined;
      const specificKey = action ? `${event.name}.${action}` : undefined;
      const generalKey = event.name;

      // Collect handlers from both specific and general keys
      const collected: EventHandler[] = [];
      if (specificKey && handlers.has(specificKey)) {
        collected.push(...(handlers.get(specificKey) ?? []));
      }
      if (handlers.has(generalKey)) {
        collected.push(...(handlers.get(generalKey) ?? []));
      }

      logger.info(
        {
          deliveryId: event.id,
          event: event.name,
          action,
          specificKey,
          generalKey,
          specificHandlerCount: specificKey ? (handlers.get(specificKey)?.length ?? 0) : 0,
          generalHandlerCount: handlers.get(generalKey)?.length ?? 0,
          matchedHandlerCount: collected.length,
        },
        "Router evaluated dispatch keys",
      );

      if (collected.length === 0) {
        logger.info(
          {
            deliveryId: event.id,
            event: event.name,
            action,
            specificKey,
            generalKey,
            matchedHandlerCount: 0,
            filtered: false,
          },
          "Event skipped because no handlers matched",
        );
        return;
      }

      // Run all handlers with isolated errors
      const results = await Promise.allSettled(
        collected.map((handler) => handler(event)),
      );

      let succeeded = 0;
      let failed = 0;

      for (const result of results) {
        if (result.status === "fulfilled") {
          succeeded++;
        } else {
          failed++;
          logger.error(
            {
              deliveryId: event.id,
              event: event.name,
              action,
              reason: result.reason,
            },
            "Handler failed during dispatch",
          );
        }
      }

      logger.info(
        {
          deliveryId: event.id,
          event: event.name,
          action,
          specificKey,
          generalKey,
          matchedHandlerCount: collected.length,
          succeeded,
          failed,
        },
        `Dispatched to ${collected.length} handler(s)`,
      );
    },
  };
}
