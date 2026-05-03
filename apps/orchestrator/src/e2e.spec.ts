/**
 * E2E integration test — requires a real Redis instance.
 *
 * Set REDIS_HOST / REDIS_PORT env vars, or defaults to localhost:6379.
 * If Redis is unreachable the test suite is skipped automatically.
 *
 * What is validated:
 *  - OrchestratorApi starts and accepts a POST /tests request
 *  - Job is published to the Redis "jobs" stream
 *  - RedisConsumer picks up the job, runs load against a local HTTP server
 *  - Worker publishes MetricSnapshot(s) to the Redis "metrics" stream
 *  - Orchestrator ingests snapshots and makes them visible on GET /tests/:testId
 *  - Status eventually transitions to "completed"
 *  - At least one snapshot is present with requestsCompleted > 0
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as http from "node:http";
import * as net from "node:net";

const redis = require("redis");
const OrchestratorApi = require("../dist/apps/orchestrator/src/api.js");
const RedisConsumer = require("../../worker/dist/apps/worker/src/consumer.js");

// ── helpers ──────────────────────────────────────────────────────────────────

function startEchoServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function poll<T>(
  fn: () => Promise<T>,
  predicate: (val: T) => boolean,
  { intervalMs = 1000, timeoutMs = 30_000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = await fn();
    if (predicate(val)) return val;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("poll timed out");
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe("E2E: full pipeline with real Redis", () => {
  let echoServer: http.Server;
  let echoUrl: string;
  let api: any;
  let consumer: any;
  let redisAvailable = false;

  beforeAll(async () => {
    // Check Redis reachability before doing anything
    const probe = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST ?? "localhost",
        port: Number(process.env.REDIS_PORT ?? "6379"),
        connectTimeout: 2000,
      },
    });

    try {
      await probe.connect();
      await probe.ping();
      // Flush test streams so previous runs don't pollute results
      await probe.del("jobs");
      await probe.del("metrics");
      await probe.quit();
      redisAvailable = true;
    } catch {
      await probe.quit().catch(() => undefined);
      console.warn("Redis not reachable — E2E tests will be skipped");
      return;
    }

    // Start local HTTP target
    ({ server: echoServer, url: echoUrl } = await startEchoServer());

    // Start orchestrator
    api = new OrchestratorApi();
    await api.start(0); // port 0 → OS assigns a free port

    // Start worker consumer
    consumer = new RedisConsumer("e2e-worker");
    await consumer.start();
  }, 20_000);

  afterAll(async () => {
    if (consumer) await consumer.stop().catch(() => undefined);
    if (api) await api.stop().catch(() => undefined);
    if (echoServer) echoServer.close();
  });

  it("completes a short test run and streams at least one metric snapshot", async () => {
    if (!redisAvailable) {
      console.log("Skipping — Redis not available");
      return;
    }

    const port: number = (api.app.server.address() as net.AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    // Create a test (5s duration, concurrency 3)
    const createRes = await fetch(`${base}/tests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUrl: echoUrl,
        method: "GET",
        concurrency: 3,
        durationSeconds: 5,
      }),
    });

    expect(createRes.status).toBe(200);
    const { testId } = (await createRes.json()) as { testId: string };
    expect(typeof testId).toBe("string");

    // Poll until completed (allow up to 30s)
    const result = await poll(
      async () => {
        const r = await fetch(`${base}/tests/${testId}`);
        return r.json() as Promise<{
          testId: string;
          status: string;
          metrics: { requestsCompleted: number }[];
        }>;
      },
      (body) => body.status === "completed",
      { intervalMs: 1500, timeoutMs: 30_000 },
    );

    expect(result.status).toBe("completed");
    expect(result.metrics.length).toBeGreaterThanOrEqual(1);
    expect(result.metrics[result.metrics.length - 1]!.requestsCompleted).toBeGreaterThan(0);
  }, 40_000);
});
