import type { MetricSnapshot } from "../../../packages/shared/src/metrics";

const { EventEmitter } = require("node:events");

type AdaptiveEventType =
  | "backing_off"
  | "threshold_found"
  | "ramping_up";

interface AdaptiveEvent {
  testId: string;
  type: AdaptiveEventType;
  concurrency: number;
  snapshot: MetricSnapshot;
}

class AdaptiveController extends EventEmitter {
  private readonly testId: string;
  private readonly snapshots: MetricSnapshot[] = [];
  private baselineP99: number | null = null;
  private currentConcurrency: number;
  private stableSinceMs: number | null = null;
  private paused: boolean = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(testId: string, initialConcurrency: number) {
    super();
    this.testId = testId;
    this.currentConcurrency = Math.max(1, Math.floor(initialConcurrency));
  }

  addSnapshot(snapshot: MetricSnapshot): void {
    this.snapshots.push(snapshot);

    if (this.baselineP99 === null && this.snapshots.length >= 10) {
      const firstTen = this.snapshots.slice(0, 10);
      const total = firstTen.reduce((sum, item) => sum + item.p99LatencyMs, 0);
      this.baselineP99 = total / firstTen.length;
    }
  }

  start(): void {
    if (this.timer !== null) {
      return;
    }

    this.timer = setInterval(() => {
      this.evaluate();
    }, 5000);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getConcurrency(): number {
    return this.currentConcurrency;
  }

  private evaluate(): void {
    if (this.paused || this.baselineP99 === null || this.snapshots.length === 0) {
      return;
    }

    const latest = this.snapshots[this.snapshots.length - 1];
    if (latest === undefined) {
      return;
    }

    const requests = latest.requestsCompleted;
    const errorRate = requests > 0 ? latest.errorsCount / requests : 0;

    if (latest.p99LatencyMs > this.baselineP99 * 2) {
      this.currentConcurrency = Math.max(
        1,
        Math.floor(this.currentConcurrency * 0.8),
      );
      this.stableSinceMs = null;
      this.emitAdaptiveEvent("backing_off", latest);
      return;
    }

    if (errorRate > 0.05) {
      this.paused = true;
      this.stableSinceMs = null;
      this.emitAdaptiveEvent("threshold_found", latest);
      return;
    }

    if (latest.p99LatencyMs < this.baselineP99) {
      this.currentConcurrency = Math.max(
        1,
        Math.floor(this.currentConcurrency * 1.1),
      );
      this.stableSinceMs = null;
      this.emitAdaptiveEvent("ramping_up", latest);
      return;
    }

    const now = Date.now();
    if (this.stableSinceMs === null) {
      this.stableSinceMs = now;
      return;
    }

    if (now - this.stableSinceMs >= 30000) {
      this.currentConcurrency = Math.max(
        1,
        Math.floor(this.currentConcurrency * 1.1),
      );
      this.stableSinceMs = now;
      this.emitAdaptiveEvent("ramping_up", latest);
    }
  }

  private emitAdaptiveEvent(type: AdaptiveEventType, snapshot: MetricSnapshot): void {
    const payload: AdaptiveEvent = {
      testId: this.testId,
      type,
      concurrency: this.currentConcurrency,
      snapshot,
    };

    this.emit(type, payload);
    this.emit("event", payload);
  }
}

export = AdaptiveController;
