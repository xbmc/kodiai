import { test, expect } from "bun:test";
import { trackEvent, getEventStats, exportEvents } from "./analytics.ts";

test("trackEvent should add event to memory", () => {
  trackEvent("test_event", 12345, "owner/repo");

  const events = exportEvents();
  expect(events.length).toBeGreaterThan(0);
});

test("getEventStats returns stats", () => {
  const stats = getEventStats();

  // Check stats structure
  expect(stats).toHaveProperty("total");
  expect(stats).toHaveProperty("byEvent");
});

test("analytics tracks metadata", () => {
  trackEvent("test", 123, "test/repo", { key: "value" });

  const events = exportEvents();
  const lastEvent = events[events.length - 1];

  // Should have metadata
  expect(lastEvent.metadata).toBeDefined();
});
