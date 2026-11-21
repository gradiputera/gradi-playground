# ledger-service

Double-entry journal, general ledger report and trial balance. Built with Java 25 and Vert.x 5 (Maven), packaged as a container.

## Status

Planned

## Responsibilities

- Owns the `ledger` schema. Migrations: Flyway with `schemas=ledger`.
- Posts double-entry journal entries from payment outcomes; every entry balances.
- Serves the general ledger report, the journal and the trial balance.

## Related

- [ADR 0006: Ledger service design](../../architecture/adr/0006-ledger-service-design.md)
- [Polyglot services](../../architecture/adr/0002-polyglot-services.md)
