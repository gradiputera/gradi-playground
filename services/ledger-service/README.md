# ledger-service

Double-entry journal, general ledger report and trial balance. Built with Java 25 and Vert.x 5 (Maven), packaged as a container.

## Status

Planned

## Responsibilities

- Owns the `ledger` schema. Migrations: Flyway with `schemas=ledger`.
- Posts double-entry journal entries from payment outcomes; every entry balances.
- Serves the general ledger report, the journal and the trial balance.
- Never blocks the event loop; database work runs on worker verticles.

## API

- `GET /health`: returns `{"status": "ok"}`.
- `POST /ledger/postings`: posts journal entries for a payment outcome (called by payment-service; idempotency key required).
- `GET /ledger/journal`: journal entries for the caller's sandbox.
- `GET /ledger/general-ledger`: general ledger per account with running balance; filters by date range and account.
- `GET /ledger/trial-balance`: trial balance; debits equal credits.
- `POST /sandbox/reset`: deletes the caller's rows in `ledger` and re-applies the chart of accounts and opening entries.

## Events

- Publishes: `ledger.entry-posted.v1` (through the outbox, in the same transaction as the posting).
- Consumes: none.

## Related

- [ADR 0006: Ledger service design](../../architecture/adr/0006-ledger-service-design.md)
- [ADR 0004: Database per service](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
- [Polyglot services](../../architecture/adr/0002-polyglot-services.md)
