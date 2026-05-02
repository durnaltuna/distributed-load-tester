import { describe, expect, it, vi } from 'vitest'

const RedisConsumer = require('../dist/apps/worker/src/consumer.js')

describe('RedisConsumer internals', () => {
  it('parses testId and job payload from a Redis stream message', () => {
    const consumer = new RedisConsumer('worker-test') as any

    const parsed = consumer.parseJob({
      testId: 'test-123',
      targetUrl: 'https://example.com/load',
      method: 'POST',
      concurrency: '8',
      durationSeconds: '15',
      headers: JSON.stringify({ Authorization: 'Bearer t' }),
      body: JSON.stringify({ ping: 'pong' }),
    })

    expect(parsed).toEqual({
      testId: 'test-123',
      job: {
        targetUrl: 'https://example.com/load',
        method: 'POST',
        concurrency: 8,
        durationSeconds: 15,
        headers: { Authorization: 'Bearer t' },
        body: { ping: 'pong' },
      },
    })
  })

  it('publishes testId alongside metric fields to the metrics stream', async () => {
    const consumer = new RedisConsumer('worker-test') as any
    consumer.client = {
      xAdd: vi.fn(async () => '1-0'),
    }

    await consumer.publishMetrics('test-456', {
      timestamp: '2026-01-01T00:00:00.000Z',
      workerId: 'worker-test',
      requestsCompleted: 200,
      errorsCount: 3,
      p50LatencyMs: 20,
      p95LatencyMs: 45,
      p99LatencyMs: 60,
    })

    expect(consumer.client.xAdd).toHaveBeenCalledTimes(1)
    expect(consumer.client.xAdd).toHaveBeenCalledWith(
      'metrics',
      '*',
      expect.objectContaining({
        testId: 'test-456',
        workerId: 'worker-test',
        requestsCompleted: '200',
        errorsCount: '3',
      }),
    )
  })
})
