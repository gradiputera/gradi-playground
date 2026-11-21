# docs/database

Database documentation for the shared Supabase Postgres project: schema ownership, role and grant rules, and migration practice.

## Status

Planned

## Ownership

| Schema | Service | Migration tool | Migration history table |
|---|---|---|---|
| `account` | account-service | Laravel migrations | inside `account` |
| `ledger` | ledger-service | Flyway (`schemas=ledger`) | inside `ledger` |
| `payment` | payment-service | golang-migrate | `x-migrations-table` in `payment` |
| `notification` | notification-service | Drizzle Kit | `migrations.schema='notification'` |
| `reporting` | reporting-service | Alembic | `version_table_schema='reporting'` |

The platform layer (`supabase/`) owns auth and queue objects, not service tables.

## Roles and grants

- One role per service: `<svc>_service`.
- The role can use and modify only its own schema and sets `search_path=<svc>`.
- No role is granted access to another service's schema.
- Passwords are set in the hosting environment, never in the repository.

## Rules

- **No cross-schema joins or foreign keys.** Data another service needs arrives as events or API responses.
- **Expand/contract migrations.** Add new columns or tables first, move the code, then remove the old ones in a later migration.
- **Applied migrations are never edited.** A fix is a new migration.
- **Destructive changes** (drops, type changes) go through expand/contract and an ADR when they affect a contract.
- **Money** is stored as integer minor units with an ISO 4217 currency code, never as floating point.
- **Sandbox data** is scoped to a user; `POST /sandbox/reset` deletes only that user's rows (ADR 0011).

## Related

- [ADR 0004: Database per service](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
- [ADR 0002: Polyglot services](../../architecture/adr/0002-polyglot-services.md)
- [Security notes](../security/README.md)
