# reporting-service

Read model of cross-service summaries, built only from events. Built with Python 3.13 and FastAPI (managed with uv), packaged as a container.

## Status

Planned

## Responsibilities

- Owns the `reporting` schema. Migrations: Alembic with `version_table_schema='reporting'`.
- Builds summaries such as payments per day from consumed events; never writes to other services.
- Parameterized SQL only.

## API

- `GET /health`: returns `{"status": "ok"}`.
- `POST /events`: webhook endpoint for CloudEvents from the dispatcher (2xx acknowledges the event).
- `GET /reports/payments-per-day`: read-only summary (used by the playground dashboards and Grafana KPIs).
- `POST /sandbox/reset`: deletes the caller's rows in `reporting`.

## Events

- Publishes: none.
- Consumes: `payment.succeeded.v1`, `payment.failed.v1`, `ledger.entry-posted.v1` (queue `payment.events.reporting` and the ledger equivalent).

## Related

- [ADR 0005: Events with pgmq and webhooks](../../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
- [ADR 0004: Database per service](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
