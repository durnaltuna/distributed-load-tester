import { describe, expect, expectTypeOf, it } from "vitest";
import type { HttpMethod, Job } from "./types";

describe("Job contract", () => {
  it("accepts a valid job payload", () => {
    const job: Job = {
      targetUrl: "https://example.com/api",
      method: "POST",
      concurrency: 10,
      durationSeconds: 30,
      headers: {
        Authorization: "Bearer token",
      },
      body: {
        hello: "world",
      },
    };

    expect(job.targetUrl.startsWith("https://")).toBe(true);
    expect(job.concurrency).toBeGreaterThan(0);
    expect(job.durationSeconds).toBeGreaterThan(0);
  });

  it("limits method values to the defined union", () => {
    type AllowedMethods = "GET" | "POST" | "PUT" | "DELETE";
    expectTypeOf<HttpMethod>().toEqualTypeOf<AllowedMethods>();
  });
});
