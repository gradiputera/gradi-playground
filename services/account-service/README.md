# account-service

Customer sandbox accounts and balances. Built with PHP 8.4 and Laravel, packaged as a container.

## Status

Planned

## Responsibilities

- Owns the `account` schema in the shared Supabase Postgres project.
- Migrations: Laravel migrations, history table inside the `account` schema.
- Manages per-user sandbox accounts and balances.
- Models are pinned to the `account` schema; no unguarded mass assignment.

## API

- `GET /health`: returns `{"status": "ok"}`.
- `POST /sandbox/reset`: deletes the caller's rows in `account`, then re-applies the seed. Scoped by the JWT.
- Account and balance endpoints are defined in [contracts/openapi/account.yaml](../../contracts/openapi/README.md) when the service is implemented.

## Events

- Publishes: none.
- Consumes: none.

## Related

- [ADR 0004: Database per service](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
- [ADR 0011: Per-user sandbox seed and reset](../../architecture/adr/0011-per-user-sandbox-seed-and-reset.md)
- [Polyglot services](../../architecture/adr/0002-polyglot-services.md)
