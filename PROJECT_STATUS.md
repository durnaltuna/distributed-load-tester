# Project Status Checkpoint

Date: 2026-03-28

## Summary

Core backend and local container stack are operational, and the dashboard now exists and is wired into the runtime path. The project is usable locally for interactive load tests, but still needs deeper end-to-end automation and production infrastructure completion.

## Completed

- Orchestrator core exists:
  - Fastify API routes implemented (`POST /tests`, `GET /tests/:testId`, `DELETE /tests/:testId`).
  - WebSocket live stream route implemented (`/tests/:testId/live`).
  - Adaptive concurrency controller implemented.
  - Metrics ingestion loop from Redis stream implemented.
  - CORS enabled for browser clients.
- Worker core exists:
  - Redis consumer group flow (`jobs` stream / `workers` group) implemented.
  - HTTP load execution loop implemented.
  - Worker metrics publication implemented.
  - `testId` is now propagated from job payload to metrics stream entries.
- Shared contracts exist:
  - Shared TypeScript interfaces implemented in `packages/shared`.
- Dashboard implementation added:
  - React + Vite app scaffolded in `apps/dashboard`.
  - Test creation form connected to orchestrator.
  - WebSocket + polling metric updates implemented.
  - Live p50/p95/p99 chart implemented with Recharts.
- Docker baseline extended:
  - Dashboard Dockerfile added.
  - Dashboard service added to `docker-compose.yml`.
  - Compose now defines Redis, TimescaleDB, Prometheus, Grafana, Orchestrator, Worker, Dashboard.
- Tests and build status:
  - `worker` tests passing, including new consumer internals coverage.
  - `orchestrator` tests passing.
  - `dashboard` build passing.
  - root `npm run build` passing via turbo.

## Partially Complete / Needs Hardening

- Integration confidence is improved, but full runtime validation is still shallow:
  - No full automated test currently spans orchestrator -> Redis -> worker -> Redis -> orchestrator ingestion loop.
- Dashboard usability baseline exists, but UX/feature depth is limited:
  - Single-run workflow implemented.
  - No historical run browser or multi-test comparison yet.
- Runtime assumptions:
  - Redis dependency remains mandatory for orchestrator/worker startup.
  - TimescaleDB is running in compose but not yet used for persistence.

## Not Started

- Kubernetes manifests and HPA implementation details.
- Helm chart implementation details.
- Terraform cloud provisioning implementation.
- Production-grade CI/CD workflows.
- Demo deployment URL and final architecture/demo documentation assets.

## Recommended Next Order

1. Add an end-to-end integration test with real Redis that validates metric ingestion and status progression.
2. Persist snapshots to TimescaleDB and expose run retrieval endpoints for historical analysis.
3. Add dashboard support for listing and reloading prior test runs.
4. Add CI workflow gates for build + tests + smoke integration checks.

## Current Confidence

- Domain logic confidence: medium-high.
- Local runtime confidence: high for compose baseline and interactive dashboard flow.
- Deployment confidence: medium (infra and CI/CD still incomplete).
