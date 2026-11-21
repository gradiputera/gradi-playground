# payment-service

Simulated payments, orchestration of ledger posting and payment event emission. Built with Go, packaged as a container.

## Status

Planned

## Responsibilities

- Owns the `payment` schema. Migrations: golang-migrate with `x-migrations-table` inside the `payment` schema.
- Simulates payment scenarios (success, declined, timeout, insufficient funds).
- Orchestrates posting to the ledger and emits `payment.succeeded.v1` and `payment.failed.v1` through the outbox.

## Related

- [Polyglot services](../../architecture/adr/0002-polyglot-services.md)
- [Kafka-like events](../../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
