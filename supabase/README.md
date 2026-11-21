# supabase

Platform layer for the shared Supabase project: auth configuration, schema and role provisioning, the event bus (pgmq queues and the webhook dispatcher) and scheduled cleanup jobs. This folder does **not** contain service tables; each service owns its own migrations in its own folder.

## Status

In progress: the platform layer is implemented and tested locally and in CI. The hosted project is configured by the owner (see [Hosted setup](#hosted-setup-owner-actions)).

## Layout

| Path | Purpose |
|---|---|
| `config.toml` | Local stack configuration: auth providers, ports, signing keys. |
| `.env.example` | Placeholders for the `env(...)` values in `config.toml`. Copy to `.env` (gitignored). |
| `migrations/` | Platform migrations only: service schemas and roles, event bus, dispatcher, scheduled jobs. |
| `seed.sql` | **Local only**: local consumer endpoints, local signing secrets and local role passwords. Never applied to the hosted project. |
| `tests/` | pgTAP database tests, run with `supabase test db` locally and in CI. |

## What it provisions

- **Auth**: Google sign-in (Authorization Code + PKCE through the BFF) and anonymous guest sign-in, manual identity linking so a guest can link Google with `linkIdentity`, and asymmetric JWT signing keys published at the JWKS endpoint. Email and phone sign-in are disabled. Turnstile is enabled only in the hosted project.
- **Service schemas and roles**: schemas `account`, `ledger`, `payment`, `notification` and `reporting`, each owned by its login role `<svc>_service` with `search_path` set to it. Browser roles (`anon`, `authenticated`) and `service_role` have no access, and these schemas are not exposed through the Data API.
- **Event bus** (`eventbus` schema):
  - one pgmq queue per consumer group (`evt_<group>`) and one dead-letter queue (`evt_<group>_dlq`);
  - `subscriptions` maps event types to consumer groups;
  - `eventbus.publish(event jsonb)` is the only function service roles can call, from their outbox trigger;
  - `eventbus.dispatch_tick()` runs every 5 seconds and POSTs each event to the consumer's `POST /events` with pg_net, as a structured CloudEvent signed in the [Standard Webhooks](https://www.standardwebhooks.com/) format (`webhook-id`, `webhook-timestamp`, `webhook-signature`), forwarding `traceparent` and `baggage: site=<site>`;
  - deliveries time out after 5 seconds and are retried with backoff (10, 20, 40, 80, 160, then 300 seconds), and move to the dead-letter queue after `max_attempts` (default 6).
- **Scheduled jobs** (UTC):

  | Job | Schedule | Action |
  |---|---|---|
  | `eventbus-dispatch` | every 5 seconds | deliver queued events |
  | `sandbox-nightly-reset` | 00:00 | publish `platform.sandbox-nightly-reset.v1` to all five services |
  | `stale-guest-cleanup` | 00:30 | delete anonymous users inactive for more than 30 days |
  | `platform-housekeeping` | 01:00 | purge event archives older than 7 days and job history older than 1 day |

## Local development

Prerequisites: Docker Desktop running, Node.js (for `npx`).

```powershell
# One-time: environment values for config.toml, and a local JWT signing key (both gitignored)
Copy-Item supabase/.env.example supabase/.env   # then fill in a Google OAuth client if you need Google locally
Set-Content supabase/signing_keys.json '[]'
npx -y supabase@3.2.0 gen signing-key --algorithm ES256 --append

# Start the stack, reset to migrations + seed, run the tests
npx -y supabase@3.2.0 start
npx -y supabase@3.2.0 db reset
npx -y supabase@3.2.0 test db
```

Local port convention for services (used by the local consumer endpoints in `seed.sql`):

| Service | Port |
|---|---|
| account-service | 8081 |
| ledger-service | 8082 |
| payment-service | 8083 |
| notification-service | 8084 |
| reporting-service | 8085 |

The database container reaches services on the host through `host.docker.internal`. On Linux setups where that name does not resolve, update `eventbus.consumers.endpoint_url` with the Docker gateway IP.

Local service connection: `postgresql://<svc>_service:local-dev-only-<svc>@127.0.0.1:54322/postgres`. These local-only passwords and the local signing secrets in `seed.sql` are not credentials and are never used outside the local stack.

## Event bus operations

Run these as `postgres` (SQL editor or `psql`):

```sql
-- Delivery state per consumer group: queued, oldest age, dead-lettered, in flight
select * from eventbus.delivery_status;

-- Re-send archived messages of a group (only the last 7 days are kept)
select eventbus.replay('reporting', now() - interval '1 day');

-- Move a group's dead-lettered messages back to its queue with a fresh attempt count
select eventbus.redrive_dlq('notification');

-- Pause or resume deliveries to a group
update eventbus.consumers set enabled = false where consumer_group = 'notification';
```

## Hosted setup (owner actions)

These steps touch the hosted project and are **owner actions**. Agents never run them (see `CLAUDE.md`).

1. Link and push the migrations:
   `supabase link --project-ref <project-ref>`, then `supabase db push --dry-run`, then `supabase db push`.
2. Set each service role password (SQL editor), and keep the values only in the service's hosting environment:
   `alter role account_service password '<strong-password>';` (repeat for the other four roles).
   Services connect through Supavisor with the user `<svc>_service.<project-ref>`.
3. Create one dispatcher signing secret per consumer group in Vault, in the Standard Webhooks form (`whsec_` followed by a base64 key, for example generated by a Standard Webhooks library):
   `select vault.create_secret('<whsec-secret>', 'eventbus_webhook_secret_<group>');`
   Give the same secret to that service as its webhook verification secret.
4. In the dashboard:
   - Authentication > Sign In / Providers: enable Google (client id and secret from Google Cloud) and anonymous sign-ins; disable email and phone.
   - Authentication > Attack Protection: enable CAPTCHA with Cloudflare Turnstile.
   - Authentication > Sign In / Providers: enable manual linking.
   - Project Settings > JWT Keys: migrate to asymmetric signing keys (ES256) so services validate through JWKS.
   - Authentication > URL Configuration: site URL and the BFF callback URL of the deployed web app.
5. After each service is deployed, register its endpoint:
   `update eventbus.consumers set endpoint_url = 'https://<service-host>/events' where consumer_group = '<group>';`

Note: a Supabase Free project pauses after 7 days without activity, and scheduled jobs do not count as activity. Restore it from the dashboard if it pauses.

## Related

- [ADR 0004: Database per service](../architecture/adr/0004-database-per-service-via-schema-isolation.md)
- [ADR 0005: Events with pgmq and webhooks](../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [ADR 0011: Per-user sandbox seed and reset](../architecture/adr/0011-per-user-sandbox-seed-and-reset.md)
- [Event contracts](../contracts/events/README.md)
- [Eventing spec](../openspec/specs/eventing/spec.md)
