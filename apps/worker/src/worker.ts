import type { MetricSnapshot } from "../../../packages/shared/src/metrics";
import type { Job } from "../../../packages/shared/src/types";

class Worker {
  private readonly workerId: string;

  constructor(workerId: string) {
    this.workerId = workerId;
  }

  async run(job: Job): Promise<MetricSnapshot> {
    const latencies: number[] = [];
    let succeededRequests = 0;
    let failedRequests = 0;

    const durationMs = Math.max(0, job.durationSeconds * 1000);
    const concurrency = Math.max(0, Math.floor(job.concurrency));
    const endTime = Date.now() + durationMs;

    try {
      while (Date.now() < endTime) {
        const batch = Array.from({ length: concurrency }, () =>
          this.executeRequest(job),
        );

        const results = await Promise.all(batch);

        for (const result of results) {
          latencies.push(result.latencyMs);

          if (result.ok) {
            succeededRequests += 1;
          } else {
            failedRequests += 1;
          }
        }
      }
    } catch {
      // Ensure run() never throws uncaught errors.
    }

    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const requestsCompleted = succeededRequests + failedRequests;

    return {
      timestamp: new Date().toISOString(),
      workerId: this.workerId,
      requestsCompleted,
      errorsCount: failedRequests,
      p50LatencyMs: this.calculatePercentile(sortedLatencies, 0.5),
      p95LatencyMs: this.calculatePercentile(sortedLatencies, 0.95),
      p99LatencyMs: this.calculatePercentile(sortedLatencies, 0.99),
    };
  }

  private async executeRequest(job: Job): Promise<{ ok: boolean; latencyMs: number }> {
    const startedAt = Date.now();

    try {
      const body = this.getRequestBody(job);
      const init: RequestInit = {
        method: job.method,
      };

      if (job.headers !== undefined) {
        init.headers = job.headers;
      }

      if (body !== undefined) {
        init.body = body;
      }

      const response = await fetch(job.targetUrl, init);

      const latencyMs = Date.now() - startedAt;

      return { ok: response.ok, latencyMs };
    } catch {
      const latencyMs = Date.now() - startedAt;

      return { ok: false, latencyMs };
    }
  }

  private getRequestBody(job: Job): string | undefined {
    if ((job.method === "POST" || job.method === "PUT") && job.body !== undefined) {
      if (typeof job.body === "string") {
        return job.body;
      }

      return JSON.stringify(job.body);
    }

    return undefined;
  }

  private calculatePercentile(sortedLatencies: number[], percentile: number): number {
    if (sortedLatencies.length === 0) {
      return 0;
    }

    const index = Math.ceil(percentile * sortedLatencies.length) - 1;
    const boundedIndex = Math.max(0, Math.min(index, sortedLatencies.length - 1));
    const value = sortedLatencies[boundedIndex];

    return value ?? 0;
  }
}

export = Worker;
