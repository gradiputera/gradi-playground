# docs/database

Database documentation: schema ownership, role and grant rules, and migration practice for the shared Supabase Postgres project.

## Status

Planned

## Responsibilities

- Ownership of schemas and migration tools per service.
- Role and grant rules, no cross-schema joins.
- Expand/contract migrations; applied migrations are never edited.

## Related

- [ADR 0004: Database per service](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
