# payment-service

Simulated payments, orchestration of ledger posting and payment event emission. Built with Go, packaged as a container.

## Status

Planned

## Responsibilities

- Owns the `payment` schema. Migrations: golang-migrate with `x-migrations-table` inside the `payment` schema.
- Simulates payment scenarios: success, declined, timeout, insufficient funds.
- Orchestrates posting to the ledger and writes payment events to the outbox.
- Idempotency key on every write; context timeouts on all outbound calls; never retries non-idempotent calls.

## API

- `GET /health`: returns `{"status": "ok"}`.
- `POST /payments`: simulates a payment (amount in minor units, ISO 4217 currency, scenario, recipient email). Requires an idempotency key.
- `POST /sandbox/reset`: deletes the caller's rows in `payment` and re-applies the seed.

## Events

- Publishes: `payment.succeeded.v1`, `payment.failed.v1` (through the outbox, in the same transaction as the payment change).
- Consumes: none.

## Related

- [Polyglot services](../../architecture/adr/0002-polyglot-services.md)
- [ADR 0005: Events with pgmq and webhooks](../../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
- [ADR 0012: Simulated DC/DRC failover](../../architecture/adr/0012-simulated-dc-drc-failover.md)
