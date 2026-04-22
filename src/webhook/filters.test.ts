import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import { createBotFilter } from "./filters.ts";

function createCaptureLogger() {
  const debug = mock(() => undefined);
  const logger = {
    debug,
    info: mock(() => undefined),
    warn: mock(() => undefined),
    error: mock(() => undefined),
    trace: mock(() => undefined),
    fatal: mock(() => undefined),
    child: () => logger,
  } as unknown as Logger;

  return { logger, debug };
}

describe("createBotFilter", () => {
  test("rejects self-events even when the app slug is allow-listed and sender casing varies", () => {
    const { logger, debug } = createCaptureLogger();
    const filter = createBotFilter("kodiai", ["kodiai"], logger);

    expect(filter.shouldProcess({ type: "Bot", login: "KoDiAi[BoT]" })).toBe(false);
    expect(debug).toHaveBeenCalledWith(
      { sender: "KoDiAi[BoT]" },
      "Filtered: event from app itself",
    );
  });

  test("passes human senders through without consulting the allow-list", () => {
    const { logger, debug } = createCaptureLogger();
    const filter = createBotFilter("kodiai", ["dependabot"], logger);

    expect(filter.shouldProcess({ type: "User", login: "Alice" })).toBe(true);
    expect(debug).not.toHaveBeenCalled();
  });

  test("allows allow-listed bots after normalizing [bot] suffix and login casing", () => {
    const { logger, debug } = createCaptureLogger();
    const filter = createBotFilter("kodiai", ["dependabot"], logger);

    expect(filter.shouldProcess({ type: "Bot", login: "Dependabot[BoT]" })).toBe(true);
    expect(debug).toHaveBeenCalledWith(
      { sender: "Dependabot[BoT]" },
      "Bot on allow-list, passing through",
    );
  });

  test("rejects bot senders that are not on the allow-list", () => {
    const { logger, debug } = createCaptureLogger();
    const filter = createBotFilter("kodiai", ["renovate"], logger);

    expect(filter.shouldProcess({ type: "Bot", login: "Dependabot" })).toBe(false);
    expect(debug).toHaveBeenCalledWith(
      { sender: "Dependabot", type: "Bot" },
      "Filtered: bot account not on allow-list",
    );
  });
});
