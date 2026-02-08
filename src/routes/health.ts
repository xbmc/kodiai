import { Hono } from "hono";

export function createHealthRoutes(): Hono {
  const app = new Hono();

  // Liveness probe: always 200 if the server process is running
  app.get("/health", (c) => {
    return c.json({ status: "ok" });
  });

  // Readiness probe: placeholder for now, returns 200
  // TODO: Plan 02 will wire this to check GitHub API connectivity
  // via githubApp.checkConnectivity() and return 503 if unreachable
  app.get("/readiness", (c) => {
    return c.json({ status: "ready" });
  });

  return app;
}
