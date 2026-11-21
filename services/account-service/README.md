# account-service

Customer sandbox accounts and balances. Built with PHP 8.4 and Laravel, packaged as a container.

## Status

Planned

## Responsibilities

- Owns the `account` schema in the shared Supabase Postgres project.
- Migrations: Laravel migrations, history table inside the `account` schema.
- Manages per-user sandbox accounts and balances.

## Related

- [Polyglot services](../../architecture/adr/README.md)
- [Service contracts](../../contracts/openapi/README.md)
