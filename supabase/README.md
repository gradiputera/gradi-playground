# supabase

Platform layer for the shared Supabase project: auth configuration, schema and role provisioning, event queues (pgmq), the dispatcher cron and cleanup jobs. This folder does **not** contain service tables; each service owns its own migrations in its own folder.

## Status

Planned

## Responsibilities

- Auth providers: Google and anonymous sign-in, with Turnstile on anonymous sign-in.
- Schemas `account`, `ledger`, `payment`, `notification`, `reporting` and one role per service (`<svc>_service`) limited to its own schema. Passwords are never committed.
- Queues (pgmq) per consumer group, and the Cron dispatcher that posts signed webhooks.
- Nightly cleanup: sandbox reset and stale guest removal.

## Related

- [ADR 0004: Database per service](../architecture/adr/0004-database-per-service-via-schema-isolation.md)
- [ADR 0005: Events with pgmq and webhooks](../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
