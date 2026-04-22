import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import { createEventRouter } from "./router.ts";
import type { BotFilter, EventHandler, WebhookEvent } from "./types.ts";

function createCaptureLogger() {
  const entries: Array<{ level: string; data?: Record<string, unknown>; message: string }> = [];

  const capture = (level: string) => (data: unknown, message?: string) => {
    if (typeof data === "string") {
      entries.push({ level, message: data });
      return;
    }

    entries.push({
      level,
      data: (data ?? {}) as Record<string, unknown>,
      message: message ?? "",
    });
  };

  const logger = {
    debug: capture("debug"),
    info: capture("info"),
    warn: capture("warn"),
    error: capture("error"),
    trace: capture("trace"),
    fatal: capture("fatal"),
    child: () => logger,
  } as unknown as Logger;

  return { logger, entries };
}

function createEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: "delivery-123",
    name: "pull_request",
    installationId: 42,
    payload: {
      action: "opened",
      sender: { type: "User", login: "alice" },
    },
    ...overrides,
  };
}

describe("createEventRouter", () => {
  test("dispatches both specific and general handlers for the same matching delivery", async () => {
    const { logger, entries } = createCaptureLogger();
    const shouldProcess = mock(() => true);
    const router = createEventRouter({ shouldProcess } satisfies BotFilter, logger);
    const calls: string[] = [];

    const specificHandler: EventHandler = mock(async (event) => {
      calls.push(`specific:${event.id}`);
    });
    const generalHandler: EventHandler = mock(async (event) => {
      calls.push(`general:${event.id}`);
    });

    router.register("pull_request.opened", specificHandler);
    router.register("pull_request", generalHandler);

    const event = createEvent();
    await router.dispatch(event);

    expect(shouldProcess).toHaveBeenCalledWith({ type: "User", login: "alice" });
    expect(specificHandler).toHaveBeenCalledTimes(1);
    expect(generalHandler).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["specific:delivery-123", "general:delivery-123"]);

    const evaluationLog = entries.find(
      (entry) => entry.message === "Router evaluated dispatch keys",
    );
    expect(evaluationLog?.data?.specificKey).toBe("pull_request.opened");
    expect(evaluationLog?.data?.generalKey).toBe("pull_request");
    expect(evaluationLog?.data?.specificHandlerCount).toBe(1);
    expect(evaluationLog?.data?.generalHandlerCount).toBe(1);
    expect(evaluationLog?.data?.matchedHandlerCount).toBe(2);

    const completionLog = entries.find(
      (entry) => entry.message === "Dispatched to 2 handler(s)",
    );
    expect(completionLog?.data?.succeeded).toBe(2);
    expect(completionLog?.data?.failed).toBe(0);
  });

  test("resolves unmatched events without throwing or invoking handlers when no keys match", async () => {
    const { logger, entries } = createCaptureLogger();
    const shouldProcess = mock(() => true);
    const router = createEventRouter({ shouldProcess } satisfies BotFilter, logger);
    const unrelatedHandler: EventHandler = mock(async () => undefined);

    router.register("issue_comment.created", unrelatedHandler);

    await expect(
      router.dispatch(
        createEvent({
          name: "pull_request",
          payload: {
            sender: { type: "User", login: "alice" },
          },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(shouldProcess).toHaveBeenCalledWith({ type: "User", login: "alice" });
    expect(unrelatedHandler).not.toHaveBeenCalled();

    const evaluationLog = entries.find(
      (entry) => entry.message === "Router evaluated dispatch keys",
    );
    expect(evaluationLog?.data?.specificKey).toBeUndefined();
    expect(evaluationLog?.data?.generalKey).toBe("pull_request");
    expect(evaluationLog?.data?.matchedHandlerCount).toBe(0);

    expect(entries).toContainEqual({
      level: "info",
      data: {
        deliveryId: "delivery-123",
        event: "pull_request",
        action: undefined,
        specificKey: undefined,
        generalKey: "pull_request",
        matchedHandlerCount: 0,
        filtered: false,
      },
      message: "Event skipped because no handlers matched",
    });
  });

  test("short-circuits handler execution when the bot filter rejects the sender", async () => {
    const { logger, entries } = createCaptureLogger();
    const shouldProcess = mock(() => false);
    const router = createEventRouter({ shouldProcess } satisfies BotFilter, logger);
    const specificHandler: EventHandler = mock(async () => undefined);
    const generalHandler: EventHandler = mock(async () => undefined);

    router.register("pull_request.opened", specificHandler);
    router.register("pull_request", generalHandler);

    await expect(
      router.dispatch(
        createEvent({
          payload: {
            action: "opened",
            sender: { type: "Bot", login: "dependabot[bot]" },
          },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(shouldProcess).toHaveBeenCalledWith({
      type: "Bot",
      login: "dependabot[bot]",
    });
    expect(specificHandler).not.toHaveBeenCalled();
    expect(generalHandler).not.toHaveBeenCalled();

    expect(entries).toContainEqual({
      level: "info",
      data: {
        deliveryId: "delivery-123",
        event: "pull_request",
        action: "opened",
        sender: "dependabot[bot]",
        filtered: true,
        filterReason: "bot-filter",
      },
      message: "Event filtered before dispatch",
    });
    expect(entries.some((entry) => entry.message === "Router evaluated dispatch keys")).toBe(false);
  });

  test("isolates one rejected handler so a sibling matched handler still runs and dispatch resolves", async () => {
    const { logger, entries } = createCaptureLogger();
    const shouldProcess = mock(() => true);
    const router = createEventRouter({ shouldProcess } satisfies BotFilter, logger);
    const calls: string[] = [];

    const rejectingHandler: EventHandler = mock(async (event) => {
      calls.push(`specific:${event.id}`);
      throw new Error("specific handler exploded");
    });
    const fulfillingHandler: EventHandler = mock(async (event) => {
      calls.push(`general:${event.id}`);
    });

    router.register("pull_request.opened", rejectingHandler);
    router.register("pull_request", fulfillingHandler);

    await expect(router.dispatch(createEvent())).resolves.toBeUndefined();

    expect(rejectingHandler).toHaveBeenCalledTimes(1);
    expect(fulfillingHandler).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["specific:delivery-123", "general:delivery-123"]);

    const failureLog = entries.find(
      (entry) => entry.message === "Handler failed during dispatch",
    );
    expect(failureLog?.data?.deliveryId).toBe("delivery-123");
    expect(failureLog?.data?.event).toBe("pull_request");
    expect(failureLog?.data?.action).toBe("opened");
    expect(failureLog?.data?.reason).toBeInstanceOf(Error);
    expect((failureLog?.data?.reason as Error | undefined)?.message).toBe(
      "specific handler exploded",
    );

    const completionLog = entries.find(
      (entry) => entry.message === "Dispatched to 2 handler(s)",
    );
    expect(completionLog?.data?.matchedHandlerCount).toBe(2);
    expect(completionLog?.data?.succeeded).toBe(1);
    expect(completionLog?.data?.failed).toBe(1);
  });
});
