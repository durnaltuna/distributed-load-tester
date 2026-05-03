import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = require("redis");
const OrchestratorApi = require("../dist/apps/orchestrator/src/api.js");

let mockClient: any;

describe("Orchestrator API Redis flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    mockClient = {
      xAdd: vi.fn(async () => "1-0"),
      connect: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      del: vi.fn(async () => undefined),
    };

    vi.spyOn(redis, "createClient").mockReturnValue(mockClient);
  });

  it("creates a test and publishes the job to Redis stream", async () => {
    const api = new OrchestratorApi() as any;
    const app = api.app;

    await api.prepareRoutes();

    const createResponse = await app.inject({
      method: "POST",
      url: "/tests",
      payload: {
        targetUrl: "https://example.com/load",
        method: "POST",
        concurrency: 12,
        durationSeconds: 20,
        headers: {
          Authorization: "Bearer token",
        },
        body: {
          q: "hello",
        },
      },
    });

    expect(createResponse.statusCode).toBe(200);

    const created = JSON.parse(createResponse.body);
    expect(created.status).toBe("started");
    expect(typeof created.testId).toBe("string");

    expect(mockClient.xAdd).toHaveBeenCalledTimes(1);
    expect(mockClient.xAdd).toHaveBeenCalledWith(
      "jobs",
      "*",
      expect.objectContaining({
        testId: created.testId,
        targetUrl: "https://example.com/load",
        method: "POST",
        concurrency: "12",
        durationSeconds: "20",
      }),
    );

    const getResponse = await app.inject({
      method: "GET",
      url: `/tests/${created.testId}`,
    });

    expect(getResponse.statusCode).toBe(200);
    expect(JSON.parse(getResponse.body)).toEqual({
      testId: created.testId,
      status: "started",
      metrics: [],
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/tests",
    });

    expect(listResponse.statusCode).toBe(200);
    const listed = JSON.parse(listResponse.body);
    expect(Array.isArray(listed.tests)).toBe(true);
    expect(listed.tests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          testId: created.testId,
          status: "started",
          targetUrl: "https://example.com/load",
          method: "POST",
        }),
      ]),
    );

    await app.close();
  });
});
