"use strict";
/**
 * SPEC: MetricSnapshot represents one measurement from a worker
 * - timestamp: when this was recorded (ISO string)
 * - workerId: which worker sent this
 * - requestsCompleted: total in this window
 * - errorsCount: failed requests in this window
 * - p50LatencyMs: median latency
 * - p95LatencyMs: 95th percentile latency
 * - p99LatencyMs: 99th percentile latency
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=metrics.js.map