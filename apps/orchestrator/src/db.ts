import type { MetricSnapshot } from "../../../packages/shared/src/metrics";
import type { Job } from "../../../packages/shared/src/types";

const { Pool } = require("pg");

type TestStatus =
  | "started"
  | "running"
  | "stopped"
  | "backing_off"
  | "ramping_up"
  | "threshold_found";

interface PersistedTestRun {
  testId: string;
  status: TestStatus;
  targetUrl: string;
  method: Job["method"];
  concurrency: number;
  durationSeconds: number;
  startedAt: string;
  updatedAt: string;
  snapshotCount: number;
}

class MetricsStore {
  private readonly pool: any;

  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT || "5433"),
      user: process.env.DB_USER || "admin",
      password: process.env.DB_PASSWORD || "password",
      database: process.env.DB_NAME || "loadtest",
    });
  }

  async connect(): Promise<void> {
    const client = await this.pool.connect();
    client.release();
  }

  async initializeSchema(): Promise<void> {
    await this.pool.query("CREATE EXTENSION IF NOT EXISTS timescaledb");

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS test_runs (
        test_id TEXT PRIMARY KEY,
        target_url TEXT NOT NULL,
        method TEXT NOT NULL,
        concurrency INTEGER NOT NULL,
        duration_seconds INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS metrics (
        test_id TEXT NOT NULL,
        ts TIMESTAMPTZ NOT NULL,
        worker_id TEXT NOT NULL,
        requests_completed INTEGER NOT NULL,
        errors_count INTEGER NOT NULL,
        p50_latency_ms DOUBLE PRECISION NOT NULL,
        p95_latency_ms DOUBLE PRECISION NOT NULL,
        p99_latency_ms DOUBLE PRECISION NOT NULL
      )
    `);

    await this.pool.query(
      "SELECT create_hypertable('metrics', 'ts', if_not_exists => TRUE)",
    );

    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS metrics_test_id_ts_idx ON metrics (test_id, ts DESC)",
    );

    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS test_runs_started_at_idx ON test_runs (started_at DESC)",
    );
  }

  async insertTestRun(testId: string, job: Job, status: TestStatus): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO test_runs (
          test_id,
          target_url,
          method,
          concurrency,
          duration_seconds,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (test_id) DO NOTHING
      `,
      [
        testId,
        job.targetUrl,
        job.method,
        job.concurrency,
        job.durationSeconds,
        status,
      ],
    );
  }

  async updateTestRunStatus(testId: string, status: TestStatus): Promise<void> {
    await this.pool.query(
      `
        UPDATE test_runs
        SET status = $2,
            updated_at = NOW()
        WHERE test_id = $1
      `,
      [testId, status],
    );
  }

  async getTestRun(testId: string): Promise<PersistedTestRun | null> {
    const result = await this.pool.query(
      `
        SELECT
          tr.test_id,
          tr.status,
          tr.target_url,
          tr.method,
          tr.concurrency,
          tr.duration_seconds,
          tr.started_at,
          tr.updated_at,
          COUNT(*) AS snapshot_count
        FROM test_runs tr
        LEFT JOIN metrics m ON m.test_id = tr.test_id
        WHERE tr.test_id = $1
        GROUP BY tr.test_id
      `,
      [testId],
    );

    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }

    return {
      testId: String(row.test_id),
      status: String(row.status) as TestStatus,
      targetUrl: String(row.target_url),
      method: String(row.method) as Job["method"],
      concurrency: Number(row.concurrency),
      durationSeconds: Number(row.duration_seconds),
      startedAt: new Date(row.started_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      snapshotCount: Number(row.snapshot_count ?? 0),
    };
  }

  async listTestRuns(limit: number = 50): Promise<PersistedTestRun[]> {
    const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));

    const result = await this.pool.query(
      `
        SELECT
          tr.test_id,
          tr.status,
          tr.target_url,
          tr.method,
          tr.concurrency,
          tr.duration_seconds,
          tr.started_at,
          tr.updated_at,
          COUNT(*) AS snapshot_count
        FROM test_runs tr
        LEFT JOIN metrics m ON m.test_id = tr.test_id
        GROUP BY tr.test_id
        ORDER BY tr.started_at DESC
        LIMIT $1
      `,
      [boundedLimit],
    );

    return result.rows.map((row: any) => ({
      testId: String(row.test_id),
      status: String(row.status) as TestStatus,
      targetUrl: String(row.target_url),
      method: String(row.method) as Job["method"],
      concurrency: Number(row.concurrency),
      durationSeconds: Number(row.duration_seconds),
      startedAt: new Date(row.started_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      snapshotCount: Number(row.snapshot_count ?? 0),
    }));
  }

  async getMetricsForTest(testId: string, limit: number = 2000): Promise<MetricSnapshot[]> {
    const boundedLimit = Math.max(1, Math.min(10000, Math.floor(limit)));

    const result = await this.pool.query(
      `
        SELECT
          ts,
          worker_id,
          requests_completed,
          errors_count,
          p50_latency_ms,
          p95_latency_ms,
          p99_latency_ms
        FROM metrics
        WHERE test_id = $1
        ORDER BY ts ASC
        LIMIT $2
      `,
      [testId, boundedLimit],
    );

    return result.rows.map((row: any) => ({
      timestamp: new Date(row.ts).toISOString(),
      workerId: String(row.worker_id),
      requestsCompleted: Number(row.requests_completed),
      errorsCount: Number(row.errors_count),
      p50LatencyMs: Number(row.p50_latency_ms),
      p95LatencyMs: Number(row.p95_latency_ms),
      p99LatencyMs: Number(row.p99_latency_ms),
    }));
  }

  async insertMetric(testId: string, metric: MetricSnapshot): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO metrics (
          test_id,
          ts,
          worker_id,
          requests_completed,
          errors_count,
          p50_latency_ms,
          p95_latency_ms,
          p99_latency_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        testId,
        metric.timestamp,
        metric.workerId,
        metric.requestsCompleted,
        metric.errorsCount,
        metric.p50LatencyMs,
        metric.p95LatencyMs,
        metric.p99LatencyMs,
      ],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export = MetricsStore;