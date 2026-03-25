import { describe, expect, it, vi } from "vitest";

const OrchestratorApi = require("../dist/apps/orchestrator/src/api.js");

describe("OrchestratorApi internals", () => {
	it("normalizes invalid numeric job values and applies defaults", () => {
		const api = new OrchestratorApi() as any;

		const normalized = api.normalizeJob({
			targetUrl: "https://example.com",
			concurrency: 0,
			durationSeconds: -2,
		});

		expect(normalized.targetUrl).toBe("https://example.com");
		expect(normalized.method).toBe("GET");
		expect(normalized.concurrency).toBe(1);
		expect(normalized.durationSeconds).toBe(1);
	});

	it("extracts a metric field from stream pairs", () => {
		const api = new OrchestratorApi() as any;
		const fields = ["testId", "abc-123", "p99LatencyMs", "42"];

		expect(api.getField(fields, "testId")).toBe("abc-123");
		expect(api.getField(fields, "missing")).toBeNull();
	});

	it("parses redis stream metrics into numeric values", () => {
		const api = new OrchestratorApi() as any;
		const metric = api.parseMetric([
			"timestamp",
			"2026-01-01T00:00:00.000Z",
			"workerId",
			"w-1",
			"requestsCompleted",
			"250",
			"errorsCount",
			"4",
			"p50LatencyMs",
			"10",
			"p95LatencyMs",
			"25",
			"p99LatencyMs",
			"55",
		]);

		expect(metric).toEqual({
			timestamp: "2026-01-01T00:00:00.000Z",
			workerId: "w-1",
			requestsCompleted: 250,
			errorsCount: 4,
			p50LatencyMs: 10,
			p95LatencyMs: 25,
			p99LatencyMs: 55,
		});
	});

	it("broadcasts payload only to open sockets", () => {
		const api = new OrchestratorApi() as any;
		const openSocket = { readyState: 1, send: vi.fn() };
		const closedSocket = { readyState: 3, send: vi.fn() };

		api.subscribers.set("t-1", new Set([openSocket, closedSocket]));
		api.broadcast("t-1", { ok: true });

		expect(openSocket.send).toHaveBeenCalledTimes(1);
		expect(openSocket.send).toHaveBeenCalledWith(JSON.stringify({ ok: true }));
		expect(closedSocket.send).not.toHaveBeenCalled();
	});
});