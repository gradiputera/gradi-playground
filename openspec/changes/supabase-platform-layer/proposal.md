# Proposal

## Why

Every later roadmap step (web app, the five services, eventing, sandbox reset) depends on a shared Supabase platform layer that does not exist yet: auth providers, the per-service schemas and roles, the event bus (pgmq queues and the webhook dispatcher) and the scheduled cleanup jobs. This is roadmap step 1, so it has to land first.

Owning scope: **root** (`supabase/`, `contracts/events/`, `.github/workflows/`). It is cross-cutting because it provisions resources for all five services.

## What Changes

- Add a Supabase CLI project in `supabase/` (`config.toml`) for local development. It enables:
  - Google sign-in, with the client id and secret read from environment variables;
  - anonymous sign-in and manual identity linking (needed for `linkIdentity`);
  - asymmetric JWT signing keys, so services can validate tokens through JWKS.
- Email and phone sign-up are disabled.
- Add platform migrations (platform objects only, no service tables):
  - schemas `account`, `ledger`, `payment`, `notification`, `reporting`;
  - one login role `<svc>_service` per service, which owns only its own schema and has `search_path` set to it;
  - revoke access to these schemas for `anon` and `authenticated`, and keep them out of the Data API.
- Add a platform-owned `eventbus` schema:
  - pgmq queues, one per consumer group, each with a dead-letter queue;
  - a subscription table that maps event types to consumer groups;
  - a `SECURITY DEFINER` function `eventbus.publish(event)`, which is the only event-bus entry point granted to service roles;
  - a dispatcher driven by pg_cron and pg_net that POSTs signed CloudEvents to each consumer's `POST /events`, with backoff retries, dead-lettering, archive-based replay and a dead-letter redrive.
- Add scheduled jobs with pg_cron:
  - a nightly sandbox reset broadcast as the new event `platform.sandbox-nightly-reset.v1`;
  - nightly removal of guest users inactive for more than 30 days;
  - housekeeping purges that keep the database inside the Free tier.
- Add `supabase/seed.sql` (local only): local consumer endpoints and local-only dispatcher signing secrets, which are clearly not real credentials.
- Add pgTAP database tests and a CI workflow that starts the local stack and runs them.
- Add the event contract `platform.sandbox-nightly-reset.v1` (new, non-breaking) to `contracts/events/`.
- Document local setup and the **owner actions** in `supabase/README.md` and `.env.example`. The owner actions cover linking the hosted project, pushing migrations, setting role passwords and webhook secrets, configuring Google, Turnstile and the signing keys, and registering hosted consumer endpoints.

Out of scope:
- service tables, outbox and inbox tables, and service migrations (each service's own change);
- the Nuxt BFF auth flow (roadmap step 2);
- consumer-side signature verification (service changes);
- Grafana dashboards for queue metrics (observability step);
- any action against the hosted Supabase project.

## Capabilities

### New Capabilities
- `platform-database`: provisioning of the per-service schemas and roles, their isolation guarantees, and the rule that the platform layer holds no service tables.

### Modified Capabilities
- `eventing`: adds requirements for the platform publish entry point, the webhook signature format, retry backoff, delivery timeout, dead-letter redrive and archive retention; the replay requirement gains a bounded window.
- `auth`: adds the platform configuration requirements: anonymous sign-ins and manual linking enabled, asymmetric JWT signing keys, no email or phone sign-up, and stale guest removal.
- `sandbox`: the nightly global cleanup requirement now names the mechanism, a `platform.sandbox-nightly-reset.v1` event delivered to every service, followed by guest removal.

## Impact

- New files:
  - `supabase/config.toml`, `supabase/migrations/*.sql`, `supabase/seed.sql`, `supabase/tests/*.sql`, `supabase/.env.example`;
  - `.github/workflows/supabase.yml`;
  - `contracts/events/platform.sandbox-nightly-reset.v1.json`.
- Changed files: `contracts/events/asyncapi.yaml`, `contracts/events/README.md`, `supabase/README.md`, `.gitignore` (local signing key file).
- New tooling: Supabase CLI, run through `npx`, pinned (no committed dependency), and the `supabase/setup-cli` GitHub Action, pinned. The Postgres extensions `pgmq`, `pg_cron`, `pg_net` and `pgcrypto` ship with Supabase.
- No ADR change is needed. The design refines ADR 0004, 0005, 0007 and 0011 without altering their decisions. The refinements are the publish function, the signature header format, queue naming and the nightly reset event.
- Owner actions are required before anything runs in the hosted project. The agent never runs `supabase db push` or `supabase link`.
