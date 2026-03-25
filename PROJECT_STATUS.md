# Project Status Checkpoint

Date: 2026-03-25

## Summary

Current backend foundations exist and tests are green, but the project is not yet deployment-ready.

## Completed

- Orchestrator core exists:
  - API server and routes implemented.
  - Adaptive concurrency controller implemented.
  - Redis stream consumption + websocket broadcasting path implemented.
- Worker core exists:
  - HTTP load execution loop implemented.
  - Redis consumer implemented for jobs -> metrics.
- Shared contracts exist:
  - `Job` and `MetricSnapshot` interfaces implemented.
- Unit tests currently pass for all packages with test scripts.
- Integration path coverage now includes orchestrator job enqueue -> Redis stream via route test.
- Build artifact strategy now writes outputs to `dist` and keeps source directories source-only.

## Partially Complete / Needs Hardening

- Build pipeline baseline is now healthy:
  - `npm run build` succeeds in orchestrator/worker/shared after scoping package tsconfig includes/excludes.
- Test coverage is still partial:
  - Worker execution logic has tests.
  - Orchestrator has tests for controller and API internals.
  - Consumer loop and end-to-end flow (orchestrator <-> redis <-> worker) are not covered by integration tests.
- Runtime startup baseline is improved:
  - Worker now has `src/index.ts` entrypoint.
  - Shared now has `src/index.ts` barrel entrypoint.
  - Workspace now includes `ts-node` for dev scripts.
- Local runtime still depends on Redis availability:
  - Orchestrator and worker `npm run dev` will fail without Redis at `REDIS_HOST`/`REDIS_PORT`.
- Source artifact hygiene improved:
  - Generated JS/declaration artifacts were removed from package `src` directories.
  - Package builds emit into `dist`.

## Not Started

- Dashboard app implementation.
- Kubernetes/Helm/Terraform manifests.
- Project-specific README and runbook docs.

## Newly Added Baseline

- Docker baseline scaffolded:
  - `apps/orchestrator/Dockerfile`
  - `apps/worker/Dockerfile`
  - `docker-compose.yml`
  - `.dockerignore`
  - `infra/prometheus/prometheus.yml`
- Current compose stack status:
  - Redis, TimescaleDB, Prometheus, Grafana, Orchestrator, and Worker services are defined in compose.
  - TimescaleDB host port uses `5433` to avoid host conflicts with local PostgreSQL.
  - Full stack has been built and started successfully via `docker compose up -d --build`.

## Recommended Next Order (Before Docker Compose)

1. Validate full compose runtime behavior end-to-end (including orchestrator + worker startup and logs).
2. Add dashboard service to compose once dashboard implementation begins.
3. Add at least one end-to-end test that includes worker metric publication and orchestrator metric ingestion loop.

## Current Confidence

- Domain logic confidence: medium.
- Runtime/deployment confidence: medium-high for local/container baseline; still limited by missing dashboard and deeper end-to-end validation.
