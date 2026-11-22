# reporting-service

Read model of cross-service summaries, built only from events. Built with Python 3.13 and FastAPI (managed with uv), packaged as a container.

## Status

In progress: the service skeleton is in place. It covers health, JWT validation, webhook signature verification, own-schema migrations with the `inbox` table, the container image and CI. `POST /events`, `GET /reports/payments-per-day` and `POST /sandbox/reset` answer `501` after their checks until roadmap steps 4 and 5.

## Responsibilities

- Owns the `reporting` schema. Migrations are Alembic revisions under `migrations/`, applied on every start, with the version table (`alembic_version`) inside the `reporting` schema.
- Receives events only through signed webhooks: Standard Webhooks HMAC-SHA256, a timing-safe compare, and a 5-minute timestamp tolerance against replay. It is idempotent through the `inbox` table.
- Builds summaries such as payments per day from consumed events; never writes to other services.
- Parameterized SQL only.
- Never logs tokens, signatures, webhook bodies or email addresses.

## Data model

| Table | Holds |
|---|---|
| `inbox` | `event_id` (primary key), `event_type`, `received_at`: event ids already processed |

## API

The contract is [contracts/openapi/reporting.yaml](../../contracts/openapi/reporting.yaml).

| Endpoint | Authentication | Now |
|---|---|---|
| `GET /health` | none | `200` with `{"status":"ok"}` |
| `POST /events` | webhook signature | `401` for a missing, wrong or stale signature; `501` once verified (planned: consume the CloudEvent) |
| `GET /reports/payments-per-day` | bearer token | `501` (planned: payments per day and outcome) |
| `POST /sandbox/reset` | bearer token | `501` (planned: delete the caller's rows) |

Webhook signature (Standard Webhooks, the format the dispatcher in `supabase/` uses):
- headers `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature` (one or more space-separated `v1,<base64>` values);
- the signature is HMAC-SHA256 over `<webhook-id>.<webhook-timestamp>.<raw body>`, keyed with the base64 key of the `whsec_` secret;
- the comparison is timing-safe, and timestamps more than 5 minutes away from now are rejected.

Tokens are Supabase Auth access tokens, validated with PyJWT (ADR 0007):
- the signature is checked with keys from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`;
- only ES256 or RS256 are accepted, and the token's algorithm must match its key;
- `iss` must be `<SUPABASE_URL>/auth/v1`, and `aud` must be `authenticated`;
- `exp` and `sub` are required.

A missing or invalid token gets `401` with `WWW-Authenticate: Bearer`. Every error response is JSON. There is no interactive API documentation page; the contract file is the documentation.

## Events

- Publishes: none.
- Consumes: `payment.succeeded.v1`, `payment.failed.v1`, `ledger.entry-posted.v1` (consumer group `reporting`). Planned.

## Configuration

| Variable | Meaning |
|---|---|
| `PORT` | Listening port. Default `80`; the container image sets `8080`. |
| `DATABASE_URL` | `postgres://user:password@host:port/database?params` for the `reporting_service` role. URL-encode special characters in the password. `sslmode` may be `disable`, `require`, `verify-ca` or `verify-full`. |
| `SUPABASE_URL` | Supabase project URL, used for the JWKS endpoint and the expected issuer. |
| `WEBHOOK_SECRET` | The dispatcher's signing secret for this consumer group, in the `whsec_<base64>` form. |

[.env.example](.env.example) has local values. Copy it to `.env` for local runs; `.env` is gitignored.

Outbound calls and their timeouts:
- **JWKS fetch:** 5 seconds. Keys are cached for an hour, and an unknown key id triggers at most one fetch every 5 minutes.
- **Database:** a 30-second socket timeout for connecting and for each read, and a 30-second statement timeout.

## Local development

You need [uv](https://docs.astral.sh/uv/) (it provides Python 3.13 if missing), plus Docker for the local Supabase stack.

1. From the repository root, start Supabase: `npx -y supabase@3.2.0 start`. `supabase/seed.sql` sets the local `reporting_service` password and the local dispatcher secret.
2. Install and run from this folder:
   ```bash
   uv sync
   cp .env.example .env   # then fill in WEBHOOK_SECRET as the file explains
   uv run --env-file .env python -m reporting_service.main
   ```
3. Check it: `curl http://127.0.0.1:8085/health`.

Commands:
- `uv run ruff check .` and `uv run ruff format --check .` lint and check formatting.
- `uv run mypy` type-checks in strict mode.
- `uv run pytest` runs the unit and HTTP tests and skips the integration tests.
- `uv run alembic revision -m "<message>"` creates a new migration file under `migrations/versions/`.

To run the integration tests too, with the local stack running:
```bash
eval "$(npx -y supabase@3.2.0 status -o env)"
REPORTING_TEST_DATABASE_URL="postgres://reporting_service:local-dev-only-reporting@127.0.0.1:54322/postgres" \
REPORTING_TEST_SUPABASE_URL="$API_URL" REPORTING_TEST_SUPABASE_KEY="$PUBLISHABLE_KEY" \
  uv run pytest
```

Container: `docker build -t reporting-service .`, then run it with the four variables set.

## Owner setup (hosted)

These are owner actions. Agents never run them.

1. **Role password.** In the Supabase dashboard, open the SQL editor and set a strong password for the role:
   ```sql
   alter role reporting_service password '<strong-random-password>';
   ```
   Keep it only in Vercel.
2. **Webhook secret.** Use the same value you stored in Vault as `eventbus_webhook_secret_reporting` (`supabase/README.md`, "Hosted setup"). You can read it back in the SQL editor:
   ```sql
   select decrypted_secret from vault.decrypted_secrets where name = 'eventbus_webhook_secret_reporting';
   ```
3. **Vercel project.** Import the repository as a new project:
   - Root Directory: `services/reporting-service`;
   - framework: Container (`vercel.json` selects it).

   Add these Production environment variables:
   - `PORT` = `8080`;
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`;
   - `DATABASE_URL` = the **session pooler** URL (port 5432) with the role as user: `postgres://reporting_service.<project-ref>:<password>@<pooler-host>:5432/postgres?sslmode=require`;
   - `WEBHOOK_SECRET` = the value from step 2.

   Use session mode, not transaction mode (port 6543): each start runs the migrations in one session.
4. **Check.** After the deploy:
   - `https://<reporting-project>.vercel.app/health` returns `{"status":"ok"}`;
   - `POST /events` without a signature returns `401`;
   - `GET /reports/payments-per-day` and `POST /sandbox/reset` without a token return `401`.

The dispatcher's endpoint URL for the `reporting` consumer is set in roadmap step 4, when the service starts processing events.

## Related

- [ADR 0005: Events with pgmq and webhooks](../../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
- [ADR 0004: Database per service via schema isolation](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
- [ADR 0003: Service per Vercel project as containers](../../architecture/adr/0003-service-per-vercel-project-as-containers.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [ADR 0010: Native observability charts via the BFF](../../architecture/adr/0010-native-observability-charts-via-bff.md)
- [ADR 0002: Polyglot services](../../architecture/adr/0002-polyglot-services.md)
