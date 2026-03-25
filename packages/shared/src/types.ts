/**
 * SPEC: Job represents a single load test configuration
 * - targetUrl: the HTTP endpoint to test
 * - method: GET | POST | PUT | DELETE
 * - concurrency: number of simultaneous requests per worker
 * - durationSeconds: how long to run
 * - headers: optional HTTP headers to include
 * - body: optional request body for POST/PUT
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface Job {
	targetUrl: string;
	method: HttpMethod;
	concurrency: number;
	durationSeconds: number;
	headers?: Record<string, string>;
	body?: unknown;
}