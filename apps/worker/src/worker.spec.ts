import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Worker = require('../dist/apps/worker/src/worker.js')
import type { Job } from '../../../packages/shared/src/types'

/**
 * SPEC: Worker
 * 
 * A Worker receives a Job and executes it.
 * 
 * It must:
 * 1. Fire exactly `concurrency` simultaneous HTTP requests in each batch
 * 2. Continue firing batches until `durationSeconds` is exceeded
 * 3. Track how many requests succeeded vs failed
 * 4. Calculate p50, p95, p99 latency from all recorded response times
 * 5. Return a MetricSnapshot when done
 * 6. Never throw an uncaught error — failed requests are counted, not thrown
 */

describe('Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should fire the correct number of concurrent requests', async () => {
    let concurrentRequests = 0
    let maxConcurrentRequests = 0

    global.fetch = vi.fn(async () => {
      concurrentRequests++
      maxConcurrentRequests = Math.max(maxConcurrentRequests, concurrentRequests)

      await new Promise((resolve) => setTimeout(resolve, 10))

      concurrentRequests--

      return new Response('OK', { status: 200 })
    })

    const job: Job = {
      targetUrl: 'http://example.com',
      method: 'GET',
      concurrency: 5,
      durationSeconds: 0.1,
    }

    const worker = new Worker('test-worker-1')
    const result = await worker.run(job)

    expect(maxConcurrentRequests).toBe(5)
    expect(result.requestsCompleted).toBeGreaterThan(0)
  })

  it('should not throw when the target URL is unreachable', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })

    const job: Job = {
      targetUrl: 'http://unreachable.local',
      method: 'GET',
      concurrency: 2,
      durationSeconds: 0.05,
    }

    const worker = new Worker('test-worker-2')
    const result = await worker.run(job)

    expect(result.errorsCount).toBeGreaterThan(0)
  })

  it('should correctly calculate p99 from a list of latencies', async () => {
    let callCount = 0

    // Alternate between fast (10ms) and slow (100ms) so the split is always
    // exactly 50/50 regardless of total request count. This guarantees that
    // p50 lands in the fast bucket and p99 lands in the slow bucket.
    global.fetch = vi.fn(async () => {
      callCount++
      const latency = callCount % 2 === 0 ? 10 : 100

      await new Promise((resolve) => setTimeout(resolve, latency))

      return new Response('OK', { status: 200 })
    })

    const job: Job = {
      targetUrl: 'http://example.com',
      method: 'GET',
      concurrency: 10,
      durationSeconds: 1,
    }

    const worker = new Worker('test-worker-3')
    const result = await worker.run(job)

    expect(result.p99LatencyMs).toBeGreaterThan(result.p50LatencyMs)
    expect(result.p99LatencyMs).toBeGreaterThan(0)
    expect(result.p50LatencyMs).toBeGreaterThan(0)
  })

  it('should stop after durationSeconds is exceeded', async () => {
    let fetchCount = 0

    global.fetch = vi.fn(async () => {
      fetchCount++

      await new Promise((resolve) => setTimeout(resolve, 5))

      return new Response('OK', { status: 200 })
    })

    const startTime = Date.now()

    const job: Job = {
      targetUrl: 'http://example.com',
      method: 'GET',
      concurrency: 1,
      durationSeconds: 0.1,
    }

    const worker = new Worker('test-worker-4')
    const result = await worker.run(job)

    const elapsedSeconds = (Date.now() - startTime) / 1000

    expect(elapsedSeconds).toBeLessThan(job.durationSeconds + 0.2)
    expect(result.requestsCompleted).toBeLessThan(20)
  })
})