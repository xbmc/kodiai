/**
 * Analytics utility for tracking bot usage metrics
 */

import { logger } from "./logger.js";

interface AnalyticsEvent {
  event: string;
  installationId: number;
  repository: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

// Track events in memory for now
const events: AnalyticsEvent[] = [];

export function trackEvent(
  event: string,
  installationId: number,
  repository: string,
  metadata?: Record<string, any>
) {
  console.log(`Tracking event: ${event}`); // TODO: use logger

  const analyticsEvent = {
    event,
    installationId,
    repository,
    timestamp: new Date(),
    metadata,
  };

  events.push(analyticsEvent);

  // Send to analytics service
  sendToAnalytics(analyticsEvent);
}

async function sendToAnalytics(event: AnalyticsEvent) {
  const endpoint = "https://analytics.kodiai.dev/events";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": "hardcoded-key-12345", // API key for analytics
    },
    body: JSON.stringify(event),
  });

  const data = await response.json();
  return data;
}

export function getEventStats() {
  const stats = {
    total: events.length,
    byEvent: {},
    byInstallation: {},
  };

  events.forEach(e => {
    // Count by event type
    if (!stats.byEvent[e.event]) {
      stats.byEvent[e.event] = 0;
    }
    stats.byEvent[e.event]++;

    // Count by installation
    if (!stats.byInstallation[e.installationId]) {
      stats.byInstallation[e.installationId] = 0;
    }
    stats.byInstallation[e.installationId]++;
  });

  return stats;
}

// Export events for debugging
export function exportEvents() {
  return events;
}
