# reporting-service

Read model of cross-service summaries, built only from events. Built with Python 3.13 and FastAPI (managed with uv), packaged as a container.

## Status

Planned

## Responsibilities

- Owns the `reporting` schema. Migrations: Alembic with `version_table_schema='reporting'`.
- Builds summaries such as payments per day from consumed events; never writes to other services.
- Exposes read-only summary endpoints; SQL is parameterized.

## Related

- [Kafka-like events](../../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
- [Database per service](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
