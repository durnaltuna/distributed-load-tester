import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetricSnapshot } from "../../../packages/shared/src/metrics";

const AdaptiveController = require("../dist/apps/orchestrator/src/adaptive.js");

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
	return {
		timestamp: "2026-01-01T00:00:00.000Z",
		workerId: "worker-1",
		requestsCompleted: 100,
		errorsCount: 0,
		p50LatencyMs: 20,
		p95LatencyMs: 50,
		p99LatencyMs: 100,
		...overrides,
	};
}

describe("AdaptiveController", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("ramps up when latest p99 is below baseline", () => {
		const controller = new AdaptiveController("t-1", 100);
		const onRamp = vi.fn();

		controller.on("ramping_up", onRamp);

		for (let i = 0; i < 10; i += 1) {
			controller.addSnapshot(makeSnapshot({ p99LatencyMs: 100 }));
		}
		controller.addSnapshot(makeSnapshot({ p99LatencyMs: 80 }));

		controller.start();
		vi.advanceTimersByTime(5000);

		expect(controller.getConcurrency()).toBe(110);
		expect(onRamp).toHaveBeenCalledTimes(1);
		expect(onRamp.mock.calls[0][0].type).toBe("ramping_up");

		controller.stop();
	});

	it("backs off by 20 percent when p99 exceeds 2x baseline", () => {
		const controller = new AdaptiveController("t-2", 100);
		const onBackoff = vi.fn();

		controller.on("backing_off", onBackoff);

		for (let i = 0; i < 10; i += 1) {
			controller.addSnapshot(makeSnapshot({ p99LatencyMs: 100 }));
		}
		controller.addSnapshot(makeSnapshot({ p99LatencyMs: 250 }));

		controller.start();
		vi.advanceTimersByTime(5000);

		expect(controller.getConcurrency()).toBe(80);
		expect(onBackoff).toHaveBeenCalledTimes(1);
		expect(onBackoff.mock.calls[0][0].type).toBe("backing_off");

		controller.stop();
	});

	it("emits threshold_found and pauses future evaluations on high error rate", () => {
		const controller = new AdaptiveController("t-3", 100);
		const onThresholdFound = vi.fn();

		controller.on("threshold_found", onThresholdFound);

		for (let i = 0; i < 10; i += 1) {
			controller.addSnapshot(makeSnapshot({ p99LatencyMs: 100 }));
		}
		controller.addSnapshot(makeSnapshot({ errorsCount: 6, requestsCompleted: 100 }));

		controller.start();
		vi.advanceTimersByTime(5000);

		expect(onThresholdFound).toHaveBeenCalledTimes(1);
		expect(controller.getConcurrency()).toBe(100);

		controller.addSnapshot(makeSnapshot({ p99LatencyMs: 50, errorsCount: 0 }));
		vi.advanceTimersByTime(5000);

		expect(controller.getConcurrency()).toBe(100);

		controller.stop();
	});
});