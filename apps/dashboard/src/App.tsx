import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

type TestStatus =
  | 'started'
  | 'running'
  | 'stopped'
  | 'backing_off'
  | 'ramping_up'
  | 'threshold_found'

interface MetricSnapshot {
  timestamp: string
  workerId: string
  requestsCompleted: number
  errorsCount: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
}

interface EventMessage {
  type: TestStatus
  concurrency: number
}

interface TestRunSummary {
  testId: string
  status: TestStatus
  targetUrl: string
  method: HttpMethod
  concurrency: number
  durationSeconds: number
  startedAt: string
  updatedAt: string
  snapshotCount: number
}

const HTTP_BASE = (import.meta.env.VITE_ORCHESTRATOR_HTTP as string | undefined) || 'http://localhost:3000'
const WS_BASE = (import.meta.env.VITE_ORCHESTRATOR_WS as string | undefined) || 'ws://localhost:3000'

function mergeMetrics(existing: MetricSnapshot[], incoming: MetricSnapshot[]): MetricSnapshot[] {
  const merged = new Map<string, MetricSnapshot>()

  for (const metric of existing) {
    const key = `${metric.timestamp}:${metric.workerId}`
    merged.set(key, metric)
  }

  for (const metric of incoming) {
    const key = `${metric.timestamp}:${metric.workerId}`
    merged.set(key, metric)
  }

  return Array.from(merged.values())
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-140)
}

export function App() {
  const [targetUrl, setTargetUrl] = useState('https://httpbin.org/get')
  const [method, setMethod] = useState<HttpMethod>('GET')
  const [concurrency, setConcurrency] = useState(10)
  const [durationSeconds, setDurationSeconds] = useState(15)

  const [testId, setTestId] = useState<string | null>(null)
  const [status, setStatus] = useState<TestStatus | 'idle'>('idle')
  const [liveConcurrency, setLiveConcurrency] = useState<number | null>(null)
  const [metrics, setMetrics] = useState<MetricSnapshot[]>([])
  const [testRuns, setTestRuns] = useState<TestRunSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRefreshingRuns, setIsRefreshingRuns] = useState(false)

  const pollRef = useRef<number | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const totals = useMemo(() => {
    const latest = metrics[metrics.length - 1]
    if (!latest) {
      return {
        requestsCompleted: 0,
        errorsCount: 0,
        errorRatePct: 0,
      }
    }

    const errorRatePct = latest.requestsCompleted > 0
      ? (latest.errorsCount / latest.requestsCompleted) * 100
      : 0

    return {
      requestsCompleted: latest.requestsCompleted,
      errorsCount: latest.errorsCount,
      errorRatePct,
    }
  }, [metrics])

  useEffect(() => {
    const loadTestRuns = async () => {
      setIsRefreshingRuns(true)

      try {
        const response = await fetch(`${HTTP_BASE}/tests`)
        if (!response.ok) {
          throw new Error(`Failed to fetch tests (${response.status})`)
        }

        const payload = await response.json()
        if (Array.isArray(payload.tests)) {
          setTestRuns(payload.tests)
        }
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch test runs')
      } finally {
        setIsRefreshingRuns(false)
      }
    }

    void loadTestRuns()

    const refreshTimer = window.setInterval(() => {
      void loadTestRuns()
    }, 10000)

    return () => {
      window.clearInterval(refreshTimer)

      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current)
      }

      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  useEffect(() => {
    if (!testId) {
      return
    }

    const fetchSnapshot = async () => {
      try {
        const response = await fetch(`${HTTP_BASE}/tests/${testId}`)
        if (!response.ok) {
          throw new Error(`Failed to fetch test snapshot (${response.status})`)
        }

        const payload = await response.json()
        setStatus(payload.status)
        if (Array.isArray(payload.metrics)) {
          setMetrics((current) => mergeMetrics(current, payload.metrics))
        }
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch snapshot')
      }
    }

    void fetchSnapshot()

    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
    }

    pollRef.current = window.setInterval(() => {
      void fetchSnapshot()
    }, 4000)

    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [testId])

  useEffect(() => {
    if (!testId) {
      return
    }

    if (wsRef.current) {
      wsRef.current.close()
    }

    const ws = new WebSocket(`${WS_BASE}/tests/${testId}/live`)
    wsRef.current = ws

    ws.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data as string) as
          | MetricSnapshot
          | { status: TestStatus }
          | { event: EventMessage }

        if ('event' in payload && payload.event) {
          setStatus(payload.event.type)
          setLiveConcurrency(payload.event.concurrency)
          return
        }

        if ('status' in payload && payload.status) {
          setStatus(payload.status)
          return
        }

        if ('p99LatencyMs' in payload) {
          setMetrics((current) => mergeMetrics(current, [payload]))
          if (status === 'started') {
            setStatus('running')
          }
        }
      } catch {
        setError('Received malformed live metric payload')
      }
    }

    ws.onerror = () => {
      setError('WebSocket disconnected. Polling still active.')
    }

    return () => {
      ws.close()
    }
  }, [testId, status])

  const handleStart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setError(null)
    setMetrics([])
    setLiveConcurrency(null)
    setIsSubmitting(true)

    try {
      const response = await fetch(`${HTTP_BASE}/tests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetUrl,
          method,
          concurrency,
          durationSeconds,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to create test (${response.status})`)
      }

      const payload = await response.json()
      setTestId(payload.testId)
      setStatus(payload.status)

      const testsResponse = await fetch(`${HTTP_BASE}/tests`)
      if (testsResponse.ok) {
        const testsPayload = await testsResponse.json()
        if (Array.isArray(testsPayload.tests)) {
          setTestRuns(testsPayload.tests)
        }
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to start test')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSelectRun = (selectedId: string) => {
    if (!selectedId) {
      return
    }

    setError(null)
    setLiveConcurrency(null)
    setMetrics([])
    setTestId(selectedId)

    const selectedRun = testRuns.find((run) => run.testId === selectedId)
    if (selectedRun) {
      setStatus(selectedRun.status)
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Distributed Load Tester</p>
        <h1>Adaptive Breakpoint Discovery</h1>
        <p className="subtitle">
          Launch a run, stream p50/p95/p99 in real time, and watch adaptive pressure events as the
          orchestrator hunts for threshold behavior.
        </p>
      </section>

      <section className="panel form-panel">
        <h2>Start Test Run</h2>
        <form className="grid" onSubmit={handleStart}>
          <label>
            Target URL
            <input
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://api.example.com/health"
              required
            />
          </label>

          <label>
            Method
            <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
          </label>

          <label>
            Concurrency
            <input
              type="number"
              value={concurrency}
              min={1}
              step={1}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              required
            />
          </label>

          <label>
            Duration (seconds)
            <input
              type="number"
              value={durationSeconds}
              min={1}
              step={1}
              onChange={(e) => setDurationSeconds(Number(e.target.value))}
              required
            />
          </label>

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Starting...' : 'Start Adaptive Test'}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="history-row">
          <h2 className="history-title">Recent Test Runs</h2>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setIsRefreshingRuns(true)
              void fetch(`${HTTP_BASE}/tests`)
                .then(async (response) => {
                  if (!response.ok) {
                    throw new Error(`Failed to fetch tests (${response.status})`)
                  }

                  const payload = await response.json()
                  if (Array.isArray(payload.tests)) {
                    setTestRuns(payload.tests)
                  }
                })
                .catch((refreshError) => {
                  setError(
                    refreshError instanceof Error
                      ? refreshError.message
                      : 'Failed to refresh test runs',
                  )
                })
                .finally(() => {
                  setIsRefreshingRuns(false)
                })
            }}
            disabled={isRefreshingRuns}
          >
            {isRefreshingRuns ? 'Refreshing...' : 'Refresh Runs'}
          </button>
        </div>

        <label>
          Choose a recent run
          <select
            value={testId ?? ''}
            onChange={(e) => handleSelectRun(e.target.value)}
          >
            <option value="">Select a run...</option>
            {testRuns.map((run) => (
              <option key={run.testId} value={run.testId}>
                {`${run.testId.slice(0, 8)} | ${run.status} | ${run.method} ${run.targetUrl}`}
              </option>
            ))}
          </select>
        </label>

        {testRuns.length === 0 ? <p className="muted">No persisted runs yet.</p> : null}
      </section>

      <section className="panel">
        <div className="status-row">
          <div>
            <p className="stat-label">Test ID</p>
            <p className="stat-value mono">{testId || 'Not started'}</p>
          </div>
          <div>
            <p className="stat-label">Status</p>
            <p className="stat-value">{status}</p>
          </div>
          <div>
            <p className="stat-label">Adaptive Concurrency</p>
            <p className="stat-value">{liveConcurrency ?? 'n/a'}</p>
          </div>
          <div>
            <p className="stat-label">Error Rate</p>
            <p className="stat-value">{totals.errorRatePct.toFixed(2)}%</p>
          </div>
        </div>

        <div className="status-row compact">
          <div>
            <p className="stat-label">Completed Requests</p>
            <p className="stat-value">{totals.requestsCompleted}</p>
          </div>
          <div>
            <p className="stat-label">Failed Requests</p>
            <p className="stat-value">{totals.errorsCount}</p>
          </div>
          <div>
            <p className="stat-label">Snapshots</p>
            <p className="stat-value">{metrics.length}</p>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="panel chart-panel">
        <h2>Latency Percentiles</h2>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={metrics}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.12)" />
              <XAxis
                dataKey="timestamp"
                tick={{ fontSize: 11 }}
                tickFormatter={(value: string) => value.slice(11, 19)}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                labelFormatter={(value) => `At ${String(value).slice(11, 19)}`}
                formatter={(value: number, name: string) => [
                  `${value.toFixed(1)} ms`,
                  name.replace('LatencyMs', ''),
                ]}
              />
              <Line type="monotone" dataKey="p50LatencyMs" stroke="#0f766e" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="p95LatencyMs" stroke="#ea580c" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="p99LatencyMs" stroke="#9f1239" dot={false} strokeWidth={2.4} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </main>
  )
}
