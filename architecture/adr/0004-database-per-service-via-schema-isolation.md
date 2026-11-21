# 0004. Database per service via schema isolation

- Status: Accepted
- Date: 2026-11-21

## Context

Each service should own its data, but the free tier allows only two active Supabase projects. Running one database per service is not possible within the quota, and a single shared schema would let services couple through tables.

## Decision

- One Supabase Free project holds the data. The second Supabase project stays unused and is reserved for a future staging environment.
- Each service owns one Postgres schema: `account`, `ledger`, `payment`, `notification`, `reporting`.
- Each service has a role `<svc>_service` that can access only its own schema, with `search_path=<svc>`. Role passwords are never committed.
- Each service owns its migrations in its own folder, and keeps its migration history inside its own schema (Laravel migrations, Flyway, golang-migrate, Drizzle Kit, Alembic; see ADR 0002).
- The root `supabase/` folder is the platform layer only: auth configuration, schema and role provisioning, queues and cron. It holds no service tables.
- No cross-schema joins or foreign keys. Services integrate through HTTP APIs and events only.

## Consequences

### Positive

- Clear data ownership; a service cannot read another service's tables.
- Each service can migrate independently and be moved to its own database later without changing its code.

### Negative

- Reporting needs events, not joins, which means eventual consistency in summaries.
- Schema boundaries are enforced by role grants and a CI check (planned), not by separate servers.
- One shared database is a single point of failure; failover is simulated (ADR 0012), not real.

## Alternatives considered

- **One Supabase project per service**: rejected, because it exceeds the Free project quota.
- **One database with shared tables**: rejected, because services would couple through data.
- **Separate Postgres containers**: rejected for the hosted demo, kept as a possibility for local Compose only.
