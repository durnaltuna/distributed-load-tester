# Distributed Load Tester

Adaptive distributed load testing engine for finding HTTP endpoint breakpoints based on live latency and error behavior.

## What It Does

- Starts load tests through an orchestrator API.
- Dispatches jobs to worker processes through Redis Streams.
- Workers execute concurrent HTTP traffic and publish p50/p95/p99 snapshots.
- Orchestrator ingests worker snapshots, evaluates adaptive control rules, and emits live events.
- Dashboard visualizes latency curves and adaptive status in real time.

## Architecture

```text
Dashboard (React + Recharts)
  | HTTP + WebSocket
  v
Orchestrator (Fastify)
  | Redis Stream: jobs
  v
Workers (Node)
  | Redis Stream: metrics
  v
Orchestrator metrics loop + adaptive controller
```

Supporting infra in local stack:

- Redis
- TimescaleDB
- Prometheus
- Grafana

## Monorepo Layout

- `apps/orchestrator`: API + adaptive controller + metrics ingestion loop.
- `apps/worker`: Redis consumer + HTTP load generator.
- `apps/dashboard`: React dashboard for run creation and live charting.
- `packages/shared`: shared TypeScript contracts.
- `infra/*`: k8s/helm/terraform/prometheus assets.

## Quick Start (Docker Compose)

Requirements:

- Docker + Docker Compose

Commands:

```bash
docker compose up -d --build
```

Services:

- Dashboard: `http://localhost:4173`
- Orchestrator API: `http://localhost:3000`
- Grafana: `http://localhost:3001` (admin/admin)
- Prometheus: `http://localhost:9090`
- TimescaleDB: `localhost:5433`
- Redis: `localhost:6379`

Stop stack:

```bash
docker compose down
```

## Local Development (without Docker)

Install dependencies:

```bash
npm install
```

Run all workspace dev commands:

```bash
npm run dev
```

Or run apps individually:

```bash
npm run -w orchestrator dev
npm run -w worker dev
npm run -w dashboard dev
```

Dashboard environment variables (optional):

- `VITE_ORCHESTRATOR_HTTP` (default: `http://localhost:3000`)
- `VITE_ORCHESTRATOR_WS` (default: `ws://localhost:3000`)

## API

- `POST /tests`: create a test run and enqueue a job.
- `GET /tests/:testId`: fetch status and accumulated metrics.
- `DELETE /tests/:testId`: stop a test run.
- `GET /tests/:testId/live` (WebSocket): stream metrics and adaptive events.

Minimal create payload:

```json
{
  "targetUrl": "https://httpbin.org/get",
  "method": "GET",
  "concurrency": 10,
  "durationSeconds": 15
}
```

## Adaptive Logic (Current)

After baseline establishment:

- If error rate > 5%: emit `threshold_found` and pause.
- If p99 > 2x baseline: reduce concurrency by 20% and emit `backing_off`.
- If p99 < baseline: increase concurrency by 10% and emit `ramping_up`.
- If stable for 30s: increase concurrency by 10% and emit `ramping_up`.

## Testing and Build

Run package tests:

```bash
npm run -w worker test
npm run -w orchestrator test
```

Run full monorepo build:

```bash
npm run build
```

## Current Gaps

- End-to-end automated test that spans orchestrator -> redis -> worker -> orchestrator loop.
- TimescaleDB persistence path is not integrated yet.
- Kubernetes/Helm/Terraform work is still scaffold-level.
- CI/CD workflows are not finalized.
