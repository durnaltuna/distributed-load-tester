const redis = require('redis')
const Worker = require('./worker')

interface Job {
  targetUrl: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  concurrency: number
  durationSeconds: number
  headers?: Record<string, string>
  body?: unknown
}

interface MetricSnapshot {
  timestamp: string
  workerId: string
  requestsCompleted: number
  errorsCount: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
}

interface ParsedJob {
  testId: string
  job: Job
}

/**
 * SPEC: RedisConsumer
 * 
 * Connects to Redis Streams on stream key "jobs"
 * Reads jobs using consumer group "workers" 
 * For each job received:
 *   1. Parse the job from the stream message
 *   2. Pass it to Worker.execute()
 *   3. Publish the resulting MetricSnapshot back to Redis stream "metrics"
 *   4. Acknowledge the message so it's not re-processed
 * 
 * Must reconnect automatically if Redis connection drops.
 */

class RedisConsumer {
  private client: any
  private readonly workerId: string
  private isRunning: boolean = false
  private reconnectAttempts: number = 0
  private readonly maxReconnectAttempts: number = 10
  private readonly reconnectDelayMs: number = 1000

  constructor(workerId: string) {
    this.workerId = workerId
    this.client = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    })
  }

  async start(): Promise<void> {
    try {
      await this.client.connect()
      this.reconnectAttempts = 0

      // Ensure consumer group exists
      try {
        await this.client.xGroupCreate('jobs', 'workers', '$', {
          MKSTREAM: true,
        })
      } catch (error) {
        // Group might already exist, that's fine
      }

      this.isRunning = true
      this.consume()
    } catch (error) {
      console.error('Failed to connect to Redis:', error)
      this.reconnect()
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false

    try {
      await this.client.quit()
    } catch (error) {
      console.error('Error closing Redis connection:', error)
    }
  }

  private async consume(): Promise<void> {
    while (this.isRunning) {
      try {
        const messages = await this.client.xReadGroup(
          'workers',
          this.workerId,
          [{ key: 'jobs', id: '>' }],
          { COUNT: 1, BLOCK: 5000 },
        )

        if (!messages || messages.length === 0) {
          continue
        }

        for (const stream of messages) {
          const streamKey = stream.name
          const streamMessages = stream.messages

          for (const msg of streamMessages) {
            try {
              const parsedJob = this.parseJob(msg.message)
              const worker = new Worker(this.workerId)
              let currentConcurrency = parsedJob.job.concurrency

              // Poll Redis every 2s for orchestrator-driven concurrency updates
              let pollingActive = true
              const pollConcurrency = async (): Promise<void> => {
                while (pollingActive) {
                  await new Promise<void>((resolve) => setTimeout(resolve, 2000))
                  if (!pollingActive) break
                  try {
                    const val = await this.client.get(`concurrency:${parsedJob.testId}`)
                    if (val !== null) {
                      const parsed = parseInt(val, 10)
                      if (!isNaN(parsed) && parsed > 0) {
                        currentConcurrency = parsed
                      }
                    }
                  } catch {
                    // ignore transient polling errors
                  }
                }
              }

              void pollConcurrency()

              await worker.run(
                parsedJob.job,
                async (snapshot: MetricSnapshot) => {
                  await this.publishMetrics(parsedJob.testId, snapshot)
                },
                () => currentConcurrency,
              )

              pollingActive = false
              await this.client.xAck('jobs', 'workers', msg.id)
            } catch (error) {
              console.error('Error processing job:', error)
            }
          }
        }
      } catch (error) {
        console.error('Error consuming jobs:', error)

        if (!this.client.isOpen) {
          this.isRunning = false
          this.reconnect()
        }
      }
    }
  }

  private parseJob(message: Record<string, string>): ParsedJob {
    const testId = message.testId || ''
    const body = message.body ? JSON.parse(message.body) : undefined

    return {
      testId,
      job: {
        targetUrl: message.targetUrl || '',
        method: (message.method as any) || 'GET',
        concurrency: parseInt(message.concurrency || '1', 10),
        durationSeconds: parseInt(message.durationSeconds || '1', 10),
        headers: message.headers ? JSON.parse(message.headers) : undefined,
        body,
      },
    }
  }

  private async publishMetrics(testId: string, metrics: MetricSnapshot): Promise<void> {
    try {
      await this.client.xAdd('metrics', '*', {
        testId,
        timestamp: metrics.timestamp,
        workerId: metrics.workerId,
        requestsCompleted: metrics.requestsCompleted.toString(),
        errorsCount: metrics.errorsCount.toString(),
        p50LatencyMs: metrics.p50LatencyMs.toString(),
        p95LatencyMs: metrics.p95LatencyMs.toString(),
        p99LatencyMs: metrics.p99LatencyMs.toString(),
      })
    } catch (error) {
      console.error('Error publishing metrics:', error)
    }
  }

  private async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(
        `Max reconnection attempts (${this.maxReconnectAttempts}) reached`,
      )
      return
    }

    this.reconnectAttempts += 1
    const delay = this.reconnectDelayMs * this.reconnectAttempts

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`)

    await new Promise((resolve) => setTimeout(resolve, delay))

    await this.start()
  }
}

export = RedisConsumer
