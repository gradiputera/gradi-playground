# notification-service

Consumes payment and ledger events through signed webhooks and sends real email. Built with Node.js 24, TypeScript and Express 5, packaged as a container.

## Status

In progress: the service skeleton is in place. It covers health, JWT validation, webhook signature verification, own-schema migrations with the `inbox` table, the container image and CI. `POST /events` and `POST /sandbox/reset` answer `501` after their checks until roadmap steps 4 and 5.

## Responsibilities

- Owns the `notification` schema. Migrations are generated with Drizzle Kit and applied on every start, with the history table (`__drizzle_migrations`) inside the `notification` schema.
- Receives events only through signed webhooks: Standard Webhooks HMAC-SHA256, a timing-safe compare, and a 5-minute timestamp tolerance against replay. It is idempotent through the `inbox` table.
- Sends email through Gmail SMTP for payment outcomes, under the rules in ADR 0014 (roadmap step 4).
- Never logs full email addresses, SMTP credentials, tokens, signatures or webhook bodies; no SMS.

## Data model

| Table | Holds |
|---|---|
| `inbox` | `event_id` (primary key), `event_type`, `received_at`: event ids already processed |

## API

The contract is [contracts/openapi/notification.yaml](../../contracts/openapi/notification.yaml).

| Endpoint | Authentication | Now |
|---|---|---|
| `GET /health` | none | `200` with `{"status":"ok"}` |
| `POST /events` | webhook signature | `401` for a missing, wrong or stale signature; `501` once verified (planned: consume the CloudEvent) |
| `POST /sandbox/reset` | bearer token | `501` (planned: delete the caller's rows and stored addresses) |

Webhook signature (Standard Webhooks, the format the dispatcher in `supabase/` uses):
- headers `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature` (one or more space-separated `v1,<base64>` values);
- the signature is HMAC-SHA256 over `<webhook-id>.<webhook-timestamp>.<raw body>`, keyed with the base64 key of the `whsec_` secret;
- the comparison is timing-safe, and timestamps more than 5 minutes away from now are rejected.

Tokens are Supabase Auth access tokens, validated with `jose` (ADR 0007):
- the signature is checked with keys from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`;
- only ES256 or RS256 are accepted;
- `iss` must be `<SUPABASE_URL>/auth/v1`, and `aud` must be `authenticated`;
- `exp` and `sub` are required.

A missing or invalid token gets `401` with `WWW-Authenticate: Bearer`. Every error response is JSON.

## Events

- Publishes: none.
- Consumes: `payment.succeeded.v1`, `payment.failed.v1` (queue `payment.events.notification`). Planned.

## Mail module

These rules arrive with roadmap step 4:
- It is triggered only by consumed events. No endpoint sends mail on request.
- Templates are fixed. The user controls only the amount and currency; there are no free-text bodies.
- Every email has a "sandbox demo" footer.
- Caps are 3 emails per user per day and 100 emails globally per day. The module refuses to send when a cap is reached, and the payment is unaffected.
- Failures are logged without the address and never fail the payment.
- Optional IMAP polling reads bounces, so the timeline shows delivered or bounced.

## Masking and retention

- Telemetry shows masked addresses only, for example `j***@gmail.com`.
- Addresses are stored only in the `notification` schema.
- Addresses are deleted on sandbox reset and in the nightly cleanup.

## Configuration

| Variable | Meaning |
|---|---|
| `PORT` | Listening port. Default `80`; the container image sets `8080`. |
| `DATABASE_URL` | `postgres://user:password@host:port/database?params` for the `notification_service` role. URL-encode special characters in the password. |
| `SUPABASE_URL` | Supabase project URL, used for the JWKS endpoint and the expected issuer. |
| `WEBHOOK_SECRET` | The dispatcher's signing secret for this consumer group, in the `whsec_<base64>` form. |

[.env.example](.env.example) has local values. Copy it to `.env` for local runs; `.env` is gitignored.

Outbound calls and their timeouts:
- **JWKS fetch:** 5 seconds. Keys are cached for an hour, and an unknown key id triggers at most one fetch every 5 minutes.
- **Database:** 10-second connect timeout and 30-second statement timeout.

## Local development

You need Node.js 24 or newer with npm, plus Docker for the local Supabase stack. Node runs the TypeScript sources directly (type stripping), so there is no build step.

1. From the repository root, start Supabase: `npx -y supabase@3.2.0 start`. `supabase/seed.sql` sets the local `notification_service` password and the local dispatcher secret.
2. Install and run from this folder:
   ```bash
   npm ci
   cp .env.example .env   # then fill in WEBHOOK_SECRET as the file explains
   node --env-file=.env src/main.ts
   ```
3. Check it: `curl http://127.0.0.1:8084/health`.

Commands:
- `npm run typecheck` runs `tsc --noEmit`.
- `npm test` runs the unit and HTTP tests and skips the integration tests.
- `npm run db:generate` turns changes in `src/db/schema.ts` into a new SQL migration under `drizzle/`.

To run the integration tests too, with the local stack running:
```bash
eval "$(npx -y supabase@3.2.0 status -o env)"
NOTIFICATION_TEST_DATABASE_URL="postgres://notification_service:local-dev-only-notification@127.0.0.1:54322/postgres" \
NOTIFICATION_TEST_SUPABASE_URL="$API_URL" NOTIFICATION_TEST_SUPABASE_KEY="$PUBLISHABLE_KEY" \
  npm test
```

Container: `docker build -t notification-service .`, then run it with the four variables set.

## Owner setup (hosted)

These are owner actions. Agents never run them.

1. **Role password.** In the Supabase dashboard, open the SQL editor and set a strong password for the role:
   ```sql
   alter role notification_service password '<strong-random-password>';
   ```
   Keep it only in Vercel.
2. **Webhook secret.** Use the same value you stored in Vault as `eventbus_webhook_secret_notification` (`supabase/README.md`, "Hosted setup"). You can read it back in the SQL editor:
   ```sql
   select decrypted_secret from vault.decrypted_secrets where name = 'eventbus_webhook_secret_notification';
   ```
3. **Vercel project.** Import the repository as a new project:
   - Root Directory: `services/notification-service`;
   - framework: Container (`vercel.json` selects it).

   Add these Production environment variables:
   - `PORT` = `8080`;
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`;
   - `DATABASE_URL` = the **session pooler** URL (port 5432) with the role as user: `postgres://notification_service.<project-ref>:<password>@<pooler-host>:5432/postgres?sslmode=require`;
   - `WEBHOOK_SECRET` = the value from step 2.

   Use session mode, not transaction mode (port 6543): the migrations take a session-level advisory lock.
4. **Check.** After the deploy:
   - `https://<notification-project>.vercel.app/health` returns `{"status":"ok"}`;
   - `POST /events` without a signature returns `401`;
   - `POST /sandbox/reset` without a token returns `401`.

The dispatcher's endpoint URL for the `notification` consumer is set in roadmap step 4, when the service starts processing events.

## Related

- [ADR 0014: Real email via Gmail SMTP](../../architecture/adr/0014-real-email-via-gmail-smtp.md)
- [ADR 0005: Events with pgmq and webhooks](../../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
- [ADR 0003: Service per Vercel project as containers](../../architecture/adr/0003-service-per-vercel-project-as-containers.md)
- [ADR 0004: Database per service via schema isolation](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [ADR 0002: Polyglot services](../../architecture/adr/0002-polyglot-services.md)
