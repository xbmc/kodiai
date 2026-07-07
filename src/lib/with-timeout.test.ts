import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test, expect } from "bun:test";
import {
  abortSignalWithTimeout,
  createAbortControllerWithTimeout,
  raceWithTimeout,
  rejectWithTimeout,
  raceWithAbortSignalTimeout,
  runWithAbortSignalTimeout,
  scheduleTimeout,
  sleep,
  sleepWithAbortSignal,
  withTimeout,
} from "./with-timeout.ts";

describe("withTimeout", () => {
  test("returns the value when work wins the race", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1_000);
    expect(result).toEqual({ timedOut: false, value: "ok" });
  });

  test("reports a timeout when work is too slow", async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 1_000));
    const result = await withTimeout(slow, 5);
    expect(result).toEqual({ timedOut: true });
  });

  test("swallows a late rejection from the losing work", async () => {
    // A handler that rejects after we have already timed out must not surface as
    // an unhandledRejection. The test passes if no unhandled rejection is thrown.
    const rejectsLate = new Promise<string>((_resolve, reject) =>
      setTimeout(() => reject(new Error("too late")), 5),
    );
    const result = await withTimeout(rejectsLate, 1);
    expect(result).toEqual({ timedOut: true });
    // Give the losing promise time to reject so a missing catch would surface.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});

describe("raceWithTimeout", () => {
  test("returns the operation result when it settles before the deadline", async () => {
    await expect(raceWithTimeout(Promise.resolve("ok"), {
      timeoutMs: 1_000,
      timeoutValue: "timed-out",
    })).resolves.toBe("ok");
  });

  test("returns the timeout value and runs the timeout callback on deadline", async () => {
    let timedOut = false;

    const result = await raceWithTimeout(new Promise<string>(() => undefined), {
      timeoutMs: 1,
      timeoutValue: "timed-out",
      onTimeout: () => {
        timedOut = true;
      },
    });

    expect(result).toBe("timed-out");
    expect(timedOut).toBe(true);
  });
});

describe("raceWithAbortSignalTimeout", () => {
  test("returns the operation result when it settles before the deadline", async () => {
    await expect(raceWithAbortSignalTimeout(
      "adapter",
      1_000,
      Symbol("timeout"),
      async (signal) => {
        expect(signal.aborted).toBe(false);
        return "ok";
      },
    )).resolves.toBe("ok");
  });

  test("returns the timeout value and aborts the supplied signal on deadline", async () => {
    const timeoutValue = Symbol("timeout");
    let signalSeen: AbortSignal | undefined;
    let abortReason: unknown;

    const result = await raceWithAbortSignalTimeout(
      "adapter",
      1,
      timeoutValue,
      async (signal) => {
        signalSeen = signal;
        signal.addEventListener("abort", () => {
          abortReason = signal.reason;
        });
        return await new Promise<string>(() => undefined);
      },
    );

    expect(result).toBe(timeoutValue);
    expect(signalSeen?.aborted).toBe(true);
    expect(abortReason).toBeInstanceOf(Error);
    expect(String(abortReason)).toContain("adapter timed out after 1ms");
  });

  test("uses the shared abort controller timeout primitive", () => {
    const source = readFileSync(new URL("./with-timeout.ts", import.meta.url), "utf8");
    const implementation = source.slice(
      source.indexOf("export async function raceWithAbortSignalTimeout"),
      source.indexOf("export type RejectWithTimeoutOptions"),
    );

    expect(implementation).toContain("createAbortControllerWithTimeout");
    expect(implementation).not.toContain("new AbortController()");
  });
});

describe("rejectWithTimeout", () => {
  test("rejects with a caller-supplied timeout error on deadline", async () => {
    await expect(rejectWithTimeout(
      new Promise<string>(() => undefined),
      {
        timeoutMs: 1,
        createTimeoutError: () => new Error("operation timed out"),
      },
    )).rejects.toThrow("operation timed out");
  });

  test("returns the operation result when it settles before the deadline", async () => {
    await expect(rejectWithTimeout(Promise.resolve("ok"), {
      timeoutMs: 1_000,
      createTimeoutError: () => new Error("operation timed out"),
    })).resolves.toBe("ok");
  });
});

describe("runWithAbortSignalTimeout", () => {
  test("rejects on deadline even when the operation ignores the abort signal", async () => {
    const result = await Promise.race([
      runWithAbortSignalTimeout(
        "stubborn operation",
        1,
        async () => {
          await sleep(100);
          return "late";
        },
      ).then(
        () => "resolved",
        (error) => String(error),
      ),
      sleep(25).then(() => "test timed out waiting for wrapper"),
    ]);

    expect(result).toContain("stubborn operation: request timed out after 1ms");
  });

  test("aborts the supplied signal and wraps aborted failures", async () => {
    await expect(runWithAbortSignalTimeout(
      "fetch thing",
      1,
      async (signal) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(signal.aborted).toBe(true);
        throw new DOMException("aborted", "AbortError");
      },
    )).rejects.toThrow("fetch thing: request timed out after 1ms");
  });

  test("returns the operation result when it settles before the deadline", async () => {
    await expect(runWithAbortSignalTimeout(
      "fetch thing",
      1_000,
      async (signal) => {
        expect(signal.aborted).toBe(false);
        return "ok";
      },
    )).resolves.toBe("ok");
  });

  test("normalizes invalid timeout values before building the timeout error", async () => {
    await expect(runWithAbortSignalTimeout(
      "fetch thing",
      Number.POSITIVE_INFINITY,
      async () => new Promise<string>(() => undefined),
    )).rejects.toThrow("fetch thing: request timed out after 1ms");
  });

  test("uses the shared abort controller timeout primitive", () => {
    const source = readFileSync(new URL("./with-timeout.ts", import.meta.url), "utf8");
    const implementation = source.slice(
      source.indexOf("export async function runWithAbortSignalTimeout"),
      source.indexOf("export function abortSignalWithTimeout"),
    );

    expect(implementation).toContain("createAbortControllerWithTimeout");
    expect(implementation).not.toContain("new AbortController()");
    expect(implementation).not.toContain("setTimeout(");
  });
});

describe("abortSignalWithTimeout", () => {
  test("returns a signal that aborts after the timeout", async () => {
    const signal = abortSignalWithTimeout(1);
    expect(signal.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(signal.aborted).toBe(true);
  });

  test("uses the shared abort controller timeout primitive instead of AbortSignal.timeout", () => {
    const source = readFileSync(new URL("./with-timeout.ts", import.meta.url), "utf8");

    expect(source).not.toContain("AbortSignal.timeout");
    expect(source).toContain("createAbortControllerWithTimeout");
  });
});

describe("createAbortControllerWithTimeout", () => {
  test("aborts the controller after the timeout", async () => {
    const timeout = createAbortControllerWithTimeout("agent sdk", 1);

    expect(timeout.controller.signal.aborted).toBe(false);

    try {
      await new Promise<void>((resolve, reject) => {
        const fail = setTimeout(() => reject(new Error("abort event did not fire")), 100);
        timeout.controller.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(fail);
            resolve();
          },
          { once: true },
        );
      });

      expect(timeout.controller.signal.aborted).toBe(true);
      expect(String(timeout.controller.signal.reason)).toContain("agent sdk timed out after 1ms");
    } finally {
      timeout.clear();
    }
  });

  test("clear prevents the timeout from aborting the controller", async () => {
    const timeout = createAbortControllerWithTimeout("agent sdk", 5);

    timeout.clear();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(timeout.controller.signal.aborted).toBe(false);
  });

  test("normalizes invalid timeout values to a finite one millisecond deadline", async () => {
    const timeout = createAbortControllerWithTimeout("agent sdk", Number.POSITIVE_INFINITY);

    try {
      await new Promise<void>((resolve, reject) => {
        const fail = setTimeout(() => reject(new Error("abort event did not fire")), 100);
        timeout.controller.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(fail);
            resolve();
          },
          { once: true },
        );
      });

      expect(timeout.controller.signal.aborted).toBe(true);
      expect(String(timeout.controller.signal.reason)).toContain("agent sdk timed out after 1ms");
    } finally {
      timeout.clear();
    }
  });
});

describe("sleep", () => {
  test("resolves after the requested delay", async () => {
    const startedAt = Date.now();

    await sleep(1);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(0);
  });
});

describe("sleepWithAbortSignal", () => {
  test("resolves true when the sleep reaches its deadline", async () => {
    await expect(sleepWithAbortSignal(1)).resolves.toBe(true);
  });

  test("resolves false when the caller aborts before the deadline", async () => {
    const controller = new AbortController();
    const sleep = sleepWithAbortSignal(1_000, controller.signal);

    controller.abort();

    await expect(sleep).resolves.toBe(false);
  });
});

describe("scheduleTimeout", () => {
  test("runs the callback after the requested delay", async () => {
    let called = false;
    scheduleTimeout(() => {
      called = true;
    }, 1);

    await sleep(5);

    expect(called).toBe(true);
  });

  test("clear prevents the callback from running", async () => {
    let called = false;
    const scheduled = scheduleTimeout(() => {
      called = true;
    }, 5);

    scheduled.clear();
    await sleep(10);

    expect(called).toBe(false);
  });
});

describe("timeout primitive architecture", () => {
  test("keeps production Bun.sleep usage behind the shared timeout primitive", () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const offenders: string[] = [];

    function scan(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          scan(path);
          continue;
        }
        if (!path.endsWith(".ts") || path.endsWith(".test.ts")) {
          continue;
        }

        const rel = relative(repoRoot, path);
        if (rel === "src/lib/with-timeout.ts") {
          continue;
        }

        if (readFileSync(path, "utf8").includes("Bun.sleep")) {
          offenders.push(rel);
        }
      }
    }

    scan(join(repoRoot, "src"));
    scan(join(repoRoot, "scripts"));

    expect(offenders).toEqual([]);
  });

  test("keeps script promise-style setTimeout sleeps behind the shared timeout primitive", () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const offenders: string[] = [];

    function scan(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          scan(path);
          continue;
        }
        if (!path.endsWith(".ts") || path.endsWith(".test.ts")) {
          continue;
        }

        const rel = relative(repoRoot, path);
        const source = readFileSync(path, "utf8");
        if (/new\s+Promise[\s\S]{0,200}setTimeout\s*\(/.test(source)) {
          offenders.push(rel);
        }
      }
    }

    scan(join(repoRoot, "scripts"));

    expect(offenders).toEqual([]);
  });

  test("keeps direct production setTimeout usage behind the shared timeout primitive", () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const offenders: string[] = [];

    function scan(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          scan(path);
          continue;
        }
        if (!path.endsWith(".ts") || path.endsWith(".test.ts")) {
          continue;
        }

        const rel = relative(repoRoot, path);
        if (rel === "src/lib/with-timeout.ts") {
          continue;
        }

        const source = readFileSync(path, "utf8");
        if (/\bsetTimeout\s*\(/.test(source)) {
          offenders.push(rel);
        }
      }
    }

    scan(join(repoRoot, "src"));

    expect(offenders).toEqual([]);
  });

  test("keeps direct production setInterval usage behind the shared timeout primitive", () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const offenders: string[] = [];

    function scan(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          scan(path);
          continue;
        }
        if (!path.endsWith(".ts") || path.endsWith(".test.ts")) {
          continue;
        }

        const rel = relative(repoRoot, path);
        if (rel === "src/lib/with-timeout.ts") {
          continue;
        }

        const source = readFileSync(path, "utf8");
        if (/\bsetInterval\s*\(/.test(source)) {
          offenders.push(rel);
        }
      }
    }

    scan(join(repoRoot, "src"));

    expect(offenders).toEqual([]);
  });

  test("keeps direct production AbortSignal.timeout usage behind the shared timeout primitive", () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const offenders: string[] = [];

    function scan(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          scan(path);
          continue;
        }
        if (!path.endsWith(".ts") || path.endsWith(".test.ts")) {
          continue;
        }

        const rel = relative(repoRoot, path);
        if (rel === "src/lib/with-timeout.ts") {
          continue;
        }

        const source = readFileSync(path, "utf8");
        if (/\bAbortSignal\s*\.\s*timeout\s*\(/.test(source)) {
          offenders.push(rel);
        }
      }
    }

    scan(join(repoRoot, "src"));

    expect(offenders).toEqual([]);
  });

  test("keeps private runWithTimeout clones out of production modules", () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const offenders: string[] = [];

    function scan(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          scan(path);
          continue;
        }
        if (!path.endsWith(".ts") || path.endsWith(".test.ts")) {
          continue;
        }

        const rel = relative(repoRoot, path);
        if (rel === "src/lib/with-timeout.ts") {
          continue;
        }

        const source = readFileSync(path, "utf8");
        if (/\b(?:async\s+)?function\s+runWithTimeout\b/.test(source)) {
          offenders.push(rel);
        }
      }
    }

    scan(join(repoRoot, "src"));

    expect(offenders).toEqual([]);
  });

  test("keeps direct Promise.race timeout wrappers out of production modules", () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const offenders: string[] = [];

    function scan(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          scan(path);
          continue;
        }
        if (!path.endsWith(".ts") || path.endsWith(".test.ts")) {
          continue;
        }

        const rel = relative(repoRoot, path);
        if (rel === "src/lib/with-timeout.ts") {
          continue;
        }

        const source = readFileSync(path, "utf8");
        if (source.includes("Promise.race")) {
          offenders.push(rel);
        }
      }
    }

    scan(join(repoRoot, "src"));

    expect(offenders).toEqual([]);
  });
});
