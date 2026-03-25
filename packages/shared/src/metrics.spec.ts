import { describe, expect, expectTypeOf, it } from "vitest";
import type { MetricSnapshot } from "./metrics";

describe("MetricSnapshot contract", () => {
  it("accepts a valid metric snapshot shape", () => {
    const snapshot: MetricSnapshot = {
      timestamp: "2026-01-01T00:00:00.000Z",
      workerId: "worker-1",
      requestsCompleted: 120,
      errorsCount: 3,
      p50LatencyMs: 12,
      p95LatencyMs: 40,
      p99LatencyMs: 67,
    };

    expect(snapshot.requestsCompleted).toBeGreaterThanOrEqual(0);
    expect(snapshot.errorsCount).toBeGreaterThanOrEqual(0);
    expect(snapshot.p99LatencyMs).toBeGreaterThanOrEqual(snapshot.p95LatencyMs);
  });

  it("keeps numeric fields strongly typed", () => {
    expectTypeOf<MetricSnapshot["requestsCompleted"]>().toEqualTypeOf<number>();
    expectTypeOf<MetricSnapshot["errorsCount"]>().toEqualTypeOf<number>();
    expectTypeOf<MetricSnapshot["p99LatencyMs"]>().toEqualTypeOf<number>();
  });
});
