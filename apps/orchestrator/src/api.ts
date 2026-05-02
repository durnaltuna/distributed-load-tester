import type { Job } from "../../../packages/shared/src/types";
import type { MetricSnapshot } from "../../../packages/shared/src/metrics";

const { randomUUID } = require("node:crypto");
const Fastify = require("fastify");
const websocketPlugin = require("@fastify/websocket");
const corsPlugin = require("@fastify/cors");
const redis = require("redis");
const AdaptiveController = require("./adaptive");
const MetricsStore = require("./db");

type TestStatus =
  | "started"
  | "running"
  | "stopped"
  | "completed"
  | "backing_off"
  | "ramping_up"
  | "threshold_found";

interface TestRun {
  testId: string;
  status: TestStatus;
  job: Job;
  metrics: MetricSnapshot[];
  controller: InstanceType<typeof AdaptiveController>;
}

interface WsSocket {
  send: (data: string) => void;
  readyState: number;
}

class OrchestratorApi {
  private readonly app: any;
  private readonly redisClient: any;
  private readonly metricsStore: InstanceType<typeof MetricsStore>;
  private readonly tests: Map<string, TestRun> = new Map();
  private readonly subscribers: Map<string, Set<WsSocket>> = new Map();
  private isMetricsLoopRunning: boolean = false;

  constructor() {
    this.app = Fastify({ logger: true });
    this.redisClient = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || "localhost",
        port: Number(process.env.REDIS_PORT || "6379"),
      },
    });
    this.metricsStore = new MetricsStore();

    this.registerRoutes();
  }

  async start(port: number): Promise<void> {
    await this.app.register(corsPlugin, {
      origin: true,
    });
    await this.app.register(websocketPlugin);
    await this.redisClient.connect();
    await this.metricsStore.connect();
    await this.metricsStore.initializeSchema();

    this.isMetricsLoopRunning = true;
    this.startMetricsLoop();

    await this.app.listen({ port, host: "0.0.0.0" });
  }

  async stop(): Promise<void> {
    this.isMetricsLoopRunning = false;

    for (const run of this.tests.values()) {
      run.controller.stop();
    }

    await this.redisClient.quit();
    await this.metricsStore.close();
    await this.app.close();
  }

  private registerRoutes(): void {
    this.app.post("/tests", async (request: any, reply: any) => {
      const body = request.body as Partial<Job>;
      const job = this.normalizeJob(body);
      const testId = randomUUID();

      const controller = new AdaptiveController(testId, job.concurrency);
      const testRun: TestRun = {
        testId,
        status: "started",
        job,
        metrics: [],
        controller,
      };

      controller.on("event", (event: any) => {
        const existing = this.tests.get(testId);
        if (existing === undefined) {
          return;
        }

        existing.status = event.type;

        void this.metricsStore.updateTestRunStatus(testId, event.type).catch((error: unknown) => {
          this.app.log.error({ error, testId }, "failed to update test status");
        });

        this.broadcast(testId, { event });
      });

      controller.start();
      this.tests.set(testId, testRun);

      void this.metricsStore.insertTestRun(testId, job, "started").catch((error: unknown) => {
        this.app.log.error({ error, testId }, "failed to persist test run");
      });

      await this.redisClient.xAdd("jobs", "*", {
        testId,
        targetUrl: job.targetUrl,
        method: job.method,
        concurrency: String(job.concurrency),
        durationSeconds: String(job.durationSeconds),
        headers: JSON.stringify(job.headers ?? {}),
        body: job.body === undefined ? "" : JSON.stringify(job.body),
      });

      setTimeout(() => {
        const run = this.tests.get(testId);
        if (run !== undefined && run.status !== "stopped") {
          run.status = "completed";
          run.controller.stop();
          void this.metricsStore.updateTestRunStatus(testId, "completed").catch((error: unknown) => {
            this.app.log.error({ error, testId }, "failed to mark test completed");
          });
          this.broadcast(testId, { testId, status: "completed" });
        }
      }, (job.durationSeconds + 10) * 1000);

      return reply.send({ testId, status: "started" });

    });

    this.app.get("/tests", async (_request: any, reply: any) => {
      try {
        const runs = await this.metricsStore.listTestRuns();
        return reply.send({ tests: runs });
      } catch (error) {
        this.app.log.error({ error }, "failed to list tests from storage");

        const fallbackRuns = Array.from(this.tests.values())
          .map((run) => ({
            testId: run.testId,
            status: run.status,
            targetUrl: run.job.targetUrl,
            method: run.job.method,
            concurrency: run.job.concurrency,
            durationSeconds: run.job.durationSeconds,
            startedAt: run.metrics[0]?.timestamp ?? new Date().toISOString(),
            updatedAt: run.metrics[run.metrics.length - 1]?.timestamp ?? new Date().toISOString(),
            snapshotCount: run.metrics.length,
          }))
          .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

        return reply.send({ tests: fallbackRuns });
      }
    });

    this.app.get("/tests/:testId", async (request: any, reply: any) => {
      const testId = String(request.params.testId);
      const testRun = this.tests.get(testId);

      if (testRun !== undefined) {
        return reply.send({
          testId: testRun.testId,
          status: testRun.status,
          metrics: testRun.metrics,
        });
      }

      try {
        const storedRun = await this.metricsStore.getTestRun(testId);
        if (storedRun === null) {
          return reply.code(404).send({ message: "test not found" });
        }

        const metrics = await this.metricsStore.getMetricsForTest(testId);
        return reply.send({
          testId,
          status: storedRun.status,
          metrics,
        });
      } catch (error) {
        this.app.log.error({ error, testId }, "failed to fetch test from storage");
        return reply.code(404).send({ message: "test not found" });
      }
    });

    this.app.delete("/tests/:testId", async (request: any, reply: any) => {
      const testId = String(request.params.testId);
      const testRun = this.tests.get(testId);

      if (testRun === undefined) {
        return reply.code(404).send({ message: "test not found" });
      }

      testRun.status = "stopped";
      testRun.controller.stop();

      void this.metricsStore.updateTestRunStatus(testId, "stopped").catch((error: unknown) => {
        this.app.log.error({ error, testId }, "failed to update stopped status");
      });

      this.broadcast(testId, { testId, status: "stopped" });

      return reply.send({ testId, status: "stopped" });
    });

    this.app.get(
      "/tests/:testId/live",
      { websocket: true },
      (connection: any, request: any) => {
        const testId = String(request.params.testId);
        const socket = connection.socket as WsSocket;

        if (!this.subscribers.has(testId)) {
          this.subscribers.set(testId, new Set());
        }

        const set = this.subscribers.get(testId);
        if (set !== undefined) {
          set.add(socket);
        }

        connection.socket.on("close", () => {
          const subscribers = this.subscribers.get(testId);
          if (subscribers !== undefined) {
            subscribers.delete(socket);
            if (subscribers.size === 0) {
              this.subscribers.delete(testId);
            }
          }
        });
      },
    );
  }

  private normalizeJob(input: Partial<Job>): Job {
    const job: Job = {
      targetUrl: String(input.targetUrl ?? ""),
      method: (input.method ?? "GET") as Job["method"],
      concurrency: Math.max(1, Math.floor(Number(input.concurrency ?? 1))),
      durationSeconds: Math.max(
        1,
        Math.floor(Number(input.durationSeconds ?? 1)),
      ),
    };

    if (input.headers !== undefined) {
      job.headers = input.headers;
    }

    if (input.body !== undefined) {
      job.body = input.body;
    }

    return job;
  }

  private async startMetricsLoop(): Promise<void> {
    let lastId = "$";

    while (this.isMetricsLoopRunning) {
      try {
        const response = await this.redisClient.sendCommand([
          "XREAD",
          "BLOCK",
          "5000",
          "COUNT",
          "100",
          "STREAMS",
          "metrics",
          lastId,
        ]);

        const streams = response as Array<[string, Array<[string, string[]]>]> | null;
        if (streams === null) {
          continue;
        }

        for (const stream of streams) {
          const entries = stream[1] ?? [];

          for (const entry of entries) {
            const entryId = entry[0];
            const fields = entry[1] ?? [];
            lastId = entryId;

            const metric = this.parseMetric(fields);
            const testId = this.getField(fields, "testId");

            if (testId === null) {
              continue;
            }

            const testRun = this.tests.get(testId);
            if (testRun === undefined) {
              continue;
            }

            testRun.metrics.push(metric);
            testRun.status = testRun.status === "started" ? "running" : testRun.status;
            testRun.controller.addSnapshot(metric);
            this.broadcast(testId, metric);

            try {
              await this.metricsStore.insertMetric(testId, metric);
            } catch (error) {
              this.app.log.error({ error, testId }, "failed to persist metric");
            }
          }
        }
      } catch (error) {
        this.app.log.error({ error }, "metrics loop failed");
        await this.delay(1000);
      }
    }
  }

  private parseMetric(fields: string[]): MetricSnapshot {
    return {
      timestamp: this.getField(fields, "timestamp") ?? new Date().toISOString(),
      workerId: this.getField(fields, "workerId") ?? "unknown",
      requestsCompleted: Number(this.getField(fields, "requestsCompleted") ?? "0"),
      errorsCount: Number(this.getField(fields, "errorsCount") ?? "0"),
      p50LatencyMs: Number(this.getField(fields, "p50LatencyMs") ?? "0"),
      p95LatencyMs: Number(this.getField(fields, "p95LatencyMs") ?? "0"),
      p99LatencyMs: Number(this.getField(fields, "p99LatencyMs") ?? "0"),
    };
  }

  private getField(fields: string[], key: string): string | null {
    for (let i = 0; i < fields.length - 1; i += 2) {
      if (fields[i] === key) {
        return fields[i + 1] ?? null;
      }
    }

    return null;
  }

  private broadcast(testId: string, payload: unknown): void {
    const sockets = this.subscribers.get(testId);
    if (sockets === undefined) {
      return;
    }

    const message = JSON.stringify(payload);
    for (const socket of sockets) {
      if (socket.readyState === 1) {
        socket.send(message);
      }
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export = OrchestratorApi;
